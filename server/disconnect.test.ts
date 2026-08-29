import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { startServer, type ServerHandle } from './index.ts'
import { connectSimulatedClient } from './test-client.ts'

let server: ServerHandle
let url: string

beforeAll(async () => {
  server = startServer(0)
  for (let i = 0; i < 50 && !server.server.address(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
  url = `ws://localhost:${(server.server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await server.close()
})

describe('disconnect during a match', () => {
  it('host wins the match when the sole opponent disconnects (must not hang)', async () => {
    const host = await connectSimulatedClient(url, 'HOST')
    const guest = await connectSimulatedClient(url, 'GUEST')
    try {
      const created = host.waitFor('lobby_state')
      host.send({ type: 'create_lobby', name: 'HOST', visibility: 'private', settings: { mode: 'firstToX', goal: 3, winBy: 2 } })
      const { lobby } = await created

      const joined = guest.waitFor('lobby_state')
      guest.send({ type: 'join_lobby', code: lobby.code })
      await joined

      const hostMatch = host.waitFor('match_start')
      const guestMatch = guest.waitFor('match_start')
      host.send({ type: 'start_match' })
      const [hostStart] = await Promise.all([hostMatch, guestMatch])
      const hostId = hostStart.players.find((player) => player.name === 'HOST')!.id

      // the sole opponent disconnects mid-round
      await guest.close()

      // the host must be awarded the match rather than being left stuck with a
      // ghost opponent that can never top out
      const end = await host.waitFor('match_end')
      expect(end.winnerId).toBe(hostId)
    } finally {
      await host.close()
    }
  })
})