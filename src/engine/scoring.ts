export interface ScoringConfig {
  blitzSpinMult: number
  blitzTetrisMult: number
  blitzPcBonus: number
}

export const DEFAULT_SCORING: ScoringConfig = {
  blitzSpinMult: 2,
  blitzTetrisMult: 1.5,
  blitzPcBonus: 3000,
}

const CLEAR_SCORES = [100, 300, 500, 800]
const TSPIN_SCORES = [800, 1200, 1600]

export function gravitySecondsPerRow(level: number): number {
  return Math.pow(0.8 - (level - 1) * 0.007, level - 1)
}

export function clearScore(
  count: number,
  spin: boolean,
  spinMini: boolean,
  pc: boolean,
  level: number,
): number {
  let s: number
  if (spin) {
    if (spinMini) s = 200
    else s = TSPIN_SCORES[Math.min(count, 3) - 1]
  } else {
    s = CLEAR_SCORES[Math.min(count, 4) - 1]
  }
  if (pc) s += 10 * s
  return s * level
}

export function comboScore(combo: number, level: number): number {
  return combo > 0 ? 50 * combo * level : 0
}
