import type { LobbySettings } from './protocol.ts'

export const DEFAULT_LOBBY_SETTINGS: LobbySettings = { mode: 'firstToX', goal: 7, winBy: 2 }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clampInt = (v: unknown, min: number, max: number, fallback: number) =>
  isNum(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback

/** Server-authoritative: clamps and normalizes any untrusted settings payload. */
export function sanitizeLobbySettings(raw: unknown): LobbySettings {
  const out: LobbySettings = { ...DEFAULT_LOBBY_SETTINGS }
  if (typeof raw !== 'object' || raw === null) return out
  const r = raw as Record<string, unknown>
  if (r.mode === 'firstToX' || r.mode === 'winByX') out.mode = r.mode
  out.goal = clampInt(r.goal, 1, 99, out.goal)
  out.winBy = clampInt(r.winBy, 1, 99, out.winBy)
  return out
}

export function sanitizeName(raw: unknown, fallback = 'PLAYER'): string {
  if (typeof raw !== 'string') return fallback
  const name = raw.trim().replace(/\p{Cc}/gu, '').slice(0, 16)
  return name.length > 0 ? name : fallback
}

export function describeLobbySettings(s: LobbySettings): string {
  return s.mode === 'firstToX' ? `FIRST TO ${s.goal}` : `WIN BY ${s.winBy}`
}