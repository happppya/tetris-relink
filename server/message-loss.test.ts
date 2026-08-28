import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import { startServer, type ServerHandle } from './index.ts'
import { LossyProxy } from './lossyproxy.ts'
import { deserializeBoard, emptyBoard, serializeBoard } from '../shared/board.ts'
import type { ClientMessage, LobbyState, ServerMessage } from '../shared/protocol.ts'

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
  // Control messages (lobby_state, match_start, snapshot_ack, resync) pass through,
  // so the test isolates the desync mechanism from flaky setup.
  proxy = new LossyProxy(serverPort, 1.0, () => 0, ['garbage'])
  proxy.listen(0)
  await new Promise((r) => setTimeout(r, 50))
  proxyPort = (proxy.server.address() as AddressInfo).port
})

afterAll(async () => {
  proxy.close()
  await handle.close()
})

interface TestClient {
  ws: WebSocket
  waitFor: (type: ServerMessage['type'], timeoutMs?: number) => Promise<ServerMessage>
  send: (msg: ClientMessage) => void
  close: () => void
}

function connectClient(name: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${proxyPort}`)
    const listeners = new Set<(m: ServerMessage) => void>()
    ws.on('open', () => {
      const client: TestClient = {
        ws,
        waitFor: (type, timeoutMs = 3000) =>
          new Promise((res, rej) => {
            const listener = (m: ServerMessage) => {
              if (m.type === type) {
                listeners.delete(listener)
                res(m)
              }
            }
            listeners.add(listener)
            setTimeout(() => {
              listeners.delete(listener)
              rej(new Error(`timeout waiting for ${type}`))
            }, timeoutMs)
          }),
        send: (msg) => ws.send(JSON.stringify(msg)),
        close: () => ws.close(),
      }
      client.send({ type: 'hello', name })
      resolve(client)
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage
      for (const l of listeners) l(msg)
    })
    ws.on('error', reject)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('message loss over the proxy', () => {
  it('recovers via resync when garbage messages are dropped', async () => {
    const host = await connectClient('HOST')
    const guest = await connectClient('GUEST')

    // create + join + start (control messages are not dropped)
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
    expect(hostStart.type === 'match_start' && hostStart.matchId).toBeTruthy()
    expect(guestStart.type === 'match_start' && guestStart.matchId).toBe(
      hostStart.type === 'match_start' ? hostStart.matchId : '',
    )

    // Host attacks guest with a tetris (attack 4). The garbage message is
    // dropped by the proxy, so the guest's client never learns about the 4
    // garbage rows that the server applied to its authoritative board.
    host.send({ type: 'lock', lock: { rows: 4, spin: 'none', piece: 'I', perfectClear: false, combo: 0, b2b: false, streak: 0 } })
    await sleep(100)

    // The host's own board is authoritative-empty (it received no garbage), but
    // its score is 4 (its own attack accrued on the sender). A snapshot that
    // reflects the truth is consistent -> ack.
    const ackP = host.waitFor('snapshot_ack')
    host.send({ type: 'snapshot', board: serializeBoard(emptyBoard()), score: 4, seq: 1 })
    const ack = await ackP
    expect(ack.type === 'snapshot_ack' && ack.seq).toBe(1)

    // The guest's board has drifted: it claims an empty board, but the server's
    // authoritative copy has 4 garbage rows. The snapshot cross-check must
    // detect the mismatch and resync the guest.
    const resyncP = guest.waitFor('resync')
    guest.send({ type: 'snapshot', board: serializeBoard(emptyBoard()), score: 0, seq: 2 })
    const resync = await resyncP
    expect(resync.type === 'resync').toBe(true)
    if (resync.type === 'resync') {
      const board = deserializeBoard(resync.board)
      const garbageRows = board.filter((row) => row.some((c) => c === 'G')).length
      expect(garbageRows).toBe(4)
      expect(resync.pendingGarbage).toBe(0)
      expect(resync.score).toBe(0)
    }

    // After applying the resync, the guest's next snapshot (matching the
    // authoritative board) is accepted — the client has recovered.
    const ack2P = guest.waitFor('snapshot_ack')
    const authoritative = resync.type === 'resync' ? resync.board : serializeBoard(emptyBoard())
    guest.send({ type: 'snapshot', board: authoritative, score: 0, seq: 3 })
    const ack2 = await ack2P
    expect(ack2.type === 'snapshot_ack' && ack2.seq).toBe(3)

    host.close()
    guest.close()
  })
})