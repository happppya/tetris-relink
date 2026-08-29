import { describe, expect, it } from 'vitest'
import { DEFAULT_ATTACK, computeAttack, type ClearInfo } from './attack'

const clear = (count: number, spin: ClearInfo['spin'] = 'none', pc = false): ClearInfo => ({
  count,
  spin,
  piece: spin !== 'none' ? 'T' : null,
  perfectClear: pc,
})

describe('computeAttack', () => {
  it('uses the default attack table values', () => {
    expect(computeAttack(clear(4), DEFAULT_ATTACK, 0, false, 0).totalLines).toBe(4)
    expect(computeAttack(clear(1, 'full'), DEFAULT_ATTACK, 0, false, 0).totalLines).toBe(2)
    expect(computeAttack(clear(2, 'full'), DEFAULT_ATTACK, 0, false, 0).totalLines).toBe(4)
    expect(computeAttack(clear(1, 'none', true), DEFAULT_ATTACK, 0, false, 0).totalLines).toBe(10)
  })

  it('matches the reference attack table', () => {
    const send = (count: number, spin: ClearInfo['spin'] = 'none', pc = false) =>
      computeAttack(clear(count, spin, pc), DEFAULT_ATTACK, 0, false, 0).totalLines
    expect(send(1)).toBe(0)
    expect(send(2)).toBe(1)
    expect(send(3)).toBe(2)
    expect(send(4)).toBe(4)
    expect(send(1, 'full')).toBe(2)
    expect(send(2, 'full')).toBe(4)
    expect(send(3, 'full')).toBe(6)
    expect(send(1, 'none', true)).toBe(10)
  })

  it('sends nothing for plain singles but sends for doubles/triples', () => {
    expect(computeAttack(clear(1), DEFAULT_ATTACK, 0, false, 0).totalLines).toBe(0)
    expect(computeAttack(clear(2), DEFAULT_ATTACK, 0, false, 0).totalLines).toBe(1)
    expect(computeAttack(clear(3), DEFAULT_ATTACK, 0, false, 0).totalLines).toBe(2)
  })

  it('combo scales exactly as base * (1 + 0.25 * combo), floored, with no cap', () => {
    const r0 = computeAttack(clear(4), DEFAULT_ATTACK, 0, false, 0)
    expect(r0.comboMult).toBeCloseTo(1)
    expect(r0.totalLines).toBe(4)
    const r1 = computeAttack(clear(4), DEFAULT_ATTACK, 1, false, 0)
    expect(r1.comboMult).toBeCloseTo(1.25)
    expect(r1.totalLines).toBe(5) // floor(4 * 1.25)
    const r2 = computeAttack(clear(4), DEFAULT_ATTACK, 2, false, 0)
    expect(r2.comboMult).toBeCloseTo(1.5)
    expect(r2.totalLines).toBe(6) // floor(4 * 1.5)
    // a small base benefits less per combo step: triple 2 * 1.5 = 3
    expect(computeAttack(clear(3), DEFAULT_ATTACK, 2, false, 0).totalLines).toBe(3)
    // no multiplier cap: an extreme combo keeps scaling
    const big = computeAttack(clear(4), DEFAULT_ATTACK, 99, false, 0)
    expect(big.comboMult).toBeCloseTo(1 + 99 * 0.25)
    expect(big.totalLines).toBe(Math.floor(4 * (1 + 99 * 0.25)))
  })

  it('zero-base attacks grow via ln(1 + 1.25 * combo) from the 2-combo on, floored', () => {
    // x=0 (first clear): 0; x=1 (2-combo): floor(ln(2.25)) = 0
    expect(computeAttack(clear(1), DEFAULT_ATTACK, 0, false, 0).totalLines).toBe(0)
    expect(computeAttack(clear(1), DEFAULT_ATTACK, 1, false, 0).totalLines).toBe(0)
    // x=2: floor(ln(3.5)) = 1; x=3: floor(ln(4.75)) = 1
    expect(computeAttack(clear(1), DEFAULT_ATTACK, 2, false, 0).totalLines).toBe(1)
    expect(computeAttack(clear(1), DEFAULT_ATTACK, 3, false, 0).totalLines).toBe(1)
    // x=6: floor(ln(8.5)) = 2; x=16: floor(ln(21)) = 3
    expect(computeAttack(clear(1), DEFAULT_ATTACK, 6, false, 0).totalLines).toBe(2)
    expect(computeAttack(clear(1), DEFAULT_ATTACK, 16, false, 0).totalLines).toBe(3)
  })

  it('back-to-back adds bonus lines on power clears', () => {
    const r = computeAttack(clear(4), DEFAULT_ATTACK, 0, true, 0)
    expect(r.b2b).toBe(true)
    expect(r.totalLines).toBe(5)
  })

  it('streak bonus only sends above the threshold', () => {
    const atThreshold = computeAttack(clear(4), DEFAULT_ATTACK, 0, false, DEFAULT_ATTACK.streakThreshold)
    expect(atThreshold.streakSent).toBe(false)
    const over = computeAttack(clear(4), DEFAULT_ATTACK, 0, false, DEFAULT_ATTACK.streakThreshold + 1)
    expect(over.streakSent).toBe(true)
    expect(over.totalLines).toBe(4 + DEFAULT_ATTACK.streakThreshold + 1)
  })
})
