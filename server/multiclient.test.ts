import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { startServer, type ServerHandle } from './index.ts'
import { connectSimulatedClient, type SimulatedClient } from './test-client.ts'
import { emptyBoard, serializeBoard } from '../shared/board.ts'
import { applyLock, createAuthority, serializeAuthority } from './authority.ts'
import type { LobbyState } from '../shared/protocol.ts'

let server: ServerHandle
let url: string

const lobbyOf = (message: { type: 'lobby_state'; lobby: LobbyState }): LobbyState => message.lobby

beforeAll(async () => {
  server = startServer(0)
  for (let i = 0; i < 50 && !server.server.address(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
  const port = (server.server.address() as AddressInfo).port
  url = `ws://localhost:${port}`
})

afterAll(async () => {
  await server.close()
})

describe('simulated multiplayer clients', () => {
  let host: SimulatedClient
  let guest: SimulatedClient

  it('reconstructs boards from authoritative locks and resyncs a diverged client', async () => {
    host = await connectSimulatedClient(url, 'HOST')
    guest = await connectSimulatedClient(url, 'GUEST')

    const created = host.waitFor('lobby_state')
    host.send({ type: 'create_lobby', name: 'HOST', visibility: 'private', settings: { mode: 'firstToX', goal: 3, winBy: 2 } })
    const lobby = lobbyOf(await created)

    const joined = guest.waitFor('lobby_state')
    guest.send({ type: 'join_lobby', code: lobby.code })
    expect(lobbyOf(await joined).players).toHaveLength(2)

    const hostMatch = host.waitFor('match_start')
    const guestMatch = guest.waitFor('match_start')
    host.send({ type: 'start_match' })
    const started = await hostMatch
    const guestMatchState = await guestMatch
    expect(guestMatchState.matchId).toBe(started.matchId)
    const hostId = started.players.find((p) => p.name === 'HOST')!.id
    const guestId = started.players.find((p) => p.name === 'GUEST')!.id

    const targetUpdate = host.waitFor('target_update')
    host.send({ type: 'target', mode: 'manual', targetId: guestId })
    expect(await targetUpdate).toMatchObject({ mode: 'manual', targetId: guestId })

    // A full bottom row, reported as a tetris: the server reconstructs the board
    // from these cells, clears the row, and forwards the surplus attack to guest.
    const cells = Array.from({ length: 10 }, (_, x) => ({ x, y: 19 }))
    const authority = createAuthority()
    const outcome = applyLock(authority, { cells, rows: 4, spin: 'none', piece: 'I', combo: 0, b2b: false, streak: 0 })

    const garbage = guest.waitFor('garbage')
    host.send({
      type: 'lock',
      lock: { rows: 4, spin: 'none', piece: 'I', perfectClear: false, combo: 0, b2b: false, streak: 0, cells },
    })
    const sent = await garbage
    expect(sent.from).toBe(hostId)
    expect(sent.lines).toBe(outcome.surplus)

    // A snapshot matching the reconstructed authoritative board is acknowledged,
    // never overwritten by a resync.
    const hostBoard = serializeAuthority(authority)
    const ack = host.waitFor('snapshot_ack')
    host.send({ type: 'snapshot', board: hostBoard, score: outcome.total, seq: 1, matchId: started.matchId })
    expect((await ack).seq).toBe(1)

    // Opponents see the player's real board via the server's relay (board_update).
    const boardRelay = guest.waitFor('board_update')
    host.send({ type: 'snapshot', board: hostBoard, score: outcome.total, seq: 2, matchId: started.matchId })
    const relayed = await boardRelay
    expect(relayed.playerId).toBe(hostId)
    expect(relayed.board).toBe(hostBoard)

    // A genuinely diverged client board is detected and corrected with a real
    // resync carrying the server-authoritative board.
    const stacked = serializeBoard(emptyBoard().map((row, i) => (i === 19 ? ['T', ...row.slice(1)] : row)))
    const resync = guest.waitFor('resync')
    guest.send({ type: 'snapshot', board: stacked, score: 0, seq: 1, matchId: started.matchId })
    const healed = await resync
    // The guest never placed anything, so its authoritative board is empty.
    expect(healed.board).toBe(serializeBoard(emptyBoard()))
  })

  afterAll(async () => {
    await host?.close()
    await guest?.close()
  })
})