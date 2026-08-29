import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { startServer, type ServerHandle } from '../../server/index.ts'
import { NetConnection } from './connection'
import { createLobbyStore, type LobbyHook } from '../state/lobby'
import { MatchClient } from './match-client'
import { GameRunner, STEP_MS } from '../game/runner'
import { serializeBoard } from '../../shared/board.ts'
import { BOARD_W, type InputAction, type PieceType } from '../engine/types'
import type { LobbySettings, ServerMessage } from '../../shared/protocol.ts'

let server: ServerHandle
let url: string

const SETTINGS: LobbySettings = { mode: 'firstToX', goal: 3, winBy: 2 }

beforeAll(async () => {
  server = startServer(0)
  for (let i = 0; i < 50 && !server.server.address(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
  url = `ws://localhost:${(server.server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await server.close()
})

async function waitFor(fn: () => boolean, what: string, timeout = 4000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))

async function closeClient(conn: NetConnection, store: LobbyHook): Promise<void> {
  if (store.getState().lobby || store.getState().match) {
    store.getState().leaveLobby()
    await settle(50)
  }
  await conn.close()
}

interface Stack {
  conn: NetConnection
  store: LobbyHook
}

async function setupClient(name: string, tap?: (msg: ServerMessage) => void): Promise<Stack> {
  const conn = new NetConnection()
  const store = createLobbyStore(conn)
  if (tap) conn.onMessage(tap)
  store.getState().setName(name)
  store.getState().connect(url)
  await waitFor(() => store.getState().status === 'connected', `${name} connected`)
  return { conn, store }
}

async function setupMatch() {
  const a = await setupClient('A')
  const b = await setupClient('B')
  a.store.getState().createLobby('private', SETTINGS)
  await waitFor(() => a.store.getState().lobby !== null, 'A lobby')
  b.store.getState().joinLobby(a.store.getState().lobby!.code)
  await waitFor(() => b.store.getState().lobby !== null, 'B lobby')
  a.store.getState().startMatch()
  await waitFor(() => a.store.getState().match !== null, 'A match_start')
  await waitFor(() => b.store.getState().match !== null, 'B match_start')
  const matchId = a.store.getState().match!.matchId
  return { a, b, matchId }
}

/**
 * A player driven exactly like the real game screen: a `GameRunner` whose
 * events feed a `MatchClient`, and (as the screen does) the runner is
 * un-finalized when the server starts the next round (a top-out finalizes it).
 */
interface RunnerPlayer {
  runner: GameRunner
  client: MatchClient
}

function makeRunnerPlayer(matchId: string, conn: NetConnection, store: LobbyHook, fixedQueue: PieceType[]): RunnerPlayer {
  let client: MatchClient
  const runner = new GameRunner({
    mode: 'versus',
    gameOptions: {
      sendsGarbage: true,
      fourWide: store.getState().match?.settings.fourWide,
      fixedQueue,
    },
    onEvent: (events) => client.handleEvents(events),
    onEnd: () => {},
  })
  client = new MatchClient({
    game: runner.game,
    matchId,
    send: (msg) => conn.send(msg),
    onMessage: (handler) => conn.onMessage(handler),
    selfId: () => store.getState().selfId,
    players: store.getState().match?.players,
    round: store.getState().match?.round ?? 1,
  })
  let currentRound = store.getState().match?.round ?? 1
  client.subscribe((s) => {
    if (s.round !== currentRound) {
      currentRound = s.round
      runner.reset()
    }
  })
  return { runner, client }
}

/** One screen frame: queue the actions (if any) then advance one 60Hz tick. */
function fr(rp: RunnerPlayer, actions: InputAction[] = [], dir: -1 | 0 | 1 = 0, softDrop = false): void {
  if (actions.length) rp.runner.queueActions(actions)
  rp.runner.advance(STEP_MS, { dir, softDrop })
}

function frm(rp: RunnerPlayer, dir: -1 | 0 | 1, n: number): void {
  for (let i = 0; i < n; i++) fr(rp, [], dir)
}

const visible = (p: RunnerPlayer) => serializeBoard(p.runner.game.board.slice(-20))

/** A double + perfect clear (the survivor's non-zero authoritative score). */
function scoreDouble(p: RunnerPlayer): void {
  fr(p, ['hold'])
  frm(p, -1, 14)
  fr(p, ['hardDrop'])
  fr(p, [], 1)
  fr(p, ['hardDrop'])
  frm(p, -1, 14)
  fr(p, ['hardDrop'])
  fr(p, [], 1)
  fr(p, ['hardDrop'])
  frm(p, 1, 15)
  fr(p, ['hardDrop'])
}



describe('round transitions through the real GameRunner (game screen flow)', () => {
  it('a death resolves the round, credits the survivor\'s score, clears the dead board on the opponent, and resumes round 2 (twice)', { timeout: 30000 }, async () => {
    const { a, b, matchId } = await setupMatch()
    const pa = makeRunnerPlayer(matchId, a.conn, a.store, ['I', 'I', 'I', 'I', 'I', 'O', 'I', 'I', 'I', 'I', 'I', 'O'])
    const pb = makeRunnerPlayer(matchId, b.conn, b.store, ['T'])
    await settle() // game_start (round 1) lands
    const bId = b.store.getState().selfId!

    for (let round = 1; round <= 2; round++) {
      // survivor A scores a double (non-zero) through the real runner
      scoreDouble(pa)
      for (let i = 0; i < 35; i++) fr(pa) // push frames so snapshots flow
      pa.client.maybeSendSnapshot()
      expect(pa.runner.game.lines).toBe(2)
      await settle(150) // let A's locks reach the server before B dies

      // B tops out: the client signals death (a real game over sends this)
      pb.client.sendTopout()
      await settle()

      // the round advances: survivor wins, match continues (goal is 3)
      await waitFor(() => pa.client.getState().round === round + 1, `A round ${round + 1}`)
      await waitFor(() => pb.client.getState().round === round + 1, `B round ${round + 1}`)
      expect(pa.client.getState().finished).toBe(false)
      expect(pb.client.getState().finished).toBe(false)

      // scoreboard shows the survivor's NON-ZERO authoritative score + win tally
      const inter = pa.client.getState().intermission
      expect(inter).not.toBeNull()
      expect(inter!.winnerId).toBe(a.store.getState().selfId)
      expect(inter!.scores[a.store.getState().selfId!] ?? 0).toBeGreaterThan(0)
      expect(inter!.wins[a.store.getState().selfId!]).toBe(round)

      // the dead player's board is NOT stuck on the opponent after game_start:
      // opponents were cleared for the new round
      expect(pa.client.getState().opponents[bId]).toBeUndefined()

      // the dead player is revived and resumes: they can place a real piece in
      // the new round and their (fresh) board relays back to the opponent
      expect(pb.runner.game.over).toBe(false)
      fr(pb, ['hardDrop'])
      for (let i = 0; i < 35; i++) fr(pb)
      pb.client.maybeSendSnapshot()
      await waitFor(() => pa.client.getState().opponents[bId]?.board.length === 20, `A sees B round-${round + 1} board`)
      expect(serializeBoard(pa.client.getState().opponents[bId]!.board)).toBe(visible(pb))
      expect(pb.client.getState().finished).toBe(false)

      // no runaway death: over a settle the round stays put (single topout)
      await settle(200)
      expect(pa.client.getState().round).toBe(round + 1)
      expect(pa.client.getState().intermission).not.toBeNull()
    }

    // no runaway state: the lobby + live match survive both deaths
    await waitFor(() => server.stats().sessions === 1, 'session is still alive')
    expect(pa.client.getState().finished).toBe(false)
    expect(pb.client.getState().finished).toBe(false)

    await closeClient(a.conn, a.store)
    await closeClient(b.conn, b.store)
  })

  it('a real engine top-out is honored exactly once: the dead player is not re-killed, resumes in round 2, and relays a fresh board', { timeout: 30000 }, async () => {
    const { a, b, matchId } = await setupMatch()
    const pa = makeRunnerPlayer(matchId, a.conn, a.store, ['T'])
    const pb = makeRunnerPlayer(matchId, b.conn, b.store, ['T'])
    let gameEnds = 0
    a.conn.onMessage((msg) => {
      if (msg.type === 'game_end') gameEnds++
    })
    await settle() // game_start (round 1) lands
    const bId = b.store.getState().selfId!

    // B tops out through the real engine (spawn blocked): the GameRunner
    // finalizes (ended=true, a topout is sent). A idles so no garbage interferes.
    const g = pb.runner.game
    for (const y of [3, 4]) for (let x = 0; x < BOARD_W; x += 2) g.board[y][x] = 'J'
    for (let i = 0; i < 90 && !g.over; i++) pb.runner.advance(STEP_MS, { dir: 0, softDrop: false })
    expect(g.over).toBe(true)
    expect(pb.runner.ended ?? true).toBe(true) // singleplayer end-of-run semantics fired

    // the round resolves exactly once
    await waitFor(() => pa.client.getState().round === 2, 'A round 2')
    await waitFor(() => pb.client.getState().round === 2, 'B round 2')
    expect(gameEnds).toBe(1)

    // the dead player was revived for round 2: runner un-finalized and board fresh
    expect(pb.runner.game.over).toBe(false)
    expect(pb.runner.ended).toBe(false)

    // B plays round 2 and relays a fresh board to the opponent
    fr(pb, ['hardDrop'])
    for (let i = 0; i < 35; i++) fr(pb)
    pb.client.maybeSendSnapshot()
    await waitFor(() => pa.client.getState().opponents[bId]?.board.length === 20, 'A sees B round-2 board')
    expect(serializeBoard(pa.client.getState().opponents[bId]!.board)).toBe(visible(pb))

    // no repeated death / runaway round: the server does not keep eliminating B
    await settle(300)
    expect(gameEnds).toBe(1)
    expect(pa.client.getState().round).toBe(2)
    expect(pa.client.getState().finished).toBe(false)
    expect(server.stats().sessions).toBe(1)

    await closeClient(a.conn, a.store)
    await closeClient(b.conn, b.store)
  })
})