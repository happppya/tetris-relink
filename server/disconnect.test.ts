import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { setReconnectGraceMs, startServer, type ServerHandle } from './index.ts'
import { connectSimulatedClient, type SimulatedClient } from './test-client.ts'

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

async function setupMatch(host: SimulatedClient, guest: SimulatedClient) {
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
  return hostStart
}

describe('disconnect during a match', () => {
  it('keeps a disconnected opponent buffered, then awards the match after the grace period', async () => {
    const prev = setReconnectGraceMs(200)
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

      // the sole opponent drops its socket (refresh / tab close): it is kept
      // in the lobby + match for the grace period so it can rejoin, and the
      // match does NOT end while the opponent could still come back
      const reconnecting = host.waitFor('roster_update')
      await guest.close()
      expect((await reconnecting).players.find((p) => p.name === 'GUEST')!.reconnecting).toBe(true)

      // once the grace period runs out the opponent is pruned: the host is
      // awarded the match instead of being stuck with a ghost that can't top out
      const left = host.waitFor('player_left')
      const end = host.waitFor('match_end')
      expect((await left).playerId).not.toBe(hostId)
      expect((await end).winnerId).toBe(hostId)
    } finally {
      setReconnectGraceMs(prev)
      await host.close()
    }
  })

  it('leaving mid-match via leave_lobby ends a 1v1 match and frees the leaver to rejoin elsewhere', async () => {
    const host = await connectSimulatedClient(url, 'HOST')
    const guest = await connectSimulatedClient(url, 'GUEST')
    try {
      const hostStart = await setupMatch(host, guest)
      const hostId = hostStart.players.find((player) => player.name === 'HOST')!.id

      // the guest presses LEAVE mid-round: the message must reach the server and
      // permanently remove them, not leave a ghost in the session
      guest.send({ type: 'leave_lobby' })

      // the sole remaining player must be awarded the match (no hang), and must
      // hear about the departure
      const left = host.waitFor('player_left')
      const end = host.waitFor('match_end')
      expect((await left).playerId).not.toBe(hostId)
      expect((await end).winnerId).toBe(hostId)

      // the leaver must be able to create a fresh lobby immediately instead of
      // being told they are still in the old one (broken server communication)
      const recreated = guest.waitFor('lobby_state')
      guest.send({ type: 'create_lobby', name: 'GUEST', visibility: 'private', settings: { mode: 'firstToX', goal: 3, winBy: 2 } })
      await recreated
    } finally {
      await host.close()
      await guest.close()
    }
  })
})