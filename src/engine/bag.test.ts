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

  it('reset deals a full fresh bag instead of continuing the drained one', () => {
    const bag = new Bag(mulberry32(7))
    // drain well past a full bag, leaving a mid-shuffle remainder
    for (let i = 0; i < 20; i++) bag.next()
    const continuation = bag.peek(5)

    bag.reset()
    const window = Array.from({ length: 7 }, () => bag.next())
    // a full 7-bag, and not the same run of pieces the drained bag would have given
    expect([...window].sort()).toEqual([...PIECE_TYPES].sort())
    expect(window.slice(0, 5)).not.toEqual(continuation)
  })

  it('reset re-arms the fixed prefix so scripted pieces come back', () => {
    const bag = new Bag(mulberry32(3), ['I', 'O'])
    expect(bag.next()).toBe('I')
    expect(bag.next()).toBe('O')
    bag.reset()
    expect(bag.next()).toBe('I')
    expect(bag.next()).toBe('O')
  })

  it('reset is repeatable and keeps the 7-piece guarantee', () => {
    const bag = new Bag(mulberry32(11), ['T'])
    for (let round = 0; round < 3; round++) {
      expect(bag.next()).toBe('T')
      const seq = Array.from({ length: 7 }, () => bag.next())
      expect([...seq].sort()).toEqual([...PIECE_TYPES].sort())
      bag.reset()
    }
  })
})
