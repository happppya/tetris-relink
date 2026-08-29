import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSelfId, loadName, loadSelfId, randomDefaultName, saveName, saveSelfId } from './identity'

/** Minimal Storage implementation for stubbing the browser globals. */
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

const realSession = globalThis.sessionStorage
const realLocal = globalThis.localStorage

function setGlobals(session: MemoryStorage, local: MemoryStorage): void {
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = session
  ;(globalThis as { localStorage?: unknown }).localStorage = local
}

afterEach(() => {
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = realSession
  ;(globalThis as { localStorage?: unknown }).localStorage = realLocal
})

describe('per-tab identity persistence', () => {
  it('two tabs of one browser keep distinct selfIds, and each refresh keeps its own tab\'s id', () => {
    // tab A (host) connects: its id lands in TAB A's sessionStorage
    const tabA = new MemoryStorage()
    const sharedName = new MemoryStorage()
    setGlobals(tabA, sharedName)
    saveSelfId('id-A')
    saveName('Alice')
    expect(loadSelfId()).toBe('id-A')
    expect(loadName()).toBe('Alice')

    // tab B (member) connects in the same browser: its sessionStorage is separate
    const tabB = new MemoryStorage()
    setGlobals(tabB, sharedName)
    saveSelfId('id-B')
    saveName('Bob')
    expect(loadSelfId()).toBe('id-B')

    // tab A refreshes: STILL its own id — never tab B's (the old bug: the shared
    // per-origin store would hand A whichever tab wrote last)
    setGlobals(tabA, sharedName)
    expect(loadSelfId()).toBe('id-A')
    expect(loadName()).toBe('Bob') // the name is a shared per-origin preference

    // tab B refreshes: STILL its own id
    setGlobals(tabB, sharedName)
    expect(loadSelfId()).toBe('id-B')

    // the two tabs' identities never collided even though they share localStorage
    setGlobals(tabA, sharedName)
    expect(loadSelfId()).not.toBe('id-B')
    setGlobals(tabB, sharedName)
    expect(loadSelfId()).not.toBe('id-A')
  })

  it('clearSelfId only drops the current tab\'s identity', () => {
    const tabA = new MemoryStorage()
    const tabB = new MemoryStorage()
    const sharedName = new MemoryStorage()
    setGlobals(tabA, sharedName)
    saveSelfId('id-A')
    setGlobals(tabB, sharedName)
    saveSelfId('id-B')

    // tab A deliberately disconnects: its identity is gone, tab B's survives
    setGlobals(tabA, sharedName)
    clearSelfId()
    expect(loadSelfId()).toBeNull()
    setGlobals(tabB, sharedName)
    expect(loadSelfId()).toBe('id-B')
  })

  it('a fresh tab starts as a fresh player with a RANDOM default name, not PLAYER', () => {
    setGlobals(new MemoryStorage(), new MemoryStorage())
    expect(loadSelfId()).toBeNull()
    const name = loadName()
    expect(name).not.toBe('PLAYER')
    // a generated name from the pool, persisted so a refresh keeps it
    expect(name).toMatch(/^(Neon|Turbo|Pixel|Cosmic|Hyper|Laser|Frost|Nova|Iron|Mega|Rapid|Ultra)(Blox|Drop|Spin|Block|Stack|Grid|Cube|Mino|Rocket|Storm|Ghost|Wave)$/)
    expect(loadName()).toBe(name)
  })

  it('the random default name varies and always comes from the pool', () => {
    const rand = vi.spyOn(Math, 'random')
    rand.mockReturnValue(0)
    expect(randomDefaultName()).toBe('NeonBlox')
    rand.mockReturnValue(0.99)
    expect(randomDefaultName()).toBe('UltraWave')
    rand.mockRestore()
  })
})
