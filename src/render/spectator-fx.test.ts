import { describe, expect, it } from 'vitest'
import { detectClearedRows } from './spectator-fx'
import type { Cell } from '../engine/types'

const empty = (): Cell[][] => Array.from({ length: 20 }, () => Array<Cell>(10).fill(null))

const fillRow = (b: Cell[][], y: number) => {
  b[y] = Array<Cell>(10).fill('J')
}

const partialRow = (b: Cell[][], y: number) => {
  b[y] = Array<Cell>(10).fill('J')
  b[y][5] = null
}

describe('detectClearedRows (spectator board diffs)', () => {
  it('detects a single clear at the row that emptied', () => {
    const prev = empty()
    const next = empty()
    fillRow(prev, 19)
    partialRow(next, 19)
    expect(detectClearedRows(prev, next)).toEqual([19])
  })

  it('detects multi-row clears (double / tetris)', () => {
    const prev = empty()
    const next = empty()
    fillRow(prev, 16)
    fillRow(prev, 17)
    fillRow(prev, 18)
    fillRow(prev, 19)
    partialRow(next, 16)
    partialRow(next, 17)
    partialRow(next, 18)
    partialRow(next, 19)
    expect(detectClearedRows(prev, next)).toEqual([16, 17, 18, 19])
  })

  it('reports nothing when the board is unchanged', () => {
    const prev = empty()
    const next = empty()
    fillRow(prev, 19)
    fillRow(next, 19)
    expect(detectClearedRows(prev, next)).toEqual([])
  })

  it('does not fire on garbage (rows only ever gain cells)', () => {
    const prev = empty()
    const next = empty()
    partialRow(prev, 19)
    fillRow(next, 19) // garbage filled the rest
    expect(detectClearedRows(prev, next)).toEqual([])
  })

  it('still catches a clear when a full row above drops into the gap', () => {
    const prev = empty()
    const next = empty()
    fillRow(prev, 18)
    fillRow(prev, 19)
    // row 19 cleared; the full row that was at 18 dropped into 19
    fillRow(next, 19)
    partialRow(next, 18)
    const cleared = detectClearedRows(prev, next)
    expect(cleared.length).toBeGreaterThan(0)
    // reported at the index that emptied (one row off from the true clear)
    expect(cleared).toContain(18)
  })

  it('catches a perfect clear (board empties entirely)', () => {
    const prev = empty()
    fillRow(prev, 19)
    expect(detectClearedRows(prev, empty())).toEqual([19])
  })

  it('tolerates mismatched heights by scanning the shared rows', () => {
    const prev = empty().slice(0, 19) // short relay
    const next = empty()
    fillRow(prev, 18)
    partialRow(next, 18)
    expect(detectClearedRows(prev, next)).toEqual([18])
  })
})
