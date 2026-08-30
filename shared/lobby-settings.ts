import type { LobbySettings } from './protocol.ts'

export const DEFAULT_LOBBY_SETTINGS: LobbySettings = { mode: 'firstToX', goal: 7, winBy: 2, fourWide: false }

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
  if (typeof r.fourWide === 'boolean') out.fourWide = r.fourWide
  return out
}

export function sanitizeName(raw: unknown, fallback = 'PLAYER'): string {
  if (typeof raw !== 'string') return fallback
  const name = raw.trim().replace(/\p{Cc}/gu, '').slice(0, 16)
  return name.length > 0 ? name : fallback
}

export function describeLobbySettings(s: LobbySettings): string {
  const base = s.mode === 'firstToX' ? `FIRST TO ${s.goal}` : `WIN BY ${s.winBy}`
  return s.fourWide ? `${base} · 4-WIDE` : base
}

/**
 * A player is on match point when winning one more round would clinch the
 * match under the lobby's rules: already at goal-1 wins (first-to-X), or a
 * single win away from the required lead (win-by-X).
 */
export function isMatchPoint(wins: Record<string, number>, settings: LobbySettings, playerId: string): boolean {
  const mine = wins[playerId] ?? 0
  if (settings.mode === 'firstToX') return mine >= settings.goal - 1 && mine < settings.goal
  const bestOther = Math.max(0, ...Object.entries(wins).filter(([id]) => id !== playerId).map(([, v]) => v))
  // one more win must clinch the match, and the match must not already be won
  return mine + 1 - bestOther >= settings.winBy && mine - bestOther < settings.winBy
}