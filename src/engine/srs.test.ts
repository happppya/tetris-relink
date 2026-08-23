import { describe, expect, it } from 'vitest'
import { kickTable, tryRotate } from './srs'
import { cellsFor, spawnPiece } from './pieces'
import { HIDDEN_H, TOTAL_H, type Cell } from './types'

const JLSTZ_0_1 = [
  [0, 0],
  [-1, 0],
  [-1, 1],
  [0, -2],
  [-1, -2],
]
const I_0_1 = [
  [0, 0],
  [-2, 0],
  [1, 0],
  [-2, -1],
  [1, 2],
]

const EMPTY_BOARD: Cell[][] = Array.from({ length: TOTAL_H }, () => Array<Cell>(10).fill(null))

function tableToPairs(t: ReturnType<typeof kickTable>) {
  return t.map((p) => [p.x, p.y === 0 ? 0 : -p.y])
}

describe('SRS kick tables', () => {
  it('JLSTZ 0>R matches guideline order (guideline coords)', () => {
    expect(tableToPairs(kickTable('T', 0, 1))).toEqual(JLSTZ_0_1)
  })

  it('I 0>R matches guideline order (guideline coords)', () => {
    expect(tableToPairs(kickTable('I', 0, 1))).toEqual(I_0_1)
  })

  it('O never kicks off its position', () => {
    expect(kickTable('O', 0, 1)).toEqual([{ x: 0, y: 0 }])
    expect(kickTable('O', 3, 0)).toEqual([{ x: 0, y: 0 }])
  })

  it('has a kick table for every rotation transition of every piece', () => {
    for (const type of ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const) {
      for (let from = 0; from < 4; from++) {
        for (let to = 0; to < 4; to++) {
          const table = kickTable(type, from, to)
          expect(Array.isArray(table)).toBe(true)
          expect(table.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('uses a dedicated 180 kick set for half rotations', () => {
    const t = kickTable('T', 0, 2)
    expect(t[0]).toEqual({ x: 0, y: 0 })
    expect(t.length).toBeGreaterThan(1)
    expect(kickTable('I', 3, 1)[0]).toEqual({ x: 0, y: 0 })
  })
})

describe('tryRotate exhaustiveness', () => {
  const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const
  const DIRS = [1, -1, 2] as const

  const FLOOR_BOARD: Cell[][] = Array.from({ length: TOTAL_H }, (_, y) =>
    y === TOTAL_H - 1 ? (Array<Cell>(10).fill('J') as Cell[]) : (Array<Cell>(10).fill(null) as Cell[]),
  )
  const CRAMPED_BOARD: Cell[][] = EMPTY_BOARD.map((r) => [...r])
  for (const y of [TOTAL_H - 2, TOTAL_H - 1]) {
    for (let x = 0; x < 10; x++) if (x !== 4 && x !== 5) CRAMPED_BOARD[y][x] = 'J'
  }

  it('never throws and always returns a result or null, on any board', () => {
    const boards = [EMPTY_BOARD, FLOOR_BOARD, CRAMPED_BOARD]
    for (const type of PIECES) {
      for (let rot = 0; rot < 4; rot++) {
        for (const dir of DIRS) {
          for (const board of boards) {
            const piece = { type, rot: rot as 0 | 1 | 2 | 3, x: 3 + (rot % 2), y: TOTAL_H - 3 }
            expect(() => tryRotate(board, piece, dir)).not.toThrow()
          }
        }
      }
    }
  })

  it('performs a 180 rotation in open space with the first kick', () => {
    const piece = { type: 'T' as const, rot: 0 as const, x: 3, y: TOTAL_H - 4 }
    const result = tryRotate(EMPTY_BOARD, piece, 2)
    expect(result).not.toBeNull()
    expect(result!.piece.rot).toBe(2)
    expect(result!.kickIndex).toBe(0)
  })
})

describe('tryRotate', () => {
  it('kicks upward when rotating a grounded T', () => {
    const y = TOTAL_H - 2
    const piece = { type: 'T' as const, rot: 0 as const, x: 3, y }
    const result = tryRotate(EMPTY_BOARD, piece, 1)
    expect(result).not.toBeNull()
    expect(result!.piece.x).toBe(2)
    expect(result!.piece.y).toBe(y - 1)
    expect(result!.kickIndex).toBe(2)
  })

  it('returns null when no kick fits', () => {
    const y = TOTAL_H - 2
    const board = EMPTY_BOARD.map((r) => [...r])
    for (let yy = y - 2; yy <= y + 1; yy++) {
      if (yy >= 0 && yy < TOTAL_H) board[yy][1] = 'J'
    }
    const piece = { type: 'T' as const, rot: 0 as const, x: 0, y }
    expect(tryRotate(board, piece, 1)).toBeNull()
  })

  it('spawn pieces do not collide on an empty board', () => {
    for (const type of ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const) {
      expect(tryRotate(EMPTY_BOARD, spawnPiece(type), 1)).not.toBeNull()
    }
  })

  it('spawned pieces are immediately visible (lowest cell on first visible row)', () => {
    for (const type of ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const) {
      const p = spawnPiece(type)
      const cells = cellsFor(p.type, p.rot)
      const lowest = Math.max(...cells.map((c) => c.y)) + p.y
      expect(lowest).toBe(HIDDEN_H)
    }
  })
})
