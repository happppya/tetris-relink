/**
 * Per-tab player identity persistence.
 *
 * Two tabs/windows of the same browser are TWO DIFFERENT players, so identity
 * must never be shared per-origin. The `selfId` (which the server's rejoin
 * claim binds to) lives in sessionStorage — it survives a refresh in the same
 * tab but is invisible to sibling tabs, so one tab's refresh can never present
 * another tab's id and hijack that player's identity/board. Storing selfId in
 * localStorage (shared by all tabs) caused exactly that: the member's refresh
 * could present the host's id, and the server's rejoin claim handed the second
 * client the host's identity (shared authority, shared board).
 *
 * The display name is a per-origin preference (localStorage): the user's own
 * choice of name, safe to share across their tabs.
 */
const SELF_ID_KEY = 'tetris-liberation-selfid'
const NAME_KEY = 'tetris-liberation-name'

/** Fun name pool so default players aren't all just "PLAYER" (confusing in a lobby). */
const NAME_ADJ = ['Neon', 'Turbo', 'Pixel', 'Cosmic', 'Hyper', 'Laser', 'Frost', 'Nova', 'Iron', 'Mega', 'Rapid', 'Ultra']
const NAME_NOUN = ['Blox', 'Drop', 'Spin', 'Block', 'Stack', 'Grid', 'Cube', 'Mino', 'Rocket', 'Storm', 'Ghost', 'Wave']

/** A random default display name (e.g. "NeonBlox", "TurboSpin"). */
export function randomDefaultName(): string {
  const adj = NAME_ADJ[Math.floor(Math.random() * NAME_ADJ.length)]!
  const noun = NAME_NOUN[Math.floor(Math.random() * NAME_NOUN.length)]!
  return `${adj}${noun}`
}

const read = (get: () => string | null): string | null => {
  try {
    return get()
  } catch {
    return null // storage unavailable (private mode / SSR)
  }
}

const write = (set: () => void): void => {
  try {
    set()
  } catch {
    // storage unavailable: identity just won't persist across a refresh
  }
}

export function loadSelfId(): string | null {
  return read(() => globalThis.sessionStorage?.getItem(SELF_ID_KEY) ?? null)
}

export function saveSelfId(id: string): void {
  write(() => globalThis.sessionStorage?.setItem(SELF_ID_KEY, id))
}

/** Called when the user deliberately disconnects: drop the per-tab identity. */
export function clearSelfId(): void {
  write(() => globalThis.sessionStorage?.removeItem(SELF_ID_KEY))
}

export function loadName(): string {
  const stored = read(() => globalThis.localStorage?.getItem(NAME_KEY) ?? null)
  if (stored) return stored
  // no name chosen yet: hand out a random one and remember it, so a refresh
  // keeps the same name (and default players are distinguishable)
  const fresh = randomDefaultName()
  saveName(fresh)
  return fresh
}

export function saveName(name: string): void {
  write(() => globalThis.localStorage?.setItem(NAME_KEY, name))
}
