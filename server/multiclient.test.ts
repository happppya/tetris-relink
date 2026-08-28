import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { startServer, type ServerHandle } from './index.ts'
import { connectSimulatedClient, type SimulatedClient } from './test-client.ts'
import { emptyBoard, serializeBoard } from '../shared/board.ts'
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

  it('runs create, join, match, garbage, and resync through sockets', async () => {
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
    expect(await guestMatch).toMatchObject({ matchId: started.matchId })

    const targetUpdate = host.waitFor('target_update')
    host.send({ type: 'target', mode: 'manual', targetId: guestMatchState.players.find((player) => player.name === 'GUEST')!.id })
    expect(await targetUpdate).toMatchObject({ mode: 'manual' })

    const garbage = guest.waitFor('garbage')
    host.send({ type: 'lock', lock: { rows: 4, spin: 'none', piece: 'I', perfectClear: false, combo: 0, b2b: false, streak: 0 } })
    expect(await garbage).toMatchObject({ lines: 4, hole: 0 })

    const resync = guest.waitFor('resync')
    guest.send({ type: 'snapshot', board: serializeBoard(emptyBoard()), score: 0, seq: 1, matchId: started.matchId })
    const authoritative = await resync
    expect(authoritative).toMatchObject({ type: 'resync', pendingGarbage: 0, score: 0 })

    const ack = guest.waitFor('snapshot_ack')
    guest.send({ type: 'snapshot', board: authoritative.board, score: 0, seq: 2, matchId: started.matchId })
    expect(await ack).toMatchObject({ seq: 2 })
  })

  afterAll(async () => {
    await host?.close()
    await guest?.close()
  })
})
