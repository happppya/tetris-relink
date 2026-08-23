import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type GarbageMode = 'none' | 'backfire' | 'unclear' | 'cheese'
export type GarbageMultiplier = 0.5 | 1 | 2

export interface ZenSettings {
  gravityLevel: number
  practice: boolean
  garbage: GarbageMode
  multiplier: GarbageMultiplier
  assist: boolean
  hintCount: number
  assistProfile: string
}

export const DEFAULT_ZEN_SETTINGS: ZenSettings = {
  gravityLevel: 1,
  practice: false,
  garbage: 'none',
  multiplier: 1,
  assist: false,
  hintCount: 2,
  assistProfile: 'optimal',
}

export const ZEN_BASE_XP = 5000

/** XP required to advance from `level` to `level + 1`, scaling linearly. */
export const zenLevelRequirement = (level: number): number => ZEN_BASE_XP * level

export function zenLevelInfo(xp: number): { level: number; into: number; req: number } {
  let level = 1
  let remaining = Math.max(0, Math.floor(xp))
  for (;;) {
    const req = zenLevelRequirement(level)
    if (remaining >= req) {
      remaining -= req
      level++
    } else {
      return { level, into: remaining, req }
    }
  }
}

interface ZenStore {
  xp: number
  settings: ZenSettings
  addXp: (amount: number) => void
  updateSettings: (patch: Partial<ZenSettings>) => void
}

export const useZen = create<ZenStore>()(
  persist(
    (set) => ({
      xp: 0,
      settings: { ...DEFAULT_ZEN_SETTINGS },
      addXp: (amount) => set((s) => ({ xp: s.xp + amount })),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    }),
    { name: 'tetris-liberation-zen' },
  ),
)
