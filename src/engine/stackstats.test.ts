import { describe, expect, it } from 'vitest'
import { bumpiness, columnHeights, countHoles, stackTop } from './stackstats'
import { TOTAL_H, type Cell } from './types'

const emptyBoard = (): Cell[][] => Array.from({ length: TOTAL_H }, () => Array<Cell>(10).fill(null))

function board(rows: string[]): Cell[][] {
  const b = emptyBoard()
  rows.forEach((row, i) => {
    const y = TOTAL_H - 1 - i
    row.split('').forEach((c, x) => {
      b[y][x] = c === '.' ? null : (c as Cell)
    })
  })
  return b
}

describe('stackstats', () => {
  it('measures heights', () => {
    expect(columnHeights(board(['XX........']))).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(columnHeights(emptyBoard())).toEqual(Array(10).fill(0))
  })

  it('counts covered holes only', () => {
    // col 2 has a gap under a filled cell; col 3 open to the sky
    const b = board(['X.X........'.slice(0, 10), 'XXX.......X'.slice(0, 10)])
    expect(countHoles(b)).toBe(1)
  })

  it('sums adjacent height differences', () => {
    expect(bumpiness([0, 2, 5, 5, 0, 0, 0, 0, 0, 0])).toBe(2 + 3 + 0 + 5)
  })

  it('finds the highest filled row', () => {
    expect(stackTop(emptyBoard())).toBe(TOTAL_H)
    const b = board(['..........', 'X.........'])
    expect(stackTop(b)).toBe(TOTAL_H - 2)
  })
})
