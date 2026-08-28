import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { startServer, type ServerHandle } from './index.ts'
import { connectSimulatedClient } from './test-client.ts'

let server: ServerHandle
let url: string
beforeAll(async () => {
  server = startServer(0)
  await new Promise((resolve) => setTimeout(resolve, 10))
  url = `ws://localhost:${(server.server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

describe('match lifecycle over WebSockets', () => {
  it('broadcasts game and match end after a topout', async () => {
    const host = await connectSimulatedClient(url, 'HOST')
    const guest = await connectSimulatedClient(url, 'GUEST')
    const created = host.waitFor('lobby_state')
    host.send({ type: 'create_lobby', name: 'HOST', visibility: 'private', settings: { mode: 'firstToX', goal: 1, winBy: 2 } })
    const code = (await created).lobby.code
    const joined = guest.waitFor('lobby_state')
    guest.send({ type: 'join_lobby', code })
    await joined
    const started = host.waitFor('match_start')
    const guestStarted = guest.waitFor('match_start')
    host.send({ type: 'start_match' })
    const match = await started
    await guestStarted
    const gameEnd = guest.waitFor('game_end')
    const matchEnd = guest.waitFor('match_end')
    guest.send({ type: 'topout', matchId: match.matchId })
    expect(await gameEnd).toMatchObject({ winnerId: null, eliminatedIds: [match.players[1].id] })
    expect(await matchEnd).toMatchObject({ winnerId: match.players[0].id, wins: { [match.players[0].id]: 1 } })
    await host.close(); await guest.close()
  })

  it('forfeits a disconnected player and notifies the survivor', async () => {
    const host = await connectSimulatedClient(url, 'HOST2')
    const guest = await connectSimulatedClient(url, 'GUEST2')
    const created = host.waitFor('lobby_state')
    host.send({ type: 'create_lobby', name: 'HOST2', visibility: 'private', settings: { mode: 'firstToX', goal: 1, winBy: 2 } })
    const code = (await created).lobby.code
    const joined = guest.waitFor('lobby_state')
    guest.send({ type: 'join_lobby', code }); await joined
    const started = host.waitFor('match_start'); host.send({ type: 'start_match' }); const match = await started
    const gameEnd = host.waitFor('game_end'); const left = host.waitFor('player_left')
    await guest.close()
    expect(await gameEnd).toMatchObject({ winnerId: null, eliminatedIds: [match.players[1].id] })
    expect(await left).toMatchObject({ playerId: match.players[1].id })
    await host.close()
  })
})
