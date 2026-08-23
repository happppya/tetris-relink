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

  it('combo increases sends multiplicatively and respects the cap', () => {
    const r1 = computeAttack(clear(4), DEFAULT_ATTACK, 1, false, 0)
    expect(r1.comboMult).toBeCloseTo(1.25)
    expect(r1.totalLines).toBe(5)
    const capped = computeAttack(clear(4), DEFAULT_ATTACK, 99, false, 0)
    expect(capped.comboMult).toBe(DEFAULT_ATTACK.comboMaxMult)
    expect(capped.totalLines).toBe(Math.round(4 * DEFAULT_ATTACK.comboMaxMult))
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
