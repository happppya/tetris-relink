import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { setReconnectGraceMs, startServer, type ServerHandle } from './index.ts'
import { connectSimulatedClient, type SimulatedClient } from './test-client.ts'
import { emptyBoard, serializeBoard } from '../shared/board.ts'
import type { LobbyState, ServerMessage } from '../shared/protocol.ts'

let server: ServerHandle
let url: string

beforeAll(async () => {
  // these tests are about load, not reconnection: keep the unexpected-disconnect
  // grace short so closed sockets are pruned quickly and never leak into the
  // next scenario's state assertions
  setReconnectGraceMs(100)
  server = startServer(0)
  for (let i = 0; i < 50 && !server.server.address(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
  url = `ws://localhost:${(server.server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await server.close()
})

const lobbyOf = (m: ServerMessage): LobbyState => (m as { type: 'lobby_state'; lobby: LobbyState }).lobby
const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// every client a test creates is tracked so a failed assertion can never leak
// sockets/sessions into the next test
const openClients: SimulatedClient[] = []

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((c) => c.close()))
  await sleep(300) // let buffered (grace) disconnects be pruned before the next test
})

async function joinLobby(host: SimulatedClient, guests: SimulatedClient[], names: string[], goal = 3): Promise<string> {
  const created = host.waitFor('lobby_state')
  host.send({ type: 'create_lobby', name: names[0], visibility: 'public', settings: { mode: 'firstToX', goal, winBy: 2 } })
  const code = lobbyOf(await created).code
  for (let i = 0; i < guests.length; i++) {
    const joined = guests[i].waitFor('lobby_state')
    guests[i].send({ type: 'join_lobby', code })
    await joined
  }
  return code
}

async function startMatch(host: SimulatedClient, guests: SimulatedClient[]): Promise<string> {
  const starts = [host.waitFor('match_start'), ...guests.map((g) => g.waitFor('match_start'))]
  host.send({ type: 'start_match' })
  const [first] = await Promise.all(starts)
  return first.matchId
}

interface Tracked {
  client: SimulatedClient
  selfId: string | null
  matchId: string | null
  selfUpdates: number
}

async function trackedClient(name: string): Promise<Tracked> {
  const t: Tracked = { client: await connectSimulatedClient(url, name, (msg) => {
    if (msg.type === 'welcome') t.selfId = msg.selfId
    if (msg.type === 'board_update' && msg.playerId === t.selfId) t.selfUpdates++
  }), selfId: null, matchId: null, selfUpdates: 0 }
  return t
}

describe('server load', () => {
  it('sustains 48 concurrent clients across 6 matches with bounded relay latency', { timeout: 60000 }, async () => {
    const lobbies = 6
    const perLobby = 8
    const groups: Tracked[][] = []
    const all = async (fn: (t: Tracked) => Promise<void>) => {
      await Promise.all(groups.flat().map(fn))
    }

    for (let l = 0; l < lobbies; l++) {
      const group: Tracked[] = []
      for (let i = 0; i < perLobby; i++) {
        const t = await trackedClient(`L${l}P${i}`)
        openClients.push(t.client)
        group.push(t)
      }
      await joinLobby(group[0].client, group.slice(1).map((g) => g.client), group.map((g) => `L${l}P${group.indexOf(g)}`))
      const matchId = await startMatch(group[0].client, group.slice(1).map((g) => g.client))
      for (const t of group) t.matchId = matchId
      groups.push(group)
    }

    // steady relay load: every client snapshots ~10Hz and pings ~2Hz
    const pings: number[] = []
    const acks: number[] = []
    for (let round = 0; round < 12; round++) {
      await all(async (t) => {
        const t0 = Date.now()
        const ack = t.client.waitFor('snapshot_ack')
        t.client.send({ type: 'snapshot', board: serializeBoard(emptyBoard()), score: 0, seq: round, matchId: t.matchId! })
        await ack
        acks.push(Date.now() - t0)
      })
      await all(async (t) => {
        const t0 = Date.now()
        const pong = t.client.waitFor('pong')
        t.client.send({ type: 'ping', t: t0 })
        const r = await pong
        pings.push(Date.now() - r.t)
      })
      await sleep(50)
    }

    const stats = server.stats()
    const selfTotal = groups.flat().reduce((sum, t) => sum + t.selfUpdates, 0)
    console.log(`load: state conns=${stats.conns} sessions=${stats.sessions} lobbies=${stats.lobbies}`)
    console.log(`load: snapshot->ack p50=${pct(acks, 0.5)}ms p95=${pct(acks, 0.95)}ms (n=${acks.length})`)
    console.log(`load: ping p50=${pct(pings, 0.5)}ms p95=${pct(pings, 0.95)}ms (n=${pings.length})`)
    console.log(`load: self-echoed board_updates=${selfTotal} (of ${groups.flat().length * 12} snapshots)`)

    expect(stats.conns).toBe(groups.flat().length)
    expect(stats.sessions).toBe(lobbies)
    expect(pct(acks, 0.95)).toBeLessThan(250)
    expect(pct(pings, 0.95)).toBeLessThan(250)

    for (const group of groups) for (const t of group) await t.client.close()
    await sleep(300) // grace is 100ms: let the buffered disconnects be pruned
    const after = server.stats()
    expect(after.conns).toBe(0)
    expect(after.lobbies).toBe(0)
  })

  it('routes a real lock to its target with low latency while matches run', { timeout: 60000 }, async () => {
    const pairs = 4
    const rtts: number[] = []
    for (let p = 0; p < pairs; p++) {
      const a = await connectSimulatedClient(url, `ATTACK${p}`)
      openClients.push(a)
      const v = await connectSimulatedClient(url, `VICTIM${p}`)
      openClients.push(v)
      await joinLobby(a, [v], [`ATTACK${p}`, `VICTIM${p}`])
      const matchId = await startMatch(a, [v])

      const cells = Array.from({ length: 10 }, (_, x) => ({ x, y: 19 }))
      for (let shot = 0; shot < 3; shot++) {
        const t0 = Date.now()
        const garbage = v.waitFor('garbage')
        a.send({ type: 'lock', lock: { rows: 4, spin: 'none', piece: 'I', perfectClear: false, combo: 0, b2b: false, streak: 0, cells } })
        const g = await garbage
        rtts.push(Date.now() - t0)
        // the victim's board stays empty (garbage is queued, not yet applied);
        // acknowledging keeps the match authority consistent for the next shot
        v.send({ type: 'snapshot', board: serializeBoard(emptyBoard()), score: 0, seq: shot, matchId })
        void g
      }
      await a.close()
      await v.close()
    }
    console.log(`load: lock->garbage p50=${pct(rtts, 0.5)}ms p95=${pct(rtts, 0.95)}ms (n=${rtts.length})`)
    expect(pct(rtts, 0.95)).toBeLessThan(250)
  })

  it('rapid consecutive matches do not grow the session map', { timeout: 60000 }, async () => {
    const host = await connectSimulatedClient(url, 'SEQUENCE-HOST')
    openClients.push(host)
    const guest = await connectSimulatedClient(url, 'SEQUENCE-GUEST')
    openClients.push(guest)
    await joinLobby(host, [guest], ['SEQUENCE-HOST', 'SEQUENCE-GUEST'], 1)

    for (let round = 0; round < 5; round++) {
      const matchId = await startMatch(host, [guest])
      const ends = [host.waitFor('match_end'), guest.waitFor('match_end')]
      guest.send({ type: 'topout', matchId })
      await Promise.all(ends)
    }
    const stats = server.stats()
    console.log(`load: after 5 consecutive matches sessions=${stats.sessions} lobbies=${stats.lobbies}`)
    expect(stats.sessions).toBe(0) // finished sessions are deleted, not accumulated

    await host.close()
    await guest.close()
  })

  it('leave/disconnect churn returns all internal state to zero', { timeout: 60000 }, async () => {
    for (let iter = 0; iter < 5; iter++) {
      const host = await connectSimulatedClient(url, `CHURN-H${iter}`)
      openClients.push(host)
      const guests = await Promise.all(Array.from({ length: 4 }, (_, i) => {
        const g = connectSimulatedClient(url, `CHURN-G${iter}${i}`)
        return g.then((c) => {
          openClients.push(c)
          return c
        })
      }))
      await joinLobby(host, guests, [`CHURN-H${iter}`, ...guests.map((_, i) => `CHURN-G${iter}${i}`)])
      const matchId = await startMatch(host, guests)
      // half the lobby disconnects mid-match; the rest leave cleanly
      for (const g of guests.slice(0, 2)) await g.close()
      for (const g of guests.slice(2)) g.send({ type: 'leave_lobby' })
      host.send({ type: 'leave_lobby' })
      void matchId
      await sleep(50)
    }
    await sleep(300) // let the buffered disconnects' grace expire before measuring
    const stats = server.stats()
    console.log(`load: after churn lobbies=${stats.lobbies} sessions=${stats.sessions} conns=${stats.conns}`)
    // leave_lobby keeps the socket open for rejoining, so 15 leavers remain
    // connected by design; the lobby/session state must still be fully reclaimed
    expect(stats.lobbies).toBe(0)
    expect(stats.sessions).toBe(0)
    expect(stats.conns).toBe(15)
    await Promise.all(openClients.splice(0).map((c) => c.close()))
    await sleep(100)
    const drained = server.stats()
    console.log(`load: after closing all leavers conns=${drained.conns}`)
    expect(drained.conns).toBe(0)
  })
})
