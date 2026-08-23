import { describe, expect, it } from 'vitest'
import { detectSpin } from './game'
import { DRILLS, parseDrillBoard } from './drills'
import { Game } from './game'
import { cellsFor, spawnPiece } from './pieces'
import { tryMove, tryRotate } from './srs'
import { TOTAL_H, type ActivePiece, type Cell } from './types'

const pieceKey = (p: ActivePiece) => `${p.rot},${p.x},${p.y}`

/** All grounded placements reachable from `start` using shifts, gravity and SRS kicks. */
function reachableLocks(board: Cell[][], start: ActivePiece): ActivePiece[] {
  const seen = new Set<string>([pieceKey(start)])
  const queue: ActivePiece[] = [start]
  const locks = new Map<string, ActivePiece>()
  while (queue.length > 0) {
    const p = queue.shift()!
    if (!tryMove(board, p, 0, 1)) locks.set(pieceKey(p), p)
    const nexts = [
      tryMove(board, p, -1, 0),
      tryMove(board, p, 1, 0),
      tryMove(board, p, 0, 1),
      tryRotate(board, p, 1)?.piece ?? null,
      tryRotate(board, p, -1)?.piece ?? null,
      tryRotate(board, p, 2)?.piece ?? null,
    ]
    for (const n of nexts) {
      if (!n) continue
      const k = pieceKey(n)
      if (!seen.has(k)) {
        seen.add(k)
        queue.push(n)
      }
    }
  }
  return [...locks.values()]
}

function lockOutcome(
  board: Cell[][],
  p: ActivePiece,
): { clears: number; spin: 'none' | 'mini' | 'full' } {
  const b: Cell[][] = board.map((row) => [...row])
  for (const c of cellsFor(p.type, p.rot)) {
    const y = p.y + c.y
    if (y < 0) return { clears: 0, spin: 'none' }
    b[y][p.x + c.x] = p.type
  }
  const spin = detectSpin(b, p, 0).spin
  let clears = 0
  for (let y = 0; y < TOTAL_H; y++) {
    if (b[y].every((c) => c !== null)) {
      clears++
      b.splice(y, 1)
      b.unshift(Array<Cell>(10).fill(null))
    }
  }
  return { clears, spin }
}

describe('drill catalog', () => {
  it('is well-formed', () => {
    const ids = new Set<string>()
    for (const d of DRILLS) {
      expect(ids.has(d.id)).toBe(false)
      ids.add(d.id)
      expect(d.blurb.length).toBeGreaterThan(0)
      expect(d.tips.length).toBeGreaterThan(0)
      if (d.board) expect(() => parseDrillBoard(d.board!)).not.toThrow()
      if (d.maxPieces !== undefined && 'count' in d.goal) {
        expect(d.maxPieces).toBeGreaterThanOrEqual(d.goal.count)
      }
    }
  })

  it('preset boards parse to the right shape', () => {
    for (const d of DRILLS.filter((x) => x.board)) {
      const board = parseDrillBoard(d.board!)
      expect(board).toHaveLength(TOTAL_H)
      expect(board.every((row) => row.length === 10)).toBe(true)
    }
  })
})

describe('spin drill solvability', () => {
  const expectedClears: Record<string, number> = {
    'tsd-classic': 2,
    'tsd-mirror': 2,
  }

  for (const [id, clears] of Object.entries(expectedClears)) {
    it(`${id} admits a full-spin ${clears}-clear`, () => {
      const drill = DRILLS.find((d) => d.id === id)!
      const board = parseDrillBoard(drill.board!)
      const start = spawnPiece(drill.queue![0])
      expect(start.type).toBe('T')
      expect(reachableLocks(board, start).some((p) => {
        const out = lockOutcome(board, p)
        return out.spin === 'full' && out.clears === clears
      })).toBe(true)
    })
  }
})

describe('drill game options', () => {
  it('Game honors initialBoard and fixedQueue', () => {
    const drill = DRILLS.find((d) => d.board && d.queue)!
    const board = parseDrillBoard(drill.board!)
    const queue = drill.queue!
    const g = new Game({ seed: 42, initialBoard: board, fixedQueue: [...queue] })
    expect(g.board).toEqual(board)
    expect(g.active!.type).toBe(queue[0])
    // preview shows the remaining fixed pieces before random ones appear
    expect(g.nextQueue).toEqual(queue.slice(1, 6))
  })
})
