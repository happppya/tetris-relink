import { cellsFor } from './pieces.ts'
import type { ActivePiece, Cell, Pos } from './types.ts'
import { BOARD_W, TOTAL_H } from './types.ts'

type Kick = readonly Pos[]
const k = (pairs: [number, number][]): Kick => pairs.map(([x, y]) => ({ x, y: y === 0 ? 0 : -y }))

const JLSTZ_KICKS: Record<string, Kick> = {
  '0>1': k([
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ]),
  '1>0': k([
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ]),
  '1>2': k([
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ]),
  '2>1': k([
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ]),
  '2>3': k([
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ]),
  '3>2': k([
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ]),
  '3>0': k([
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ]),
  '0>3': k([
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ]),
}

const I_KICKS: Record<string, Kick> = {
  '0>1': k([
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ]),
  '1>0': k([
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ]),
  '1>2': k([
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ]),
  '2>1': k([
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ]),
  '2>3': k([
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ]),
  '3>2': k([
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ]),
  '3>0': k([
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ]),
  '0>3': k([
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ]),
}

const KICKS_180: Kick = k([
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, -1],
])

export function kickTable(type: PieceTypeLike, from: number, to: number): Kick {
  if (type === 'O') return [{ x: 0, y: 0 }]
  const f = ((from % 4) + 4) % 4
  const t = ((to % 4) + 4) % 4
  if ((t - f + 4) % 4 === 2) return KICKS_180
  return (type === 'I' ? I_KICKS : JLSTZ_KICKS)[`${f}>${t}`] ?? [{ x: 0, y: 0 }]
}

type PieceTypeLike = ActivePiece['type']

function collides(board: Cell[][], cells: readonly Pos[], px: number, py: number): boolean {
  for (const c of cells) {
    const x = px + c.x
    const y = py + c.y
    if (x < 0 || x >= BOARD_W || y >= TOTAL_H) return true
    if (y >= 0 && board[y][x] !== null) return true
  }
  return false
}

export function pieceCollides(board: Cell[][], p: ActivePiece): boolean {
  return collides(board, cellsFor(p.type, p.rot), p.x, p.y)
}

export interface RotateResult {
  piece: ActivePiece
  kickIndex: number
}

export function tryRotate(
  board: Cell[][],
  piece: ActivePiece,
  dir: 1 | -1 | 2,
): RotateResult | null {
  const from = piece.rot
  const to = (((from + dir) % 4) + 4) % 4 as ActivePiece['rot']
  const kicks = kickTable(piece.type, from, to)
  for (let i = 0; i < kicks.length; i++) {
    const nx = piece.x + kicks[i].x
    const ny = piece.y + kicks[i].y
    if (!collides(board, cellsFor(piece.type, to), nx, ny)) {
      return { piece: { ...piece, rot: to, x: nx, y: ny }, kickIndex: i }
    }
  }
  return null
}

export function tryMove(board: Cell[][], piece: ActivePiece, dx: number, dy: number): ActivePiece | null {
  const nx = piece.x + dx
  const ny = piece.y + dy
  if (!collides(board, cellsFor(piece.type, piece.rot), nx, ny)) {
    return { ...piece, x: nx, y: ny }
  }
  return null
}

export function ghostY(board: Cell[][], piece: ActivePiece): number {
  let y = piece.y
  while (!collides(board, cellsFor(piece.type, piece.rot), piece.x, y + 1)) y++
  return y
}
