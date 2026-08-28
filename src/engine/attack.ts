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
  comboStep: number
  comboMaxMult: number
  b2bBonus: number
  streakThreshold: number
}

export const DEFAULT_ATTACK: AttackConfig = {
  single: 0,
  double: 1,
  triple: 2,
  tetris: 4,
  spinSingle: 2,
  spinDouble: 4,
  spinTriple: 6,
  perfectClear: 10,
  comboStep: 0.25,
  comboMaxMult: 3,
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
  const comboMult = Math.min(1 + combo * config.comboStep, config.comboMaxMult)
  const b2b = b2bActive && isPowerClear && !clear.perfectClear

  const streakBonus = brokenStreak > config.streakThreshold ? brokenStreak : 0
  const total = Math.round(base * comboMult) + (b2b ? config.b2bBonus : 0) + streakBonus

  return {
    baseLines: base,
    totalLines: total,
    comboMult,
    b2b,
    streakBonus,
    streakSent: streakBonus > 0,
  }
}
