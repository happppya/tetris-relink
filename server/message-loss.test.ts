import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { startServer, type ServerHandle } from './index.ts'
import { LossyProxy } from './lossyproxy.ts'
import { emptyBoard, serializeBoard } from '../shared/board.ts'
import { applyLock, createAuthority } from './authority.ts'
import type { LobbyState, ServerMessage } from '../shared/protocol.ts'

const lobbyStateOf = (m: ServerMessage): LobbyState => (m as { type: 'lobby_state'; lobby: LobbyState }).lobby

let handle: ServerHandle
let proxy: LossyProxy
let proxyPort: number

beforeAll(async () => {
  handle = startServer(0)
  const httpServer = handle.server
  for (let i = 0; i < 50 && !httpServer.address(); i++) await new Promise((r) => setTimeout(r, 10))
  const serverPort = (httpServer.address() as AddressInfo).port
  // Simulated message loss: every `garbage` message the server sends is dropped.
  // Control messages (lobby_state, match_start, snapshot_ack, resync, board_update)
  // pass through, isolating the desync mechanism from flaky setup.
  proxy = new LossyProxy(serverPort, 1.0, () => 0, ['garbage'])
  proxy.listen(0)
  for (let i = 0; i < 50 && !proxy.server.address(); i++) await new Promise((r) => setTimeout(r, 10))
  proxyPort = (proxy.server.address() as AddressInfo).port
})

afterAll(async () => {
  proxy.close()
  await handle.close()
})

import { connectSimulatedClient } from './test-client.ts'

describe('message loss over the proxy', () => {
  it('heals a dropped garbage via a real resync (zero silent desync)', async () => {
    const host = await connectSimulatedClient(`ws://localhost:${proxyPort}`, 'HOST')
    const guest = await connectSimulatedClient(`ws://localhost:${proxyPort}`, 'GUEST')

    const hostStateP = host.waitFor('lobby_state')
    host.send({ type: 'create_lobby', name: 'HOST', visibility: 'public', settings: { mode: 'firstToX', goal: 7, winBy: 2 } })
    const hostState = lobbyStateOf(await hostStateP)
    const guestStateP = guest.waitFor('lobby_state')
    guest.send({ type: 'join_lobby', code: hostState.code })
    await guestStateP
    const hostStartP = host.waitFor('match_start')
    const guestStartP = guest.waitFor('match_start')
    host.send({ type: 'start_match' })
    const hostStart = await hostStartP
    const guestStart = await guestStartP
    expect(guestStart.matchId).toBe(hostStart.matchId)
    const matchId = hostStart.matchId

    // Host locks a full bottom row as a tetris; the garbage intended for guest is
    // dropped by the proxy. The server still enqueues it on the guest's authority.
    const clearCells = Array.from({ length: 10 }, (_, x) => ({ x, y: 19 }))
    host.send({
      type: 'lock',
      lock: { rows: 4, spin: 'none', piece: 'I', perfectClear: false, combo: 0, b2b: false, streak: 0, cells: clearCells },
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    // The guest (never having seen the garbage) places a non-clearing piece. The
    // server's "wait a little" rule applies the queued garbage to the authority
    // board at this point.
    const nonClearCells = [{ x: 9, y: 19 }]
    guest.send({
      type: 'lock',
      lock: { rows: 1, spin: 'none', piece: 'T', perfectClear: false, combo: 0, b2b: false, streak: 0, cells: nonClearCells },
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Replicate the server's own authority for the host: the clear lock forwards
    // surplus garbage (a tetris, 4 rows) that the session enqueues on the guest,
    // then the guest's non-clearing lock applies it to the guest's authority.
    const hostSide = createAuthority()
    const hostLock = applyLock(hostSide, { cells: clearCells, rows: 4, spin: 'none', piece: 'I', combo: 0, b2b: false, streak: 0 })
    const surplus = hostLock.surplus
    const heap = surplus - 8 // with the cap, only 8 of the 10 land here; 2 stay owed
    const resync = guest.waitFor('resync')
    guest.send({ type: 'snapshot', board: serializeBoard(emptyBoard()), score: 0, seq: 1, matchId })
    const healed = await resync
    // Real correction: the client is told the authoritative board now contains the
    // garbage it never received (the applied 8 rows), with the capped remainder
    // still owed — so nothing is silently lost. (The hole is randomized per row,
    // so assert structure rather than an exact hole.)
    expect(healed.pendingGarbage).toBe(heap)
    const rows = healed.board.split('/')
    expect(rows.length).toBe(20)
    for (const row of rows.slice(-surplus + heap)) {
      expect(row).toHaveLength(10)
      expect(row.replaceAll('G', '')).toBe('.') // exactly one hole per garbage row
    }

    await host.close()
    await guest.close()
  })
})