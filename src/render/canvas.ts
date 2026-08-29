import type { ActivePiece, Cell } from '../engine/types'
import { BOARD_W, HIDDEN_H, TOTAL_H, VISIBLE_H, type PieceType } from '../engine/types'
import { cellsFor } from '../engine/pieces'

export const PIECE_COLORS: Record<string, string> = {
  I: '#5fb8bf',
  O: '#b8ad5f',
  T: '#a98cbf',
  S: '#7fbf7f',
  Z: '#bf7f7f',
  J: '#7f93bf',
  L: '#bf9a5f',
  G: '#484848',
  W: '#3a3a3a',
}

export const EMPTY_COLOR = '#0a0a0a'
export const GRID_COLOR = '#1c1c1c'
export const DANGER_COLOR = '#5a2020'

export interface BoardRenderOpts {
  cellSize: number
  showGhost: boolean
}

function drawCell(ctx: CanvasRenderingContext2D, px: number, py: number, size: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(px + 1, py + 1, size - 2, size - 2)
}

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  board: Cell[][],
  active: ActivePiece | null,
  ghost: ActivePiece | null,
  opts: BoardRenderOpts,
) {
  const { cellSize, showGhost } = opts
  const w = BOARD_W * cellSize
  // opponent relays carry only the 20 visible rows; pad the hidden ones so the
  // same renderer handles both shapes
  const full =
    Array.isArray(board) && board.length === VISIBLE_H && board.every((row) => Array.isArray(row) && row.length === BOARD_W)
      ? [...Array.from({ length: HIDDEN_H }, () => Array<Cell>(BOARD_W).fill(null)), ...board]
      : board
  if (!Array.isArray(full) || full.length !== TOTAL_H || full.some((row) => !Array.isArray(row) || row.length !== BOARD_W)) return
  const h = VISIBLE_H * cellSize

  let dangerRow = TOTAL_H
  for (let y = HIDDEN_H; y < TOTAL_H; y++) {
    if (full[y].some((c) => c !== null)) {
      dangerRow = y
      break
    }
  }

  ctx.fillStyle = EMPTY_COLOR
  ctx.fillRect(0, 0, w, h)

  if (dangerRow < HIDDEN_H + 6) {
    ctx.fillStyle = DANGER_COLOR
    ctx.globalAlpha = 0.25
    ctx.fillRect(0, 0, w, (HIDDEN_H + 6 - dangerRow) * cellSize)
    ctx.globalAlpha = 1
  }

  ctx.strokeStyle = GRID_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 1; x < BOARD_W; x++) {
    ctx.moveTo(x * cellSize + 0.5, 0)
    ctx.lineTo(x * cellSize + 0.5, h)
  }
  for (let y = 1; y < VISIBLE_H; y++) {
    ctx.moveTo(0, y * cellSize + 0.5)
    ctx.lineTo(w, y * cellSize + 0.5)
  }
  ctx.stroke()

  if (showGhost && ghost) {
    ctx.globalAlpha = 0.3
    for (const c of cellsFor(ghost.type, ghost.rot)) {
      const gy = ghost.y + c.y - HIDDEN_H
      if (gy >= 0) drawCell(ctx, (ghost.x + c.x) * cellSize, gy * cellSize, cellSize, PIECE_COLORS[ghost.type])
    }
    ctx.globalAlpha = 1
  }

  for (let y = HIDDEN_H; y < TOTAL_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      const cell = full[y][x]
      if (cell !== null) drawCell(ctx, x * cellSize, (y - HIDDEN_H) * cellSize, cellSize, PIECE_COLORS[cell])
    }
  }

  if (active) {
    for (const c of cellsFor(active.type, active.rot)) {
      const ay = active.y + c.y - HIDDEN_H
      if (ay >= 0) drawCell(ctx, (active.x + c.x) * cellSize, ay * cellSize, cellSize, PIECE_COLORS[active.type])
    }
  }
}

export function drawMiniPiece(
  ctx: CanvasRenderingContext2D,
  type: PieceType | null,
  centerX: number,
  centerY: number,
  cellSize: number,
) {
  if (!type) return
  const cells = cellsFor(type, 0)
  const xs = cells.map((c) => c.x)
  const ys = cells.map((c) => c.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const pw = (maxX - minX + 1) * cellSize
  const ph = (maxY - minY + 1) * cellSize
  const ox = centerX - pw / 2
  const oy = centerY - ph / 2
  for (const c of cells) {
    ctx.fillStyle = PIECE_COLORS[type]
    ctx.fillRect(ox + (c.x - minX) * cellSize + 1, oy + (c.y - minY) * cellSize + 1, cellSize - 2, cellSize - 2)
  }
}
