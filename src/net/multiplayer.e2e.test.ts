import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { setClaimWindowMs, setReconnectGraceMs, startServer, type ServerHandle } from '../../server/index.ts'
import { NetConnection } from './connection'
import { createLobbyStore, type LobbyHook } from '../state/lobby'
import { MatchClient } from './match-client'
import { Game } from '../engine/game'
import { serializeBoard } from '../../shared/board.ts'
import type { InputAction, PieceType } from '../engine/types'
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

/**
 * Clean exit for a client still inside a lobby/match: an intentional leave
 * (instant prune) rather than dropping the socket, which would leave the player
 * buffered in the lobby for the rejoin grace period and leak into the next test.
 */
async function closeClient(stack: ClientStack): Promise<void> {
  if (stack.store.getState().lobby || stack.store.getState().match) {
    stack.store.getState().leaveLobby()
    await settle(50)
  }
  await stack.conn.close()
}

interface ClientStack {
  conn: NetConnection
  store: LobbyHook
  errors: string[]
}

async function setupClient(name: string, tap?: (msg: ServerMessage) => void): Promise<ClientStack> {
  const conn = new NetConnection()
  const store = createLobbyStore(conn)
  const errors: string[] = []
  conn.onMessage((msg) => {
    // host_transferred is a benign notice ("you are now the host") and
    // connection_lost is the expected disconnect signal that triggers the
    // reconnect flow — neither is a fault for the race assertions
    if (msg.type === 'error' && msg.code !== 'host_transferred' && msg.code !== 'connection_lost') errors.push(msg.message)
    tap?.(msg)
  })
  store.getState().setName(name)
  store.getState().connect(url)
  await waitFor(() => store.getState().status === 'connected', `${name} connected`)
  expect(store.getState().selfId).toBeTruthy()
  return { conn, store, errors }
}

async function setupMatch(settings: LobbySettings = SETTINGS) {
  const a = await setupClient('A')
  const b = await setupClient('B')
  a.store.getState().createLobby('private', settings)
  await waitFor(() => a.store.getState().lobby !== null, 'A lobby')
  b.store.getState().joinLobby(a.store.getState().lobby!.code)
  await waitFor(() => b.store.getState().lobby !== null, 'B lobby')
  a.store.getState().startMatch()
  await waitFor(() => a.store.getState().match !== null, 'A match_start')
  await waitFor(() => b.store.getState().match !== null, 'B match_start')
  const matchId = a.store.getState().match!.matchId
  return { a, b, matchId }
}

interface Player {
  game: Game
  client: MatchClient
}

function makePlayer(matchId: string, conn: NetConnection, store: LobbyHook, fixedQueue: PieceType[]): Player {
  // mirrors the game screen: the engine is created from the lobby settings so
  // a four-wide lobby opens every board with grey side walls
  const game = new Game({ mode: 'versus', sendsGarbage: true, fourWide: store.getState().match?.settings.fourWide, fixedQueue })
  const client = new MatchClient({
    game,
    matchId,
    send: (msg) => conn.send(msg),
    onMessage: (handler) => conn.onMessage(handler),
    selfId: () => store.getState().selfId,
    players: store.getState().match?.players,
    round: store.getState().match?.round ?? 1,
  })
  return { game, client }
}

/** One tick batch through the real engine + real client (like the game screen's loop). */
function tick(player: Player, actions: InputAction[] = [], dir: -1 | 0 | 1 = 0, frames = 1): void {
  for (let i = 0; i < frames; i++) {
    const events = player.game.tick({ dir, softDrop: false, actions })
    player.client.handleEvents(events)
  }
  player.client.maybeSendSnapshot()
}

const visible = (game: Game) => serializeBoard(game.board.slice(-20))

describe('real client stack against the real server', () => {
  it('plays a full round: both sides see hold and each other\'s boards, garbage flows', async () => {
    const { a, b, matchId } = await setupMatch()
    const playerA = makePlayer(matchId, a.conn, a.store, ['I', 'I', 'I', 'I', 'I', 'O'])
    const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
    await settle() // let game_start (round 1) land before placing anything

    // A holds its first piece: hold works through the real engine + client
    tick(playerA, ['hold'])
    expect(playerA.game.hold).toBe('I')

    // A builds two full bottom rows and closes them with an O: a real double.
    // I at x=0 (cols 0-3), I at x=4 (cols 4-7), stacked twice, then O at x=8.
    tick(playerA, [], -1, 14) // I -> x=0
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 1, 1) // I -> x=4
    tick(playerA, ['hardDrop'])
    tick(playerA, [], -1, 14) // I -> x=0 (row above the stack)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 1, 1) // I -> x=4
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 1, 15) // O -> x=8
    tick(playerA, ['hardDrop'])
    expect(playerA.game.lines).toBe(2)
    // advance frames so the post-clear snapshot is sent and relayed to B
    tick(playerA, [], 0, 30)

    // the double is also a perfect clear (board emptied), so the attack is the
    // 10-line perfect-clear bonus — routed to B through the real server
    await waitFor(() => playerB.game.pendingGarbage === 10, 'B receives garbage')

    // B lands a non-clearing piece so the queued garbage lands on the board
    tick(playerB, ['hardDrop'])
    expect(playerB.game.lines).toBe(0)
    await waitFor(() => playerB.game.pendingGarbage === 0, 'B garbage applied')
    // advance B's frame counter so its snapshot crosses the 30-frame cadence
    tick(playerB, [], 0, 30)

    // B's board still holds its piece + garbage: no rollback
    await settle()
    expect(playerB.client.resyncs).toBe(0)
    expect(playerB.game.board.some((row) => row.some((c) => c === 'G'))).toBe(true)

    // A sees B's real board (20 rows, exactly what the component renders)
    await waitFor(() => playerA.client.getState().opponents[b.store.getState().selfId!]?.board.length === 20, 'A sees B board')
    expect(serializeBoard(playerA.client.getState().opponents[b.store.getState().selfId!]!.board)).toBe(visible(playerB.game))

    // and B sees A's real board
    await waitFor(() => playerB.client.getState().opponents[a.store.getState().selfId!]?.board.length === 20, 'B sees A board')
    expect(serializeBoard(playerB.client.getState().opponents[a.store.getState().selfId!]!.board)).toBe(visible(playerA.game))

    // B also sees A's hold, next queue, and lines through the relay — the data
    // the 1v1 opponent panel renders (big board, hold, next, stats)
    await waitFor(() => playerB.client.getState().opponents[a.store.getState().selfId!]?.hold === 'I', 'B sees A hold')
    const oppA = playerB.client.getState().opponents[a.store.getState().selfId!]!
    // the relayed queue matches A's real engine queue at snapshot time
    expect(oppA.next).toEqual(playerA.game.nextQueue.slice(0, oppA.next.length))
    await waitFor(() => playerB.client.getState().opponents[a.store.getState().selfId!]?.lines === 2, 'B sees A lines')
    expect(oppA.score).toBe(playerA.game.score)

    // both clients stayed authoritative for the whole round
    expect(playerA.client.resyncs).toBe(0)
    expect(playerB.client.resyncs).toBe(0)

    await closeClient(a)
    await closeClient(b)
  })

  it('plays a four-wide round: both boards walled, garbage holes stay in the well', async () => {
    const { a, b, matchId } = await setupMatch({ mode: 'firstToX', goal: 3, winBy: 2, fourWide: true })
    const playerA = makePlayer(matchId, a.conn, a.store, ['I', 'I', 'I', 'I'])
    const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
    await settle() // let game_start (round 1) land before placing anything

    // both engines opened the round walled: grey sides, open 4-cell well
    expect(playerA.game.board[0][0]).toBe('W')
    expect(playerA.game.board[0][9]).toBe('W')
    expect(playerA.game.board[0][5]).toBeNull()
    expect(playerB.game.board[0][0]).toBe('W')

    // an I at spawn x=3 spans the whole well, so four consecutive drops are
    // four single clears at combo x=0..3: 0, 0, ln(3.5)=1, ln(4.75)=1 → 2 lines
    for (let i = 0; i < 4; i++) tick(playerA, ['hardDrop'])
    expect(playerA.game.lines).toBe(4)
    await waitFor(() => playerB.game.pendingGarbage === 2, 'B receives four-wide garbage')

    // B applies the garbage with a non-clearing placement; every hole must sit
    // inside the well (3..6) on B's real engine board
    tick(playerB, ['hardDrop'])
    await waitFor(() => playerB.game.pendingGarbage === 0, 'B garbage applied')
    const holes = playerB.game.board
      .filter((row) => row.some((c) => c === 'G'))
      .map((row) => row.findIndex((c) => c === null))
    expect(holes.length).toBe(2)
    for (const h of holes) {
      expect(h).toBeGreaterThanOrEqual(3)
      expect(h).toBeLessThanOrEqual(6)
    }

    // boards relay with their walls intact: each side sees the other's real board
    tick(playerA, [], 0, 30)
    tick(playerB, [], 0, 30)
    await waitFor(() => playerA.client.getState().opponents[b.store.getState().selfId!]?.board.length === 20, 'A sees B board')
    expect(playerA.client.getState().opponents[b.store.getState().selfId!]!.board[0][0]).toBe('W')
    expect(playerB.client.getState().opponents[a.store.getState().selfId!]!.board[0][0]).toBe('W')

    // walls + clamped holes never caused a resync on either side
    await settle()
    expect(playerA.client.resyncs).toBe(0)
    expect(playerB.client.resyncs).toBe(0)

    await closeClient(b)
    await closeClient(a)
  })

  it('a round ending mid-match opens the intermission with round scores; only the match winner earns +1 game score', { timeout: 30000 }, async () => {
    const { a, b, matchId } = await setupMatch({ mode: 'firstToX', goal: 3, winBy: 2 })
    const playerA = makePlayer(matchId, a.conn, a.store, ['I', 'I', 'I', 'I', 'I', 'O'])
    const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()

    // A scores a double (hold I, then I x4 + O = 2 rows + perfect clear), then
    // B tops out: round 1 ends with A the survivor, but goal is 3, so the
    // match continues into round 2
    tick(playerA, ['hold'])
    tick(playerA, [], -1, 14)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 1, 1)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], -1, 14)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 1, 1)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 1, 15)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 0, 30)
    playerB.client.sendTopout()

    // both clients land in round 2 with the intermission scoreboard open:
    // round 1's scores, the round winner, and the round-wins tally
    await waitFor(() => playerA.client.getState().round === 2, 'A round 2')
    await waitFor(() => playerB.client.getState().round === 2, 'B round 2')
    const inter = playerA.client.getState().intermission
    expect(inter).not.toBeNull()
    expect(inter!.winnerId).toBe(a.store.getState().selfId)
    expect(inter!.scores[a.store.getState().selfId!]).toBeGreaterThan(0) // A scored in the round
    expect(inter!.scores[b.store.getState().selfId!]).toBe(0)
    expect(inter!.wins[a.store.getState().selfId!]).toBe(1) // round wins, not game score
    expect(playerA.client.getState().finished).toBe(false)
    expect(playerB.client.getState().finished).toBe(false)
    expect(playerB.client.getState().intermission).not.toBeNull()

    // a round win awards NO game score: the roster is still 0 for everyone
    expect(a.store.getState().lobby!.players.find((p) => p.id === a.store.getState().selfId)?.score).toBe(0)
    expect(b.store.getState().lobby!.players.find((p) => p.id === b.store.getState().selfId)?.score).toBe(0)

    // finish the match: B tops out twice more (rounds 2 and 3) — A wins 3-0.
    // Exactly the match winner gets +1 game score; the loser gets nothing.
    await settle(200)
    playerB.client.sendTopout()
    await waitFor(() => playerA.client.getState().round === 3, 'A round 3')
    await settle(200)
    playerB.client.sendTopout()
    await waitFor(() => playerA.client.getState().finished, 'match ends')
    expect(playerA.client.getState().error).toContain('MATCH WON')
    await waitFor(() => a.store.getState().lobby!.players.find((p) => p.id === a.store.getState().selfId)?.score === 1, 'A earns +1 game score')
    expect(b.store.getState().lobby!.players.find((p) => p.id === b.store.getState().selfId)?.score).toBe(0)
    await waitFor(() => server.stats().sessions === 0, 'session reclaimed')

    await closeClient(a)
    await closeClient(b)
  })

  it('guest leaving mid-match ends the 1v1 and frees the leaver to rejoin elsewhere', async () => {
    const { a, b, matchId } = await setupMatch()
    const playerA = makePlayer(matchId, a.conn, a.store, ['I'])
    await settle()

    // guest presses LEAVE through the real store -> server removes them
    b.store.getState().leaveLobby()

    await waitFor(() => playerA.client.getState().finished, 'A sees match_end')
    await waitFor(() => playerA.client.getState().opponents[b.store.getState().selfId!]?.left === true, 'A sees B left')
    expect(playerA.client.getState().error).toContain('MATCH WON')
    // the leaver is pruned from A's view: no frozen board, hold, or stats
    const bState = playerA.client.getState().opponents[b.store.getState().selfId!]
    expect(bState.board).toEqual([])
    expect(bState.hold).toBeNull()
    expect(bState.next).toEqual([])
    expect(server.stats().sessions).toBe(0)

    // the leaver is back on the multiplayer menu and can host a brand-new lobby
    b.store.getState().createLobby('private', SETTINGS)
    await waitFor(() => b.store.getState().lobby !== null, 'B re-creates lobby')
    expect(b.store.getState().lobby!.players).toHaveLength(1)
    expect(b.store.getState().match).toBeNull()

    await closeClient(a)
    await closeClient(b)
  })

  it('host leaving mid-match ends the match and hands the lobby to the guest', async () => {
    const { a, b, matchId } = await setupMatch()
    const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()

    a.store.getState().leaveLobby() // host leaves mid-match

    await waitFor(() => playerB.client.getState().finished, 'B sees match_end')
    expect(playerB.client.getState().error).toContain('MATCH WON')
    // host transfer: B is the host of the surviving lobby
    await waitFor(() => b.store.getState().lobby?.hostId === b.store.getState().selfId, 'B becomes host')
    expect(b.store.getState().lobby!.players).toHaveLength(1)

    await closeClient(a)
    await closeClient(b)
  })

  it('two consecutive matches in the same lobby: the second stays authoritative (no rollback)', async () => {
    const { a, b } = await setupMatch({ mode: 'firstToX', goal: 1, winBy: 2 })
    const firstA = makePlayer(a.store.getState().match!.matchId, a.conn, a.store, ['I'])
    const firstB = makePlayer(b.store.getState().match!.matchId, b.conn, b.store, ['T'])
    await settle()

    // match 1 ends instantly: B tops out, A wins game 1 (goal is 1)
    firstB.client.sendTopout()
    await waitFor(() => firstA.client.getState().finished && firstB.client.getState().finished, 'match 1 end')
    // winning the round opened the intermission scoreboard with the round's
    // scores, and A earned +1 game score
    expect(firstA.client.getState().intermission).not.toBeNull()
    expect(firstA.client.getState().intermission!.winnerId).toBe(a.store.getState().selfId)
    expect(firstA.client.getState().intermission!.scores[a.store.getState().selfId!]).toBeGreaterThanOrEqual(0)
    expect(firstA.client.getState().wins[a.store.getState().selfId!]).toBe(1)
    // the game score persists on the lobby member (rostered live) — visible
    // next to the name when both clients return to the lobby
    await waitFor(() => a.store.getState().lobby!.players.find((p) => p.id === a.store.getState().selfId)?.score === 1, 'A game score on roster')
    expect(b.store.getState().lobby!.players.find((p) => p.id === a.store.getState().selfId)?.score).toBe(1)
    firstA.client.destroy()
    firstB.client.destroy()

    // the app's post-match cleanup returns both players to the lobby
    a.store.getState().clearMatch()
    b.store.getState().clearMatch()

    // host starts match 2 in the same lobby: the game score carried over
    // (persists until the player leaves or the lobby expires)
    a.store.getState().startMatch()
    await waitFor(() => a.store.getState().match !== null, 'match 2 start A')
    await waitFor(() => b.store.getState().match !== null, 'match 2 start B')
    expect(a.store.getState().match!.players.find((p) => p.id === a.store.getState().selfId)?.score).toBe(1)
    const matchId2 = a.store.getState().match!.matchId

    const secondA = makePlayer(matchId2, a.conn, a.store, ['T'])
    const secondB = makePlayer(matchId2, b.conn, b.store, ['T'])
    await settle()

    // A places a non-clearing piece and keeps it: the finished match 1 session
    // must not swallow locks while snapshots hit match 2 (the rollback bug)
    tick(secondA, [], -1, 2)
    tick(secondA, ['hardDrop'])
    // advance frames so a snapshot is sent and relayed to B
    tick(secondA, [], 0, 30)
    await settle(200)
    expect(secondA.client.resyncs).toBe(0)
    expect(secondA.game.board.some((row) => row.some((c) => c !== null))).toBe(true)

    // B sees A's round-2 board (round-tagged relay, fresh after game_start)
    await waitFor(() => secondB.client.getState().opponents[a.store.getState().selfId!]?.board.length === 20, 'B sees A board in match 2')
    expect(serializeBoard(secondB.client.getState().opponents[a.store.getState().selfId!]!.board)).toBe(visible(secondA.game))
    expect(secondB.client.getState().round).toBe(1)

    // a healthy second match never needed a correction
    expect(secondA.client.resyncs).toBe(0)
    expect(secondB.client.resyncs).toBe(0)

    await closeClient(a)
    await closeClient(b)
  })
})

describe('leave/disconnect races through the real stack', () => {
  it('both players leaving at once strands nothing and frees both to rejoin', { timeout: 30000 }, async () => {
    const { a, b, matchId } = await setupMatch()
    const playerA = makePlayer(matchId, a.conn, a.store, ['I'])
    const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()

    // both press LEAVE back-to-back; the server sees them in some order
    a.store.getState().leaveLobby()
    b.store.getState().leaveLobby()

    // whichever leave the server processed second wins the 1v1
    await waitFor(() => playerA.client.getState().finished || playerB.client.getState().finished, 'a survivor sees match_end')
    // the lobby and session must be fully reclaimed once both have left
    await waitFor(() => server.stats().lobbies === 0, 'lobby destroyed')
    expect(server.stats().sessions).toBe(0)
    expect(a.errors).toHaveLength(0)
    expect(b.errors).toHaveLength(0)

    // both can immediately host brand-new lobbies on the same connections
    a.store.getState().createLobby('private', SETTINGS)
    b.store.getState().createLobby('private', SETTINGS)
    await waitFor(() => a.store.getState().lobby !== null, 'A re-creates')
    await waitFor(() => b.store.getState().lobby !== null, 'B re-creates')

    await closeClient(a)
    await closeClient(b)
  })

  it('duplicate leave presses send one leave and no spurious errors', { timeout: 30000 }, async () => {
    const { a, b, matchId } = await setupMatch()
    const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()

    // double-click: two leaveLobby calls back-to-back
    a.store.getState().leaveLobby()
    a.store.getState().leaveLobby()

    await waitFor(() => playerB.client.getState().finished, 'B sees match_end')
    expect(playerB.client.getState().error).toContain('MATCH WON')
    await waitFor(() => server.stats().sessions === 0, 'session reclaimed')
    expect(a.errors).toHaveLength(0)

    a.store.getState().createLobby('private', SETTINGS)
    await waitFor(() => a.store.getState().lobby !== null, 'A re-creates')

    await closeClient(a)
    await closeClient(b)
  })

  it('locks and snapshots landing after the opponent leaves are dropped silently, never error', { timeout: 30000 }, async () => {
    const { a, b, matchId } = await setupMatch()
    const playerA = makePlayer(matchId, a.conn, a.store, ['I', 'I'])
    await settle()

    tick(playerA, ['hardDrop']) // an in-flight placement lands while everyone is present
    expect(a.errors).toHaveLength(0)

    b.store.getState().leaveLobby()
    await waitFor(() => playerA.client.getState().finished, 'A sees match_end after B leaves')
    expect(playerA.client.getState().error).toContain('MATCH WON')

    // A keeps playing for a beat: locks/snapshots now land after the session
    // is gone and must be silently ignored, not answered with an error
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 0, 30)
    await settle(150)
    expect(a.errors).toHaveLength(0)
    expect(server.stats().sessions).toBe(0)

    await closeClient(a)
    await closeClient(b)
  })

  it('a disconnect landing exactly at match_end still ends the match cleanly', { timeout: 30000 }, async () => {
    const prev = setReconnectGraceMs(1000)
    const { a, b, matchId } = await setupMatch({ mode: 'firstToX', goal: 1, winBy: 2 })
    const playerA = makePlayer(matchId, a.conn, a.store, ['I'])
    const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()

    // B tops out and slams the socket shut: the disconnect races the topout.
    // B is buffered (reconnecting) but the match still ends — A won the round.
    playerB.client.sendTopout()
    await b.conn.close()

    await waitFor(() => playerA.client.getState().finished, 'A sees match_end')
    expect(playerA.client.getState().error).toContain('MATCH WON')
    await waitFor(() => server.stats().sessions === 0, 'session reclaimed')
    expect(server.stats().lobbies).toBe(1) // A + buffered B are still in the lobby
    await waitFor(() => a.store.getState().lobby!.players.find((p) => p.id === b.store.getState().selfId)?.reconnecting === true, 'A sees B reconnecting')
    expect(a.errors).toHaveLength(0)

    // A leaves (instant); B's buffered entry is pruned when its grace expires
    a.store.getState().leaveLobby()
    await waitFor(() => server.stats().lobbies === 0, 'lobby reclaimed after grace')
    expect(server.stats().sessions).toBe(0)
    setReconnectGraceMs(prev)

    await a.conn.close()
  })

  it('both players disconnecting mid-match leave zero state once the grace expires', { timeout: 30000 }, async () => {
    const prev = setReconnectGraceMs(200)
    const { a, b, matchId } = await setupMatch()
    makePlayer(matchId, a.conn, a.store, ['I'])
    makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()

    await Promise.all([a.conn.close(), b.conn.close()])
    await waitFor(() => server.stats().conns === 0, 'conns drained')
    // both are buffered (reconnecting), so the lobby + match survive the drop
    expect(server.stats().lobbies).toBe(1)
    expect(server.stats().sessions).toBe(1)
    // once the grace period passes both are pruned and everything is reclaimed
    await waitFor(() => server.stats().sessions === 0 && server.stats().lobbies === 0, 'state reclaimed after grace')
    setReconnectGraceMs(prev)
  })

  it('a leave mid-match in a 3-player game continues the match for the survivors', { timeout: 30000 }, async () => {
    const a = await setupClient('A')
    const b = await setupClient('B')
    const c = await setupClient('C')
    a.store.getState().createLobby('private', SETTINGS)
    await waitFor(() => a.store.getState().lobby !== null, 'A lobby')
    b.store.getState().joinLobby(a.store.getState().lobby!.code)
    c.store.getState().joinLobby(a.store.getState().lobby!.code)
    await waitFor(() => b.store.getState().lobby !== null && c.store.getState().lobby !== null, 'B and C joined')
    a.store.getState().startMatch()
    await waitFor(() => a.store.getState().match !== null, 'match started')
    const matchId = a.store.getState().match!.matchId
    const playerA = makePlayer(matchId, a.conn, a.store, ['T'])
    const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()

    // C leaves mid-match: the 1v1 must NOT end for A and B, and C must be gone
    c.store.getState().leaveLobby()
    await waitFor(() => playerA.client.getState().opponents[c.store.getState().selfId!]?.left === true, 'A sees C left')
    // C is pruned from both survivors' views: no frozen board remains
    expect(playerA.client.getState().opponents[c.store.getState().selfId!]!.board).toEqual([])
    expect(playerB.client.getState().opponents[c.store.getState().selfId!]!.board).toEqual([])
    expect(playerA.client.getState().finished).toBe(false)
    expect(playerB.client.getState().finished).toBe(false)
    expect(server.stats().sessions).toBe(1) // the match lives on for A and B

    // the survivors keep playing with no errors and no desync
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 0, 30)
    await waitFor(() => playerB.client.getState().opponents[a.store.getState().selfId!]?.board.length === 20, 'B sees A after C left')
    expect(serializeBoard(playerB.client.getState().opponents[a.store.getState().selfId!]!.board)).toBe(visible(playerA.game))
    expect(playerA.client.resyncs).toBe(0)
    expect(playerB.client.resyncs).toBe(0)
    expect(a.errors).toHaveLength(0)
    expect(b.errors).toHaveLength(0)

    // A and B leave; everything is reclaimed
    a.store.getState().leaveLobby()
    b.store.getState().leaveLobby()
    await waitFor(() => server.stats().lobbies === 0, 'lobby reclaimed')
    expect(server.stats().sessions).toBe(0)

    await closeClient(a)
    await closeClient(b)
    await closeClient(c)
  })

  it('an in-app connection drop reconnects and rejoins the match through the grace buffer', { timeout: 30000 }, async () => {
    const { a, b, matchId } = await setupMatch()
    const playerA = makePlayer(matchId, a.conn, a.store, ['I'])
    makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()

    // the server drops B's socket mid-match (a real network failure): B is
    // buffered, NOT forfeited — A must not see the match end
    server.kick(b.store.getState().selfId!)
    await waitFor(() => b.store.getState().match === null, 'B clears the stale match')
    await settle(100)
    expect(playerA.client.getState().finished).toBe(false)
    expect(server.stats().sessions).toBe(1)

    // B's store reconnects automatically; the server offers a rejoin and the
    // store auto-accepts it (the user never left the app, so no popup)
    await waitFor(() => b.store.getState().status === 'connected' && b.store.getState().match !== null, 'B rejoins the match')
    expect(b.store.getState().match!.matchId).toBe(matchId)
    expect(b.store.getState().pendingRejoin).toBeNull()
    expect(server.stats().sessions).toBe(1)
    expect(playerA.client.getState().finished).toBe(false)
    expect(b.errors).toHaveLength(0)

    // B plays again through the re-established connection: the board relays
    // to A and no spurious errors appear
    const playerB2 = makePlayer(matchId, b.conn, b.store, ['T'])
    await settle(200)
    tick(playerB2, ['hardDrop'])
    tick(playerB2, [], 0, 30)
    await settle(200)
    expect(b.errors).toHaveLength(0)
    await waitFor(() => playerA.client.getState().opponents[b.store.getState().selfId!]?.board.length === 20, 'A sees B again')
    expect(server.stats().sessions).toBe(1)

    await closeClient(a)
    await closeClient(b)
  })

  it('sending leave_lobby and immediately closing cannot double-remove or strand', { timeout: 30000 }, async () => {
    const { a, b, matchId } = await setupMatch()
    const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()

    a.store.getState().leaveLobby()
    await a.conn.close() // the close races the leave_lobby in flight

    await waitFor(() => playerB.client.getState().finished, 'B sees match_end')
    expect(server.stats().conns).toBe(1) // only B remains connected
    expect(server.stats().sessions).toBe(0)
    expect(b.errors).toHaveLength(0)

    b.store.getState().leaveLobby()
    await waitFor(() => server.stats().lobbies === 0, 'lobby reclaimed')
    expect(server.stats().sessions).toBe(0)
    await b.conn.close()
    await waitFor(() => server.stats().conns === 0, 'conns drained')
  })

  it('a refreshed client is offered a rejoin and can return to the live match', { timeout: 30000 }, async () => {
    const { a, b, matchId } = await setupMatch()
    const playerA = makePlayer(matchId, a.conn, a.store, ['I'])
    makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()

    // B "refreshes": the socket drops without any leave message, so the server
    // buffers B in the lobby + match for the grace period
    await b.conn.close()
    const oldBId = b.store.getState().selfId!
    await waitFor(() => a.store.getState().lobby!.players.find((p) => p.id === oldBId)?.reconnecting === true, 'A sees B reconnecting')

    // a brand-new client stack (fresh page load) presents B's persisted id
    const b2conn = new NetConnection()
    const b2 = createLobbyStore(b2conn)
    const b2errors: string[] = []
    b2conn.onMessage((msg) => {
      if (msg.type === 'error' && msg.code !== 'host_transferred' && msg.code !== 'connection_lost') b2errors.push(msg.message)
    })
    b2.getState().setName('B')
    b2.setState({ selfId: oldBId })
    b2.getState().connect(url)
    await waitFor(() => b2.getState().status === 'connected', 'B2 connected')

    // fresh load: the server offers the rejoin and the client surfaces a popup
    // instead of auto-joining
    await waitFor(() => b2.getState().pendingRejoin !== null, 'B2 offered the rejoin')
    expect(b2.getState().pendingRejoin!.lobbyCode).toBe(a.store.getState().lobby!.code)
    expect(b2.getState().pendingRejoin!.matchActive).toBe(true)
    expect(b2.getState().lobby).toBeNull() // not joined yet — the choice is pending

    // accepting returns B to the lobby and the live match
    b2.getState().rejoinGame()
    await waitFor(() => b2.getState().lobby !== null && b2.getState().match !== null, 'B2 rejoined the match')
    expect(b2.getState().match!.matchId).toBe(matchId)
    expect(b2.getState().pendingRejoin).toBeNull()
    await waitFor(() => a.store.getState().lobby!.players.find((p) => p.id === oldBId)?.reconnecting === false, 'reconnecting cleared')
    expect(server.stats().sessions).toBe(1)
    expect(playerA.client.getState().finished).toBe(false)

    // B plays again through the fresh stack: relays flow, no errors
    const playerB2 = makePlayer(matchId, b2conn, b2, ['T'])
    await settle(200)
    tick(playerB2, ['hardDrop'])
    tick(playerB2, [], 0, 30)
    await settle(200)
    expect(b2errors).toHaveLength(0)
    await waitFor(() => playerA.client.getState().opponents[oldBId]?.board.length === 20, 'A sees B2 board')

    await closeClient(a)
    // b2 is a raw store (not a ClientStack): leave cleanly, then close
    if (b2.getState().lobby || b2.getState().match) b2.getState().leaveLobby()
    await settle(50)
    await b2conn.close()
  })

  it('declining the rejoin popup prunes the player instantly', { timeout: 30000 }, async () => {
    const { a, b, matchId } = await setupMatch()
    const playerA = makePlayer(matchId, a.conn, a.store, ['I'])
    makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()

    // B's tab closes; a fresh load presents the old id and gets the offer
    await b.conn.close()
    const oldBId = b.store.getState().selfId!
    await waitFor(() => a.store.getState().lobby!.players.find((p) => p.id === oldBId)?.reconnecting === true, 'A sees B reconnecting')

    const b2conn = new NetConnection()
    const b2 = createLobbyStore(b2conn)
    b2.getState().setName('B')
    b2.setState({ selfId: oldBId })
    b2.getState().connect(url)
    await waitFor(() => b2.getState().pendingRejoin !== null, 'B2 offered the rejoin')

    // DISMISS: the player chose not to come back, so the server prunes them
    // right away (no grace wait) — the 1v1 resolves for A
    b2.getState().dismissRejoin()
    await waitFor(() => playerA.client.getState().finished, 'A sees match_end')
    expect(playerA.client.getState().error).toContain('MATCH WON')
    await waitFor(() => server.stats().sessions === 0, 'session reclaimed')
    expect(b2.getState().lobby).toBeNull()
    expect(b2.getState().match).toBeNull()
    await waitFor(() => a.store.getState().lobby!.players.some((p) => p.id === oldBId) === false, 'B pruned from the roster')

    await closeClient(a)
    await b2conn.close()
  })

  it('a second refresh while a rejoin offer is pending keeps the live claimer fully routed', { timeout: 30000 }, async () => {
    const { a, b, matchId } = await setupMatch()
    const playerA = makePlayer(matchId, a.conn, a.store, ['I'])
    makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()

    // B's tab drops; the server buffers B for the grace period
    await b.conn.close()
    const oldBId = b.store.getState().selfId!
    await waitFor(() => a.store.getState().lobby!.players.find((p) => p.id === oldBId)?.reconnecting === true, 'A sees B reconnecting')

    // first refresh: B2 presents the old id and is offered the rejoin (popup)
    const b2conn = new NetConnection()
    const b2 = createLobbyStore(b2conn)
    b2.getState().setName('B')
    b2.setState({ selfId: oldBId })
    b2.getState().connect(url)
    await waitFor(() => b2.getState().pendingRejoin !== null, 'B2 offered the rejoin')

    // second refresh before acting on the offer: B3 presents the same id
    const b3conn = new NetConnection()
    const b3 = createLobbyStore(b3conn)
    const b3errors: string[] = []
    b3conn.onMessage((msg) => {
      if (msg.type === 'error' && msg.code !== 'host_transferred' && msg.code !== 'connection_lost') b3errors.push(msg.message)
    })
    b3.getState().setName('B')
    b3.setState({ selfId: oldBId })
    b3.getState().connect(url)
    await waitFor(() => b3.getState().pendingRejoin !== null, 'B3 offered the rejoin')

    // the stale first claimer's socket dies: its close must NOT yank the live
    // claimer's routing entry, or B3 silently stops receiving every broadcast
    // (roster updates, opponent board relays, garbage) while its own messages
    // still reach the server — a one-way desync
    await b2conn.close()

    // B3 accepts the rejoin and the match must keep flowing to it
    b3.getState().rejoinGame()
    await waitFor(() => b3.getState().lobby !== null && b3.getState().match !== null, 'B3 rejoined the match')
    expect(b3.getState().match!.matchId).toBe(matchId)
    await waitFor(() => a.store.getState().lobby!.players.find((p) => p.id === oldBId)?.reconnecting === false, 'reconnecting cleared')

    // A places a piece: its board relay (routed through B3's conn entry) must reach B3
    const playerB3 = makePlayer(matchId, b3conn, b3, ['T'])
    await settle(200)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 0, 30)
    await waitFor(() => playerB3.client.getState().opponents[a.store.getState().selfId!]?.board.length === 20, 'B3 sees A board relay')
    expect(b3errors).toHaveLength(0)

    await closeClient(a)
    if (b3.getState().lobby || b3.getState().match) b3.getState().leaveLobby()
    await settle(50)
    await b3conn.close()
  })

  it('a refresh presenting ANOTHER live player\'s id must not hijack their board', { timeout: 30000 }, async () => {
    const prevClaim = setClaimWindowMs(150)
    try {
      const { a, b, matchId } = await setupMatch()
      const playerA = makePlayer(matchId, a.conn, a.store, ['I'])
      const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
      await settle()
      const aId = a.store.getState().selfId!
      const bId = b.store.getState().selfId!

      // both players relay once so A's view of B and B's board exist
      tick(playerA, ['hardDrop'])
      tick(playerA, [], 0, 30)
      tick(playerB, ['hardDrop'])
      tick(playerB, [], 0, 30)
      await settle(200)
      await waitFor(() => playerA.client.getState().opponents[bId]?.board.length === 20, 'A sees B board')
      expect(playerA.client.resyncs).toBe(0)

      // B's tab shared its per-origin localStorage with A's tab (two tabs, one
      // browser), so B's refresh presents A's id as its own rejoinId. A's socket
      // stays open the whole time — a legit refresh's own close would land, but
      // here it never does.
      const b2conn = new NetConnection()
      const b2 = createLobbyStore(b2conn)
      const b2errors: string[] = []
      b2conn.onMessage((msg) => {
        if (msg.type === 'error' && msg.code !== 'host_transferred' && msg.code !== 'connection_lost') b2errors.push(msg.message)
      })
      b2.getState().setName('B')
      b2.setState({ selfId: aId }) // corrupted: presenting the HOST's id
      b2.getState().connect(url)
      await waitFor(() => b2.getState().status === 'connected', 'B2 connected')

      // B2 must NOT be granted the host's identity: it is a brand-new player
      // (fresh id), gets no rejoin offer, no match, no lobby
      expect(b2.getState().selfId).not.toBe(aId)
      expect(b2.getState().pendingRejoin).toBeNull()
      expect(b2.getState().match).toBeNull()
      expect(b2.getState().lobby).toBeNull()

      // the host is untouched: still in the match, no board resync (B2 never
      // modified A's authority), and A still sees B's own board
      expect(playerA.client.getState().finished).toBe(false)
      expect(playerA.client.resyncs).toBe(0)
      expect(playerA.client.getState().opponents[bId]?.board.length).toBe(20)
      expect(server.stats().sessions).toBe(1)

      // B2 cannot even rejoin as A: no offer was made, nothing to accept
      b2.getState().rejoinGame()
      await settle(100)
      expect(b2.getState().match).toBeNull()
      expect(b2.getState().lobby).toBeNull()
      expect(b2errors).toHaveLength(0)

      await closeClient(a)
      await closeClient(b)
      await b2conn.close()
    } finally {
      setClaimWindowMs(prevClaim)
    }
  })

  it('a rejoin offer is still actionable after the original disconnect grace expires', { timeout: 30000 }, async () => {
    const prev = setReconnectGraceMs(200)
    try {
      const { a, b, matchId } = await setupMatch()
      await settle()

      await b.conn.close()
      const oldBId = b.store.getState().selfId!
      await waitFor(() => a.store.getState().lobby!.players.find((p) => p.id === oldBId)?.reconnecting === true, 'A sees B reconnecting')

      // the refresh lands late in the grace window (100ms of the 200ms gone)
      await settle(100)
      const b2conn = new NetConnection()
      const b2 = createLobbyStore(b2conn)
      b2.getState().setName('B')
      b2.setState({ selfId: oldBId })
      b2.getState().connect(url)
      await waitFor(() => b2.getState().pendingRejoin !== null, 'B2 offered the rejoin')

      // wait past the disconnect-based grace: the popup is still up and the
      // offer must give the player its own full window to decide, so REJOIN
      // still works instead of silently doing nothing
      await settle(160)
      b2.getState().rejoinGame()
      await waitFor(() => b2.getState().lobby !== null && b2.getState().match !== null, 'B2 rejoined after the original grace')
      expect(b2.getState().match!.matchId).toBe(matchId)

      await closeClient(a)
      if (b2.getState().lobby || b2.getState().match) b2.getState().leaveLobby()
      await settle(50)
      await b2conn.close()
    } finally {
      setReconnectGraceMs(prev)
    }
  })

  it('a refresh whose new socket beats its own close still gets the rejoin popup and never duplicates the member', { timeout: 30000 }, async () => {
    const { a, b, matchId } = await setupMatch()
    const playerA = makePlayer(matchId, a.conn, a.store, ['I'])
    makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()
    const oldBId = b.store.getState().selfId!

    // Simulate a refresh whose new socket arrives BEFORE the old socket's close
    // is processed: the old socket is still open (still in conns under oldBId),
    // so buffered does not contain the id yet. Previously this made the server
    // treat the reconnect as a brand-new player: no rejoin_offer (no popup) and
    // a fresh id that could re-join as a duplicate "reconnecting" copy.
    const b2conn = new NetConnection()
    const b2 = createLobbyStore(b2conn)
    const b2errors: string[] = []
    b2conn.onMessage((msg) => {
      if (msg.type === 'error' && msg.code !== 'host_transferred' && msg.code !== 'connection_lost') b2errors.push(msg.message)
    })
    b2.getState().setName('B')
    b2.setState({ selfId: oldBId })
    b2.getState().connect(url)
    // the new socket beat its own close: B is still a LIVE member, so the server
    // holds the claim (no welcome yet — it must not hand out a live identity to
    // a socket that might not be this member's own refresh)
    await settle(50)
    expect(b2.getState().status).toBe('connecting')

    // the delayed original close lands: the claim completes — identity preserved,
    // rejoin offer issued (the popup it missed before)
    await b.conn.close()
    await waitFor(() => b2.getState().status === 'connected', 'B2 connected')
    expect(b2.getState().pendingRejoin).not.toBeNull()
    expect(b2.getState().pendingRejoin!.lobbyCode).toBe(a.store.getState().lobby!.code)
    expect(b2.getState().selfId).toBe(oldBId) // identity preserved, no fresh id

    // accepting returns B to the live match with exactly ONE member (no duplicate)
    expect(a.store.getState().lobby!.players.filter((p) => p.id === oldBId)).toHaveLength(1)
    b2.getState().rejoinGame()
    await waitFor(() => b2.getState().lobby !== null && b2.getState().match !== null, 'B2 rejoined the match')
    expect(b2.getState().match!.matchId).toBe(matchId)
    expect(a.store.getState().lobby!.players.filter((p) => p.id === oldBId)).toHaveLength(1)
    await waitFor(() => a.store.getState().lobby!.players.find((p) => p.id === oldBId)?.reconnecting === false, 'reconnecting cleared')
    expect(b2errors).toHaveLength(0)

    // B2 plays again through the fresh stack; the board relays to A
    const playerB2 = makePlayer(matchId, b2conn, b2, ['T'])
    await settle(150)
    tick(playerB2, ['hardDrop'])
    tick(playerB2, [], 0, 30)
    await settle(150)
    await waitFor(() => playerA.client.getState().opponents[oldBId]?.board.length === 20, 'A sees B2 board')
    expect(playerA.client.getState().finished).toBe(false)
    // no re-buffer / re-mark of the member from the completed claim, no second copy
    expect(a.store.getState().lobby!.players.filter((p) => p.id === oldBId)).toHaveLength(1)
    expect(a.store.getState().lobby!.players.find((p) => p.id === oldBId)?.reconnecting).toBe(false)
    expect(server.stats().sessions).toBe(1)

    await closeClient(a)
    if (b2.getState().lobby || b2.getState().match) b2.getState().leaveLobby()
    await settle(50)
    await b2conn.close()
  })
})

describe('spectating and AFK through the real stack', () => {
  it('a spectator chosen in the lobby is skipped as a target and cannot toggle in-game', { timeout: 30000 }, async () => {
    const a = await setupClient('A')
    const b = await setupClient('B')
    const c = await setupClient('C')
    a.store.getState().createLobby('private', SETTINGS)
    await waitFor(() => a.store.getState().lobby !== null, 'A lobby')
    b.store.getState().joinLobby(a.store.getState().lobby!.code)
    c.store.getState().joinLobby(a.store.getState().lobby!.code)
    await waitFor(() => b.store.getState().lobby !== null && c.store.getState().lobby !== null, 'B and C joined')
    // B chooses to watch from the lobby; the roster reflects it
    b.store.getState().setSpectating(true)
    await waitFor(() => a.store.getState().lobby!.players.find((p) => p.id === b.store.getState().selfId)?.spectating === true, 'roster shows B spectating')
    a.store.getState().startMatch()
    await waitFor(() => a.store.getState().match !== null && b.store.getState().match !== null && c.store.getState().match !== null, 'match started')
    const matchId = a.store.getState().match!.matchId
    const playerA = makePlayer(matchId, a.conn, a.store, ['I', 'I', 'I', 'I', 'I', 'O'])
    const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
    const playerC = makePlayer(matchId, c.conn, c.store, ['T'])
    await settle()

    // B's client is a spectator (server-driven), and the players see it
    await waitFor(() => playerB.client.getState().spectating === true, 'B client spectating')
    await waitFor(() => playerA.client.getState().opponents[b.store.getState().selfId!]?.spectating === true, 'A sees B spectating')

    // in-game role changes are refused
    b.store.getState().setSpectating(false)
    await settle(150)
    expect(b.errors).toContain('role is locked once the match starts')
    expect(playerB.client.getState().spectating).toBe(true)

    // A builds a double (hold I, then I x4 + O = 2 rows, also a perfect clear
    // -> 10 lines): with B spectating, the attack must route to C, never B
    tick(playerA, ['hold'])
    tick(playerA, [], -1, 14)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 1, 1)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], -1, 14)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 1, 1)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 1, 15)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 0, 30)

    await waitFor(() => playerC.game.pendingGarbage === 10, 'C receives garbage (B skipped)')
    expect(playerB.game.pendingGarbage).toBe(0)
    expect(a.errors).toHaveLength(0)
    expect(playerA.client.getState().finished).toBe(false)

    await closeClient(a)
    await closeClient(b)
    await closeClient(c)
  })

  it('a 2-player lobby with a spectator cannot start until someone plays', { timeout: 30000 }, async () => {
    const a = await setupClient('A')
    const b = await setupClient('B')
    a.store.getState().createLobby('private', SETTINGS)
    await waitFor(() => a.store.getState().lobby !== null, 'A lobby')
    b.store.getState().joinLobby(a.store.getState().lobby!.code)
    await waitFor(() => b.store.getState().lobby !== null, 'B lobby')
    b.store.getState().setSpectating(true)
    await settle(100)
    a.store.getState().startMatch()
    await waitFor(() => a.errors.length > 0, 'start rejected')
    expect(a.store.getState().match).toBeNull()
    // B returns to playing: the host can start
    b.store.getState().setSpectating(false)
    await settle(100)
    a.store.getState().startMatch()
    await waitFor(() => a.store.getState().match !== null, 'match starts after B plays')
    await closeClient(a)
    await closeClient(b)
  })

  it('a player who dies in an ongoing N>2 game automatically becomes a spectator', { timeout: 30000 }, async () => {
    const a = await setupClient('A')
    const b = await setupClient('B')
    const c = await setupClient('C')
    a.store.getState().createLobby('private', SETTINGS)
    await waitFor(() => a.store.getState().lobby !== null, 'A lobby')
    b.store.getState().joinLobby(a.store.getState().lobby!.code)
    c.store.getState().joinLobby(a.store.getState().lobby!.code)
    await waitFor(() => b.store.getState().lobby !== null && c.store.getState().lobby !== null, 'B and C joined')
    a.store.getState().startMatch()
    await waitFor(() => a.store.getState().match !== null, 'match started')
    const matchId = a.store.getState().match!.matchId
    const playerA = makePlayer(matchId, a.conn, a.store, ['I', 'I', 'I', 'I', 'I', 'O'])
    const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
    const playerC = makePlayer(matchId, c.conn, c.store, ['T'])
    await settle()

    // C tops out while A and B are still playing: C auto-spectates
    playerC.client.sendTopout()
    await waitFor(() => playerC.client.getState().spectating === true, 'C client spectating')
    await waitFor(() => playerA.client.getState().opponents[c.store.getState().selfId!]?.spectating === true, 'A sees C spectating')
    expect(playerA.client.getState().finished).toBe(false)
    expect(playerB.client.getState().finished).toBe(false)

    // A's attack now routes to B only (C is a spectator)
    tick(playerA, ['hold'])
    tick(playerA, [], -1, 14)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 1, 1)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], -1, 14)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 1, 1)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 1, 15)
    tick(playerA, ['hardDrop'])
    tick(playerA, [], 0, 30)
    await waitFor(() => playerB.game.pendingGarbage === 10, 'B receives garbage (C skipped)')
    expect(playerC.game.pendingGarbage).toBe(0)

    await closeClient(a)
    await closeClient(b)
    await closeClient(c)
  })

  it('LEAVE mid-match = AFK: out of the game but able to return or fully leave', { timeout: 30000 }, async () => {
    const a = await setupClient('A')
    const b = await setupClient('B')
    const c = await setupClient('C')
    a.store.getState().createLobby('private', SETTINGS)
    await waitFor(() => a.store.getState().lobby !== null, 'A lobby')
    b.store.getState().joinLobby(a.store.getState().lobby!.code)
    c.store.getState().joinLobby(a.store.getState().lobby!.code)
    await waitFor(() => b.store.getState().lobby !== null && c.store.getState().lobby !== null, 'B and C joined')
    a.store.getState().startMatch()
    await waitFor(() => a.store.getState().match !== null, 'match started')
    const matchId = a.store.getState().match!.matchId
    const playerA = makePlayer(matchId, a.conn, a.store, ['T'])
    const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
    const playerC = makePlayer(matchId, c.conn, c.store, ['T'])
    await settle()

    // A presses LEAVE: out of the match, still in the lobby, marked AFK
    a.store.getState().goAfk()
    await waitFor(() => a.store.getState().match === null && a.store.getState().lobby !== null, 'A back in the lobby')
    await waitFor(() => a.store.getState().lobby!.players.find((p) => p.id === a.store.getState().selfId)?.afk === true, 'A marked AFK')
    // B and C see A AFK with the board pruned; the match continues for them
    await waitFor(() => playerB.client.getState().opponents[a.store.getState().selfId!]?.afk === true, 'B sees A AFK')
    expect(playerB.client.getState().opponents[a.store.getState().selfId!]!.board).toEqual([])
    expect(playerA.client.getState().finished).toBe(false)
    expect(playerB.client.getState().finished).toBe(false)
    expect(playerC.client.getState().finished).toBe(false)

    // A returns to the game: rejoins as a player (match_start re-sent)
    a.store.getState().returnToGame()
    await waitFor(() => a.store.getState().match !== null, 'A rejoins the match')
    expect(a.store.getState().lobby!.players.find((p) => p.id === a.store.getState().selfId)?.afk).toBe(false)
    await waitFor(() => playerB.client.getState().opponents[a.store.getState().selfId!]?.afk === false, 'B sees A back')
    const playerA2 = makePlayer(a.store.getState().match!.matchId, a.conn, a.store, ['T'])
    await settle()
    // A plays again: a placement is accepted with no errors or resyncs
    tick(playerA2, ['hardDrop'])
    await settle(150)
    expect(a.errors).toHaveLength(0)
    expect(playerA2.client.resyncs).toBe(0)

    // A goes AFK again and fully leaves the lobby: completely pruned
    a.store.getState().goAfk()
    await waitFor(() => a.store.getState().match === null, 'A AFK again')
    a.store.getState().leaveLobby()
    await waitFor(() => a.store.getState().lobby === null, 'A fully leaves')
    await waitFor(() => b.store.getState().lobby!.players.some((p) => p.id === a.store.getState().selfId) === false, 'B sees A pruned')

    await closeClient(a)
    await closeClient(b)
    await closeClient(c)
  })

  it('LEAVE mid-match in a 1v1 ends the match for the other player', { timeout: 30000 }, async () => {
    const { a, b, matchId } = await setupMatch()
    makePlayer(matchId, a.conn, a.store, ['T'])
    const playerB = makePlayer(matchId, b.conn, b.store, ['T'])
    await settle()

    // A presses LEAVE (AFK): the 1v1 resolves — B wins the match
    a.store.getState().goAfk()
    await waitFor(() => playerB.client.getState().finished, 'B sees match_end')
    expect(playerB.client.getState().error).toContain('MATCH WON')
    await waitFor(() => server.stats().sessions === 0, 'session reclaimed')
    // A is AFK in the lobby, not pruned
    await waitFor(() => a.store.getState().lobby!.players.find((p) => p.id === a.store.getState().selfId)?.afk === true, 'A marked AFK')
    expect(a.store.getState().match).toBeNull()
    expect(a.errors).toHaveLength(0)
    // returning after the match ended just unmarks AFK (no active match to rejoin)
    a.store.getState().returnToGame()
    await settle(100)
    expect(a.store.getState().match).toBeNull()
    expect(a.store.getState().lobby!.players.find((p) => p.id === a.store.getState().selfId)?.afk).toBe(false)

    await closeClient(a)
    await closeClient(b)
  })
})

describe('live lobby list through the real stack', () => {
  it('a lobby created on another client appears live, tracks player count, and disappears on leave', { timeout: 30000 }, async () => {
    // A sits on the multiplayer screen, not in any lobby
    const a = await setupClient('A')
    const b = await setupClient('B')
    const c = await setupClient('C')
    const d = await setupClient('D')

    // B creates a public lobby: A's list must update with no refresh
    b.store.getState().createLobby('public', SETTINGS)
    await waitFor(() => b.store.getState().lobby !== null, 'B in lobby')
    const code = b.store.getState().lobby!.code
    await waitFor(() => a.store.getState().lobbies.some((l) => l.code === code), 'A sees B\'s lobby live')
    let entry = a.store.getState().lobbies.find((l) => l.code === code)!
    expect(entry.hostName).toBe('B')
    expect(entry.playerCount).toBe(1)

    // C joins: the count on A's list updates live
    c.store.getState().joinLobby(code)
    await waitFor(() => a.store.getState().lobbies.find((l) => l.code === code)?.playerCount === 2, 'A sees the count rise')

    // a private lobby never leaks into the public list
    d.store.getState().createLobby('private', SETTINGS)
    await waitFor(() => d.store.getState().lobby !== null, 'D in lobby')
    const privateCode = d.store.getState().lobby!.code
    await settle()
    expect(a.store.getState().lobbies.some((l) => l.code === privateCode)).toBe(false)

    // B (host) leaves: the lobby shrinks to 1p on A's list and the host
    // transfers to C — it only disappears when the last member leaves
    b.store.getState().leaveLobby()
    await waitFor(() => a.store.getState().lobbies.find((l) => l.code === code)?.playerCount === 1, 'A sees the count drop')
    expect(a.store.getState().lobbies.find((l) => l.code === code)!.hostName).toBe('C')
    await waitFor(() => c.store.getState().lobby?.hostId === c.store.getState().selfId, 'C becomes host')

    c.store.getState().leaveLobby()
    await waitFor(() => !a.store.getState().lobbies.some((l) => l.code === code), 'A sees the lobby disappear')
    await waitFor(() => c.store.getState().lobby === null, 'C falls back to the list')

    // nobody saw spurious errors along the way
    expect(a.errors).toHaveLength(0)
    expect(b.errors).toHaveLength(0)
    expect(c.errors).toHaveLength(0)
    expect(d.errors).toHaveLength(0)

    await closeClient(a)
    await closeClient(b)
    await closeClient(c)
    await closeClient(d)
  })

  it('the list still populates when refresh races the connect (mount race)', { timeout: 30000 }, async () => {
    // seed a public lobby so there is something to list
    const seed = await setupClient('SEED')
    seed.store.getState().createLobby('public', SETTINGS)
    await waitFor(() => seed.store.getState().lobby !== null, 'seed lobby')
    const code = seed.store.getState().lobby!.code

    // a fresh client reproduces the MultiplayerScreen mount effect: connect()
    // and refreshLobbies() fire together, so the refresh lands on a socket
    // that is not open yet and is silently dropped
    const conn = new NetConnection()
    const store = createLobbyStore(conn)
    store.getState().setName('R')
    store.getState().connect(url)
    store.getState().refreshLobbies() // dropped: socket still connecting

    await waitFor(() => store.getState().status === 'connected', 'R connected')
    // the welcome-triggered fetch fills the list without any manual refresh
    await waitFor(() => store.getState().lobbies.some((l) => l.code === code), 'R sees the seeded lobby')
    expect(store.getState().lobbies.find((l) => l.code === code)!.playerCount).toBe(1)

    await conn.close()
    await closeClient(seed)
  })
})
