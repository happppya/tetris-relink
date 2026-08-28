import { describe, expect, it } from 'vitest'
import { MAX_PLAYERS } from './lobby.ts'
import { LobbyRegistry } from './registry.ts'
import { DEFAULT_LOBBY_SETTINGS } from '../shared/lobby-settings.ts'

const member = (id: string, joinedAt = Date.now()) => ({ id, name: id.toUpperCase(), joinedAt })

function makeLobby(hostId = 'host', visibility: 'public' | 'private' = 'public') {
  const registry = new LobbyRegistry()
  const lobby = registry.create({
    visibility,
    settings: { ...DEFAULT_LOBBY_SETTINGS },
    host: member(hostId, 0),
  })
  return { registry, lobby }
}

describe('Lobby', () => {
  it('starts with the creator as host and one member', () => {
    const { lobby } = makeLobby()
    expect(lobby.hostId).toBe('host')
    expect(lobby.size).toBe(1)
    expect(lobby.memberList).toEqual([{ id: 'host', name: 'HOST', isHost: true }])
  })

  it('orders the roster by join order', () => {
    const { lobby } = makeLobby()
    lobby.join(member('b', 1))
    lobby.join(member('a', 2))
    expect(lobby.memberList.map((p) => p.id)).toEqual(['host', 'b', 'a'])
  })

  it('rejects joins at the player cap', () => {
    const { lobby } = makeLobby()
    for (let i = 0; i < MAX_PLAYERS - 1; i++) lobby.join(member(`p${i}`))
    expect(lobby.isFull).toBe(true)
    expect(lobby.join(member('overflow'))).toBe(false)
    expect(lobby.size).toBe(MAX_PLAYERS)
  })

  it('rejects duplicate member ids', () => {
    const { lobby } = makeLobby()
    expect(lobby.join(member('host'))).toBe(false)
  })

  it('transfers host to the earliest joiner when the host leaves', () => {
    const { lobby } = makeLobby()
    lobby.join(member('first', 1))
    lobby.join(member('second', 2))
    const { empty, newHostId } = lobby.leave('host')
    expect(empty).toBe(false)
    expect(newHostId).toBe('first')
    expect(lobby.hostId).toBe('first')
    expect(lobby.memberList.find((p) => p.isHost)?.id).toBe('first')
  })

  it('does not transfer host when a non-host leaves', () => {
    const { lobby } = makeLobby()
    lobby.join(member('first'))
    const { newHostId } = lobby.leave('first')
    expect(newHostId).toBeNull()
    expect(lobby.hostId).toBe('host')
  })

  it('reports empty when the last member leaves', () => {
    const { lobby } = makeLobby()
    const { empty } = lobby.leave('host')
    expect(empty).toBe(true)
  })

  it('only lets the host change settings and sanitizes payloads', () => {
    const { lobby } = makeLobby()
    lobby.join(member('guest'))
    expect(lobby.setSettings('guest', { mode: 'winByX', goal: 3, winBy: 2 })).toBe(false)
    expect(lobby.settings.mode).toBe('firstToX')
    expect(lobby.setSettings('host', { mode: 'winByX', goal: 99, winBy: -5 })).toBe(true)
    expect(lobby.settings).toEqual({ mode: 'winByX', goal: 99, winBy: 1 })
    expect(lobby.setSettings('host', { mode: 'bogus', goal: 'x' })).toBe(true)
    expect(lobby.settings.mode).toBe('firstToX')
    expect(lobby.settings.goal).toBe(7)
  })
})

describe('LobbyRegistry', () => {
  it('generates unique join codes', () => {
    const registry = new LobbyRegistry()
    const codes = new Set<string>()
    for (let i = 0; i < 50; i++) {
      codes.add(registry.create({ visibility: 'public', settings: { ...DEFAULT_LOBBY_SETTINGS }, host: member(`h${i}`) }).code)
    }
    expect(codes.size).toBe(50)
  })

  it('looks codes up case-insensitively', () => {
    const { registry, lobby } = makeLobby()
    expect(registry.get(lobby.code.toLowerCase())).toBe(lobby)
  })

  it('lists only public lobbies with a summary', () => {
    const { registry } = makeLobby('hostA', 'public')
    registry.create({ visibility: 'private', settings: { ...DEFAULT_LOBBY_SETTINGS }, host: member('hostB') })
    const list = registry.publicList()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ hostName: 'HOSTA', playerCount: 1 })
    expect(list[0].code).toBeTruthy()
  })

  it('removes lobbies', () => {
    const { registry, lobby } = makeLobby()
    registry.remove(lobby.code)
    expect(registry.get(lobby.code)).toBeUndefined()
    expect(registry.publicList()).toHaveLength(0)
  })
})