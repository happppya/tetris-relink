import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type BlitzDuration = 60 | 180 | 300

export interface Records {
  sprintBestMs: number | null
  blitzBestScore: Record<BlitzDuration, number | null>
  gamesPlayed: number
}

interface StatsStore extends Records {
  recordSprint: (ms: number) => boolean
  recordBlitz: (duration: BlitzDuration, score: number) => boolean
  countGame: () => void
}

export const useStats = create<StatsStore>()(
  persist(
    (set, get) => ({
      sprintBestMs: null,
      blitzBestScore: { 60: null, 180: null, 300: null },
      gamesPlayed: 0,
      recordSprint: (ms) => {
        const best = get().sprintBestMs
        if (best === null || ms < best) {
          set({ sprintBestMs: ms })
          return true
        }
        return false
      },
      recordBlitz: (duration, score) => {
        const best = get().blitzBestScore[duration]
        if (best === null || score > best) {
          set((s) => ({ blitzBestScore: { ...s.blitzBestScore, [duration]: score } }))
          return true
        }
        return false
      },
      countGame: () => set((s) => ({ gamesPlayed: s.gamesPlayed + 1 })),
    }),
    { name: 'tetris-liberation-stats' },
  ),
)
