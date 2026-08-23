import { BOARD_W, TOTAL_H, type Cell, type PieceType } from '../engine/types'
import { cellsFor } from '../engine/pieces'

export interface PlacementLike {
  type: PieceType
  x: number
  rot: number
  /** exact occupied cells as [col, rowFromBottom], when provided by cc2 */
  cells?: [number, number][]
}

function landingY(board: Cell[][], type: PieceType, rot: number, px: number): number | null {
  const cells = cellsFor(type, rot)
  let py = -4
  outer: for (;;) {
    for (const c of cells) {
      const y = py + c.y + 1
      if (y >= TOTAL_H || (y >= 0 && board[y][px + c.x] !== null)) break outer
    }
    py++
  }
  for (const c of cells) {
    const y = py + c.y
    if (y < 0 || board[y][px + c.x] !== null) return null
  }
  return py
}

export function landingRowForHint(board: Cell[][], p: PlacementLike): number | null {
  return landingY(board, p.type, p.rot, p.x)
}

export function placementCells(board: Cell[][], p: PlacementLike): { x: number; y: number }[] | null {
  if (p.cells?.length === 4) {
    return p.cells.map(([cx, cy]) => ({ x: cx, y: TOTAL_H - 1 - cy }))
  }
  const row = landingRowForHint(board, p)
  if (row === null) return null
  return cellsFor(p.type, p.rot).map((c) => ({ x: p.x + c.x, y: row + c.y }))
}

/** applies a placement to a copy of the board including line clears */
export function applyPlacementToBoard(board: Cell[][], p: PlacementLike): Cell[][] | null {
  const work = board.map((row) => [...row])
  const cells = placementCells(board, p)
  if (!cells) return null
  for (const c of cells) {
    if (c.x < 0 || c.x >= BOARD_W || c.y < 0 || c.y >= TOTAL_H) return null
    if (work[c.y][c.x] !== null) return null
    work[c.y][c.x] = p.type
  }
  const full: number[] = []
  for (let y = 0; y < TOTAL_H; y++) if (work[y].every((c) => c !== null)) full.push(y)
  for (const y of full) {
    work.splice(y, 1)
    work.unshift(Array<Cell>(BOARD_W).fill(null))
  }
  return work
}

export function boardsEqual(a: Cell[][], b: Cell[][]): boolean {
  for (let y = 0; y < TOTAL_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      if (a[y][x] !== b[y][x]) return false
    }
  }
  return true
}
