import { BOARD_W, VISIBLE_H } from '../src/engine/types.ts'

export type BoardCell = string | null

export function emptyBoard(): BoardCell[][] {
  return Array.from({ length: VISIBLE_H }, () => Array<BoardCell>(BOARD_W).fill(null))
}

/** Four-wide starting board: grey walls in the side columns, open 4-cell well. */
export function fourWideBoard(): BoardCell[][] {
  return Array.from({ length: VISIBLE_H }, () =>
    Array.from({ length: BOARD_W }, (_, x) => (x < 3 || x >= BOARD_W - 3 ? 'W' : null)),
  )
}

/** Rows joined by '/', cells '.' (empty) or a piece/garbage letter. */
export function serializeBoard(board: BoardCell[][]): string {
  return board.map((row) => row.map((c) => c ?? '.').join('')).join('/')
}

export function deserializeBoard(s: string): BoardCell[][] {
  return s.split('/').map((row) => row.split('').map((c) => (c === '.' ? null : c)))
}

/**
 * Deterministic garbage rows: grey cells with a hole at column 0, pushed at the
 * bottom (mirrors the engine's pushGarbageRows). Deterministic so the server's
 * authoritative copy and the client's board can never disagree on the hole
 * position. (The engine's own garbage holes are random; aligning the real
 * client to this representation is a Phase 3 client-integration task.)
 */
export function applyGarbageToBoard(board: BoardCell[][], rows: number): BoardCell[][] {
  const out = board.map((r) => [...r])
  for (let i = 0; i < rows; i++) {
    const row = Array<BoardCell>(BOARD_W).fill('G')
    row[0] = null
    out.shift()
    out.push(row)
  }
  return out
}