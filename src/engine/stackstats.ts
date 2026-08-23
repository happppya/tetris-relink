import { BOARD_W, TOTAL_H, type Cell } from './types'

/** Filled-cell height of each column (0 = empty column). */
export function columnHeights(board: Cell[][]): number[] {
  const heights: number[] = []
  for (let x = 0; x < BOARD_W; x++) {
    let h = 0
    for (let y = 0; y < TOTAL_H; y++) {
      if (board[y][x] !== null) {
        h = TOTAL_H - y
        break
      }
    }
    heights.push(h)
  }
  return heights
}

/** Empty cells that have at least one filled cell somewhere above them. */
export function countHoles(board: Cell[][]): number {
  let holes = 0
  for (let x = 0; x < BOARD_W; x++) {
    let filledAbove = false
    for (let y = 0; y < TOTAL_H; y++) {
      if (board[y][x] !== null) filledAbove = true
      else if (filledAbove) holes++
    }
  }
  return holes
}

/** Sum of absolute height differences between adjacent columns. */
export function bumpiness(heights: number[]): number {
  let sum = 0
  for (let i = 0; i < heights.length - 1; i++) sum += Math.abs(heights[i] - heights[i + 1])
  return sum
}

/** Row index of the highest filled cell, or TOTAL_H on an empty board. */
export function stackTop(board: Cell[][]): number {
  for (let y = 0; y < TOTAL_H; y++) {
    if (board[y].some((c) => c !== null)) return y
  }
  return TOTAL_H
}
