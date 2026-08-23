import { describe, expect, it } from 'vitest'
import { Game, detectSpin } from '../engine/game'
import { TOTAL_H, type Cell } from '../engine/types'
import { buildPlacementScript } from './executor'

const HANDLING = { dasFrames: 1, arrFrames: 1, sddFrames: 0 }

function emptyBoard(): Cell[][] {
  return Array.from({ length: TOTAL_H }, () => Array<Cell>(10).fill(null))
}

function setBlocks(board: Cell[][], blocks: [number, number][]): void {
  for (const [x, y] of blocks) board[y][x] = 'G'
}

describe('placement executor', () => {
  it('executes a straight-drop plan exactly', () => {
    const game = new Game({ handling: HANDLING })
    game.active = { type: 'T', rot: 0, x: 3, y: 3 }
    // flat T on the floor, box origin x=5 (bar on floor, nub on top)
    const cells: [number, number][] = [
      [5, 0],
      [6, 0],
      [7, 0],
      [6, 1],
    ]
    const script = buildPlacementScript(game, { pps: 1.5, handling: HANDLING }, { type: 'plan', x: 5, rot: 0, spin: 'none', cells })
    expect(script.length).toBeGreaterThan(0)
    for (const step of script) game.tick(step)
    expect(game.active).not.toBeNull() // next piece spawned
    const bottom = game.board[TOTAL_H - 1]
    expect(bottom[5]).toBe('T')
    expect(bottom[6]).toBe('T')
    expect(bottom[7]).toBe('T')
    expect(game.board[TOTAL_H - 2][6]).toBe('T')
  })

  it('performs a real t-spin maneuver when the plan requires one', () => {
    const board = emptyBoard()
    // wall t-slot: corner blocks leaving col 7 open for the descent
    setBlocks(board, [
      [9, 21],
      [7, 23],
      [9, 23],
    ])
    const game = new Game({ seed: 7, handling: HANDLING })
    game.board = board
    game.active = { type: 'T', rot: 0, x: 7, y: 19 }

    // T-East snapped into the notch by a final CW rotation -> full spin
    const cells: [number, number][] = [
      [8, 2], // (8,21)
      [8, 1], // (8,22)
      [9, 1], // (9,22)
      [8, 0], // (8,23)
    ]
    const script = buildPlacementScript(
      game,
      { pps: 1.5, handling: HANDLING },
      { type: 'plan', x: 7, rot: 1, spin: 'full', cells },
    )
    expect(script.length).toBeGreaterThan(0)

    for (const step of script) game.tick(step)
    // the locked piece occupies the planned cells
    expect(game.board[21][8]).toBe('T')
    expect(game.board[22][8]).toBe('T')
    expect(game.board[22][9]).toBe('T')
    expect(game.board[23][8]).toBe('T')
    // and the engine registered the spin
    const piece = { type: 'T' as const, rot: 1 as const, x: 7, y: 21 }
    const spin = detectSpin(game.board, piece, 0)
    expect(spin.spin).toBe('full')
  }, 30000)
})
