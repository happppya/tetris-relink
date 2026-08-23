import { describe, expect, it } from 'vitest'
import { Bag, mulberry32 } from './bag'
import { PIECE_TYPES } from './types'

describe('Bag', () => {
  it('is deterministic for a given seed', () => {
    const a = new Bag(mulberry32(1234))
    const b = new Bag(mulberry32(1234))
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('contains all 7 pieces exactly once in every window of 7', () => {
    const bag = new Bag(mulberry32(42))
    const seq = Array.from({ length: 70 }, () => bag.next())
    for (let i = 0; i < 70; i += 7) {
      expect([...seq.slice(i, i + 7)].sort()).toEqual([...PIECE_TYPES].sort())
    }
  })

  it('peek returns upcoming pieces consistently with next', () => {
    const bag = new Bag(mulberry32(7))
    const peeked = bag.peek(5)
    const dealt = Array.from({ length: 5 }, () => bag.next())
    expect(dealt).toEqual(peeked)
  })
})
