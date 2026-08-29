// zustand's persist middleware reads/writes localStorage at store creation; the
// node environment has none (Node's built-in global, when present, is disabled
// without a flag), so tests that import the real client store need a shim.
const memory = new Map<string, string>()
const shim: Storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value)
  },
  removeItem: (key: string) => {
    memory.delete(key)
  },
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size
  },
}
Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true, writable: true })
