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
  url = `ws://localhost:${(server.server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await server.close()
})

async function startMatch(host: SimulatedClient, guest: SimulatedClient, existing?: LobbyState) {
  let lobby = existing
  if (!lobby) {
    const created = host.waitFor('lobby_state')
    host.send({ type: 'create_lobby', name: 'HOST', visibility: 'private', settings: { mode: 'firstToX', goal: 1, winBy: 2 } })
    lobby = lobbyOf(await created)

    const joined = guest.waitFor('lobby_state')
    guest.send({ type: 'join_lobby', code: lobby.code })
    await joined
  }

  const hostMatch = host.waitFor('match_start')
  const guestMatch = guest.waitFor('match_start')
  host.send({ type: 'start_match' })
  const [started] = await Promise.all([hostMatch, guestMatch])
  return { lobby, started }
}

describe('a second match in the same lobby', () => {
  let host: SimulatedClient
  let guest: SimulatedClient

  afterAll(async () => {
    await host?.close()
    await guest?.close()
  })

  it('routes locks and snapshots to the active match, never the finished one', async () => {
    host = await connectSimulatedClient(url, 'HOST')
    guest = await connectSimulatedClient(url, 'GUEST')

    const { lobby: firstLobby, started } = await startMatch(host, guest)
    const guestId = started.players.find((player) => player.name === 'GUEST')!.id

    // Match 1: the guest tops out, so the host wins the single game and the
    // match ends immediately (goal is 1). Both clients return to the lobby.
    const hostEnd = host.waitFor('match_end')
    const guestEnd = guest.waitFor('match_end')
    guest.send({ type: 'topout', matchId: started.matchId })
    await Promise.all([hostEnd, guestEnd])

    // Match 2 starts in the same lobby (both players returned to it).
    const second = await startMatch(host, guest, firstLobby)

    // The guest places a non-clearing piece and reports a matching snapshot.
    // A healthy client must be acknowledged — never corrected with a resync
    // against the fresh authority board of the *active* match.
    const cells = [{ x: 3, y: 19 }, { x: 4, y: 19 }]
    const board = emptyBoard().map((row, i) => {
      if (i !== 19) return row
      const r = [...row]
      r[3] = 'O'
      r[4] = 'O'
      return r
    })

    const resync = guest.waitFor('resync')
    const ack = guest.waitFor('snapshot_ack')
    guest.send({ type: 'lock', lock: { rows: 0, spin: 'none', piece: 'O', perfectClear: false, combo: 0, b2b: false, streak: 0, cells } })
    guest.send({ type: 'snapshot', board: serializeBoard(board), score: 0, seq: 1, matchId: second.started.matchId })

    expect((await ack).seq).toBe(1)
    await expect(resync).rejects.toThrow('timeout waiting for resync')
    expect(guestId).toBeTruthy()
  })
})
