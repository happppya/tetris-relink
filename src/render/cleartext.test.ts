import { describe, expect, it } from 'vitest'
import { clearLabels } from './cleartext'
import type { ClearInfo } from '../engine/attack'

const info = (over: Partial<ClearInfo>): ClearInfo => ({
  count: 1,
  spin: 'none',
  piece: null,
  perfectClear: false,
  ...over,
})

describe('clearLabels', () => {
  it('labels plain clears by count', () => {
    expect(clearLabels(info({ count: 1 }))).toEqual(['SINGLE'])
    expect(clearLabels(info({ count: 2 }))).toEqual(['DOUBLE'])
    expect(clearLabels(info({ count: 3 }))).toEqual(['TRIPLE'])
    expect(clearLabels(info({ count: 4 }))).toEqual(['TETRIS'])
  })

  it('labels spins with piece and size, mini included', () => {
    expect(clearLabels(info({ count: 2, spin: 'full', piece: 'T' }))).toEqual(['T-SPIN DOUBLE'])
    expect(clearLabels(info({ count: 1, spin: 'full', piece: 'S' }))).toEqual(['S-SPIN SINGLE'])
    expect(clearLabels(info({ count: 3, spin: 'full', piece: 'Z' }))).toEqual(['Z-SPIN TRIPLE'])
    expect(clearLabels(info({ count: 1, spin: 'mini', piece: 'T' }))).toEqual(['MINI T-SPIN SINGLE'])
  })

  it('adds perfect clear as its own label', () => {
    expect(clearLabels(info({ count: 4, perfectClear: true }))).toEqual(['TETRIS', 'PERFECT CLEAR'])
    expect(clearLabels(info({ count: 1, spin: 'full', piece: 'T', perfectClear: true }))).toEqual([
      'T-SPIN SINGLE',
      'PERFECT CLEAR',
    ])
  })
})
