export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L'

export type Cell = PieceType | 'G' | 'W' | null

export interface Pos {
  x: number
  y: number
}

export interface ActivePiece {
  type: PieceType
  rot: 0 | 1 | 2 | 3
  x: number
  y: number
}

export const BOARD_W = 10
export const TOTAL_H = 24
export const VISIBLE_H = 20
export const HIDDEN_H = TOTAL_H - VISIBLE_H

export const PIECE_TYPES: readonly PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']

export type InputAction =
  | 'moveLeft'
  | 'moveRight'
  | 'softDrop'
  | 'hardDrop'
  | 'rotateCW'
  | 'rotateCCW'
  | 'rotate180'
  | 'hold'
  | 'retry'
  | 'pause'
  | 'assist'
