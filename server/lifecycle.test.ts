import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { setReconnectGraceMs, startServer, type ServerHandle } from './index.ts'
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

  it('stops targeting a topped-out player in an N-player game', async () => {
    const a = await connectSimulatedClient(url, 'A')
    const b = await connectSimulatedClient(url, 'B')
    const c = await connectSimulatedClient(url, 'C')
    const created = a.waitFor('lobby_state')
    a.send({ type: 'create_lobby', name: 'A', visibility: 'private', settings: { mode: 'firstToX', goal: 3, winBy: 2 } })
    const code = (await created).lobby.code
    for (const client of [b, c]) {
      const joined = client.waitFor('lobby_state')
      client.send({ type: 'join_lobby', code })
      await joined
    }
    const started = a.waitFor('match_start')
    a.send({ type: 'start_match' })
    const match = await started
    const cId = match.players.find((p) => p.name === 'C')!.id

    // C tops out and is eliminated for the game.
    const elimination = c.waitFor('game_end')
    c.send({ type: 'topout', matchId: match.matchId })
    expect((await elimination).eliminatedIds).toContain(cId)

    // A points manual targeting at the now-eliminated C, then attacks.
    a.send({ type: 'target', mode: 'manual', targetId: cId })
    const delivered = b.waitFor('garbage')
    a.send({ type: 'lock', lock: { rows: 4, spin: 'none', piece: 'I', perfectClear: false, combo: 0, b2b: false, streak: 0 } })
    expect(await delivered).toMatchObject({ lines: 4 })
    // B received the attack; C (the eliminated manual target) did not.

    await Promise.all([a.close(), b.close(), c.close()])
  })

  it('forfeits a disconnected player and notifies the survivor once the grace period passes', async () => {
    const prev = setReconnectGraceMs(150)
    const host = await connectSimulatedClient(url, 'HOST2')
    const guest = await connectSimulatedClient(url, 'GUEST2')
    try {
      const created = host.waitFor('lobby_state')
      host.send({ type: 'create_lobby', name: 'HOST2', visibility: 'private', settings: { mode: 'firstToX', goal: 1, winBy: 2 } })
      const code = (await created).lobby.code
      const joined = guest.waitFor('lobby_state')
      guest.send({ type: 'join_lobby', code }); await joined
      const started = host.waitFor('match_start'); host.send({ type: 'start_match' }); const match = await started
      // the drop buffers the guest (still in the roster) until the grace runs out
      const reconnecting = host.waitFor('roster_update')
      await guest.close()
      expect((await reconnecting).players.find((p) => p.name === 'GUEST2')!.reconnecting).toBe(true)
      // then the forfeit lands: the round resolves for the survivor + player_left
      // (the dropped player was already sat out of the round on disconnect, so
      // there is no separate eliminated broadcast)
      const gameEnd = host.waitFor('game_end'); const left = host.waitFor('player_left')
      expect(await gameEnd).toMatchObject({ winnerId: match.players[0].id })
      expect(await left).toMatchObject({ playerId: match.players[1].id })
    } finally {
      setReconnectGraceMs(prev)
      await host.close()
    }
  })
})
