import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import { startServer, type ServerHandle } from './index.ts'
import type { ClientMessage, LobbyPlayer, LobbyState, ServerMessage } from '../shared/protocol.ts'

const lobbyStateOf = (m: ServerMessage): LobbyState => (m as { type: 'lobby_state'; lobby: LobbyState }).lobby
const rosterOf = (m: ServerMessage): { players: LobbyPlayer[]; hostId: string } =>
  m as { type: 'roster_update'; players: LobbyPlayer[]; hostId: string }
const codeOf = (m: ServerMessage): string => (m as { type: 'error'; code: string }).code

let handle: ServerHandle
let port: number

beforeAll(async () => {
  handle = startServer(0)
  const httpServer = handle.server
  for (let i = 0; i < 50 && !httpServer.address(); i++) {
    await new Promise((r) => setTimeout(r, 10))
  }
  port = (httpServer.address() as AddressInfo).port
})

afterAll(async () => {
  await handle.close()
})

interface TestClient {
  ws: WebSocket
  /** only messages received after the waitFor call are matched */
  waitFor: (type: ServerMessage['type'], timeoutMs?: number) => Promise<ServerMessage>
  send: (msg: ClientMessage) => void
  close: () => void
}

function connectClient(name: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`)
    const listeners = new Set<(m: ServerMessage) => void>()
    ws.on('open', () => {
      const client: TestClient = {
        ws,
        waitFor: (type, timeoutMs = 2000) =>
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

describe('lobby flows over real WebSockets', () => {
  it('create, join, settings, leave, and cleanup', async () => {
    const host = await connectClient('HOST')
    const guest = await connectClient('GUEST')

    const hostStateP = host.waitFor('lobby_state')
    host.send({ type: 'create_lobby', name: 'HOST', visibility: 'public', settings: { mode: 'firstToX', goal: 5, winBy: 2 } })
    const hostState = lobbyStateOf(await hostStateP)
    expect(hostState.players).toHaveLength(1)
    expect(hostState.settings.goal).toBe(5)

    const guestStateP = guest.waitFor('lobby_state')
    const hostRosterP = host.waitFor('roster_update')
    guest.send({ type: 'join_lobby', code: hostState.code.toLowerCase() })
    const guestState = lobbyStateOf(await guestStateP)
    expect(guestState.players).toHaveLength(2)
    expect(guestState.hostId).toBe(hostState.hostId)
    const roster = rosterOf(await hostRosterP)
    expect(roster.players).toHaveLength(2)

    // non-host cannot change settings
    const forbiddenP = guest.waitFor('error')
    guest.send({ type: 'settings_update', settings: { mode: 'winByX', goal: 3, winBy: 2 } })
    const forbidden = await forbiddenP
    expect(codeOf(forbidden)).toBe('forbidden')

    // host change broadcasts to everyone
    const hostUpdateP = host.waitFor('settings_update')
    const guestUpdateP = guest.waitFor('settings_update')
    host.send({ type: 'settings_update', settings: { mode: 'winByX', goal: 3, winBy: 2 } })
    const hostUpdate = await hostUpdateP
    const guestUpdate = await guestUpdateP
    expect(hostUpdate.type === 'settings_update' && hostUpdate.settings.mode).toBe('winByX')
    expect(guestUpdate.type === 'settings_update' && guestUpdate.settings.mode).toBe('winByX')

    // registry lists the public lobby
    const listP = host.waitFor('lobby_list')
    host.send({ type: 'list_lobbies' })
    const list = await listP
    expect(list.type === 'lobby_list' && list.lobbies).toHaveLength(1)
    expect(list.type === 'lobby_list' && list.lobbies[0]).toMatchObject({ hostName: 'HOST', playerCount: 2 })

    // guest leaves; host sees the roster shrink
    const rosterAfterP = host.waitFor('roster_update')
    guest.send({ type: 'leave_lobby' })
    const rosterAfter = rosterOf(await rosterAfterP)
    expect(rosterAfter.players).toHaveLength(1)

    // host leaves; lobby is destroyed
    const list2P = host.waitFor('lobby_list')
    host.send({ type: 'leave_lobby' })
    host.send({ type: 'list_lobbies' })
    const list2 = await list2P
    expect(list2.type === 'lobby_list' && list2.lobbies).toHaveLength(0)

    host.close()
    guest.close()
  })

  it('transfers host on disconnect and destroys the lobby when empty', async () => {
    const host = await connectClient('HOST2')
    const guest = await connectClient('GUEST2')

    const stateP = host.waitFor('lobby_state')
    host.send({ type: 'create_lobby', name: 'HOST2', visibility: 'private', settings: { mode: 'firstToX', goal: 7, winBy: 2 } })
    const state = lobbyStateOf(await stateP)
    const guestStateP = guest.waitFor('lobby_state')
    guest.send({ type: 'join_lobby', code: state.code })
    await guestStateP

    const promotedP = guest.waitFor('error')
    const rosterP = guest.waitFor('roster_update')
    host.close()
    const promoted = await promotedP
    expect(codeOf(promoted)).toBe('host_transferred')
    const roster = rosterOf(await rosterP)
    expect(roster.players[0].isHost).toBe(true)
    expect(roster.hostId).toBe(roster.players[0].id)

    guest.close()
    await sleep(50)
    expect(handle.registry.all()).toHaveLength(0)
  })

  it('rejects joining a nonexistent or full lobby', async () => {
    const guest = await connectClient('GUEST3')
    const notFoundP = guest.waitFor('error')
    guest.send({ type: 'join_lobby', code: 'ZZZZZ' })
    const notFound = await notFoundP
    expect(codeOf(notFound)).toBe('not_found')

    const host = await connectClient('HOST3')
    const stateP = host.waitFor('lobby_state')
    host.send({ type: 'create_lobby', name: 'HOST3', visibility: 'public', settings: { mode: 'firstToX', goal: 7, winBy: 2 } })
    const state = lobbyStateOf(await stateP)

    const fillers = await Promise.all(Array.from({ length: 7 }, (_, i) => connectClient(`FILL${i}`)))
    for (const c of fillers) {
      const joinedP = c.waitFor('lobby_state')
      c.send({ type: 'join_lobby', code: state.code })
      await joinedP
    }

    const fullP = guest.waitFor('error')
    guest.send({ type: 'join_lobby', code: state.code })
    const full = await fullP
    expect(codeOf(full)).toBe('lobby_full')

    host.close()
    guest.close()
    for (const c of fillers) c.close()
  })
})