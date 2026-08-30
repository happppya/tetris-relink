import type { PieceType } from './types.ts'

export interface AttackConfig {
  single: number
  double: number
  triple: number
  tetris: number
  spinSingle: number
  spinDouble: number
  spinTriple: number
  perfectClear: number
  b2bBonus: number
  streakThreshold: number
}

/** how many queued garbage rows land on a single non-clearing placement (the rest stay owed) */
export const GARBAGE_PER_PLACEMENT = 8

export const DEFAULT_ATTACK: AttackConfig = {
  single: 0,
  double: 1,
  triple: 2,
  tetris: 4,
  spinSingle: 2,
  spinDouble: 4,
  spinTriple: 6,
  perfectClear: 10,
  b2bBonus: 1,
  streakThreshold: 3,
}

export type SpinKind = 'none' | 'mini' | 'full'

export interface ClearInfo {
  count: number
  spin: SpinKind
  piece: PieceType | null
  perfectClear: boolean
}

export interface AttackResult {
  baseLines: number
  totalLines: number
  comboMult: number
  b2b: boolean
  streakBonus: number
  streakSent: boolean
}

export function computeAttack(
  clear: ClearInfo,
  config: AttackConfig,
  combo: number,
  b2bActive: boolean,
  brokenStreak: number,
): AttackResult {
  let base = 0
  if (clear.perfectClear) {
    base += config.perfectClear
  } else if (clear.spin !== 'none') {
    if (clear.spin === 'mini') base += Math.ceil(config.spinSingle / 2)
    else if (clear.count === 1) base += config.spinSingle
    else if (clear.count === 2) base += config.spinDouble
    else base += config.spinTriple
  } else {
    base += [config.single, config.double, config.triple, config.tetris][clear.count - 1] ?? 0
  }

  const isPowerClear = clear.spin !== 'none' || clear.count >= 4
  const b2b = b2bActive && isPowerClear && !clear.perfectClear

  // Exact combo scaling: attack = base * (1 + 0.25 * combo), no cap — larger
  // base attacks gain more absolute lines per combo step. Zero-base attacks
  // (e.g. singles with a 0 table value) grow via ln(1 + 1.25 * combo) from the
  // 2-combo on, so long chains of weak clears eventually send something.
  // All values are rounded DOWN.
  const comboMult = 1 + combo * 0.25
  const scaled = base === 0 && combo >= 1 ? Math.floor(Math.log(1 + 1.25 * combo)) : Math.floor(base * comboMult)

  const streakBonus = brokenStreak > config.streakThreshold ? brokenStreak : 0
  const total = scaled + (b2b ? config.b2bBonus : 0) + streakBonus

  return {
    baseLines: base,
    totalLines: total,
    comboMult,
    b2b,
    streakBonus,
    streakSent: streakBonus > 0,
  }
}
