import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { InputAction } from '../engine/types'
import { DEFAULT_ATTACK, type AttackConfig } from '../engine/attack'
import { DEFAULT_SCORING, type ScoringConfig } from '../engine/scoring'
import { BOT_PROFILES } from '../ai/profiles'

export interface AiSettings {
  mode: 'fixed' | 'adaptive'
  pps: number
}

export interface Settings {
  dasMs: number
  arrMs: number
  sddMs: number
  keybinds: Record<InputAction, string>
  ghost: boolean
  /** visual effects intensity, see EFFECT_LEVELS in render/effects.ts */
  effectsLevel: number
  shake: boolean
  clearPopups: boolean
  startLevel: number
  attack: AttackConfig
  scoring: ScoringConfig
  ai: AiSettings
  botProfile: string
  opponentBoardSize: 'small' | 'full'
}

export const FRAMES_PER_MS = 60 / 1000

export const msToFrames = (ms: number) => Math.max(0, Math.round(ms * FRAMES_PER_MS))

export const ACTION_LABELS: Record<InputAction, string> = {
  moveLeft: 'Move left',
  moveRight: 'Move right',
  softDrop: 'Soft drop',
  hardDrop: 'Hard drop',
  rotateCW: 'Rotate CW',
  rotateCCW: 'Rotate CCW',
  rotate180: 'Rotate 180',
  hold: 'Hold',
  retry: 'Retry',
  pause: 'Pause',
  assist: 'Assist hints',
}

const DEFAULT_KEYBINDS: Record<InputAction, string> = {
  moveLeft: 'ArrowLeft',
  moveRight: 'ArrowRight',
  softDrop: 'ArrowDown',
  hardDrop: 'Space',
  rotateCW: 'KeyX',
  rotateCCW: 'KeyZ',
  rotate180: 'KeyA',
  hold: 'KeyC',
  retry: 'KeyR',
  pause: 'Escape',
  assist: 'KeyG',
}

export const DEFAULT_SETTINGS: Settings = {
  dasMs: 133,
  arrMs: 33,
  sddMs: 33,
  keybinds: { ...DEFAULT_KEYBINDS },
  ghost: true,
  effectsLevel: 2,
  shake: false,
  clearPopups: true,
  startLevel: 1,
  attack: { ...DEFAULT_ATTACK },
  scoring: { ...DEFAULT_SCORING },
  ai: { mode: 'fixed', pps: 1.5 },
  botProfile: 'optimal',
  opponentBoardSize: 'small',
}

const cloneDefaults = (): Settings => ({
  ...DEFAULT_SETTINGS,
  keybinds: { ...DEFAULT_SETTINGS.keybinds },
  attack: { ...DEFAULT_SETTINGS.attack },
  scoring: { ...DEFAULT_SETTINGS.scoring },
  ai: { ...DEFAULT_SETTINGS.ai },
})

const SETTINGS_KEYS = [
  'dasMs',
  'arrMs',
  'sddMs',
  'keybinds',
  'ghost',
  'effectsLevel',
  'shake',
  'clearPopups',
  'startLevel',
  'attack',
  'scoring',
  'ai',
  'botProfile',
  'opponentBoardSize',
] as const satisfies readonly (keyof Settings)[]

export function serializeSettings(s: Settings): string {
  const data: Record<string, unknown> = { version: 1 }
  for (const k of SETTINGS_KEYS) data[k] = s[k]
  return JSON.stringify(data, null, 2)
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clampNum = (v: unknown, min: number, max: number, fallback: number) =>
  isNum(v) ? Math.min(max, Math.max(min, v)) : fallback

function mergeNumbers(target: Record<string, unknown>, raw: unknown, min: number, max: number) {
  if (typeof raw !== 'object' || raw === null) return
  const r = raw as Record<string, unknown>
  for (const key of Object.keys(target)) {
    if (typeof target[key] !== 'number') continue
    target[key] = clampNum(r[key], min, max, target[key] as number)
  }
}

export function parseSettings(raw: unknown): Settings | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const out = cloneDefaults()
  const r = raw as Record<string, unknown>
  out.dasMs = clampNum(r.dasMs, 0, 2000, out.dasMs)
  out.arrMs = clampNum(r.arrMs, 0, 1000, out.arrMs)
  out.sddMs = clampNum(r.sddMs, 0, 1000, out.sddMs)
  out.startLevel = clampNum(r.startLevel, 1, 19, out.startLevel)
  if (typeof r.ghost === 'boolean') out.ghost = r.ghost
  out.effectsLevel = clampNum(r.effectsLevel, 1, 5, out.effectsLevel)
  // legacy pre-levels setting
  if (r.effectsLevel === undefined && r.particles === false) out.effectsLevel = 1
  if (typeof r.shake === 'boolean') out.shake = r.shake
  if (typeof r.clearPopups === 'boolean') out.clearPopups = r.clearPopups
  if (typeof r.keybinds === 'object' && r.keybinds !== null) {
    for (const action of Object.keys(DEFAULT_KEYBINDS) as InputAction[]) {
      const code = (r.keybinds as Record<string, unknown>)[action]
      if (typeof code === 'string') out.keybinds[action] = code
    }
  }
  mergeNumbers(out.attack as unknown as Record<string, unknown>, r.attack, -99, 99)
  mergeNumbers(out.scoring as unknown as Record<string, unknown>, r.scoring, 0, Number.MAX_SAFE_INTEGER)
  if (typeof r.ai === 'object' && r.ai !== null) {
    const a = r.ai as Record<string, unknown>
    if (a.mode === 'fixed' || a.mode === 'adaptive') out.ai.mode = a.mode
    out.ai.pps = clampNum(a.pps, 0.1, 20, out.ai.pps)
  }
  if (typeof r.botProfile === 'string' && BOT_PROFILES.some((p) => p.id === r.botProfile)) {
    out.botProfile = r.botProfile
  }
  if (r.opponentBoardSize === 'small' || r.opponentBoardSize === 'full') out.opponentBoardSize = r.opponentBoardSize
  return out
}

interface SettingsStore extends Settings {
  update: (patch: Partial<Settings>) => void
  updateAttack: (patch: Partial<AttackConfig>) => void
  updateScoring: (patch: Partial<ScoringConfig>) => void
  updateAi: (patch: Partial<AiSettings>) => void
  bindKey: (action: InputAction, code: string) => void
  resetKeybinds: () => void
  resetHandling: () => void
  resetGameplay: () => void
  resetVisuals: () => void
  resetAi: () => void
  resetAttackTable: () => void
  importSettings: (raw: unknown) => boolean
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...cloneDefaults(),
      update: (patch) => set(patch),
      updateAttack: (patch) => set((s) => ({ attack: { ...s.attack, ...patch } })),
      updateScoring: (patch) => set((s) => ({ scoring: { ...s.scoring, ...patch } })),
      updateAi: (patch) => set((s) => ({ ai: { ...s.ai, ...patch } })),
      bindKey: (action, code) =>
        set((s) => {
          const keybinds = { ...s.keybinds }
          for (const [act, bound] of Object.entries(keybinds)) {
            if (bound === code && act !== action) keybinds[act as InputAction] = ''
          }
          keybinds[action] = code
          return { keybinds }
        }),
      resetKeybinds: () =>
        set({ keybinds: { ...DEFAULT_SETTINGS.keybinds } }),
      resetHandling: () =>
        set({
          dasMs: DEFAULT_SETTINGS.dasMs,
          arrMs: DEFAULT_SETTINGS.arrMs,
          sddMs: DEFAULT_SETTINGS.sddMs,
        }),
      resetGameplay: () => set({ ghost: DEFAULT_SETTINGS.ghost, startLevel: DEFAULT_SETTINGS.startLevel }),
      resetVisuals: () =>
        set({
          effectsLevel: DEFAULT_SETTINGS.effectsLevel,
          shake: DEFAULT_SETTINGS.shake,
          clearPopups: DEFAULT_SETTINGS.clearPopups,
        }),
      resetAi: () =>
        set({
          ai: { ...DEFAULT_SETTINGS.ai },
          botProfile: DEFAULT_SETTINGS.botProfile,
          opponentBoardSize: DEFAULT_SETTINGS.opponentBoardSize,
        }),
      resetAttackTable: () =>
        set({ attack: { ...DEFAULT_SETTINGS.attack }, scoring: { ...DEFAULT_SETTINGS.scoring } }),
      importSettings: (raw) => {
        const parsed = parseSettings(raw)
        if (!parsed) return false
        set(parsed)
        return true
      },
    }),
    {
      name: 'tetris-liberation-settings',
      version: 3,
      migrate: (state) => {
        const s = (state ?? {}) as Partial<Settings>
        const merged = {
          ...cloneDefaults(),
          ...s,
          attack: { ...DEFAULT_ATTACK },
          scoring: { ...DEFAULT_SCORING },
          keybinds: { ...cloneDefaults().keybinds, ...(s.keybinds ?? {}) },
          ai: { ...cloneDefaults().ai, ...(s.ai ?? {}) },
        }
        if (typeof s.effectsLevel !== 'number') {
          merged.effectsLevel = (s as Record<string, unknown>).particles === false ? 1 : DEFAULT_SETTINGS.effectsLevel
        }
        return merged
      },
    },
  ),
)
