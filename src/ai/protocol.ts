import type { Cell, PieceType } from '../engine/types'

export interface BotStateMsg {
  type: 'state'
  profile: string
  board: Cell[][]
  current: PieceType
  next: PieceType[]
  hold: PieceType | null
  b2b: boolean
  combo: number
  /** when > 0 the bot responds with a hints message for that many upcoming placements */
  hintCount?: number
  /** echoed by replies so stale plans for replaced pieces can be dropped */
  seq?: number
}

export type BotSpin = 'none' | 'mini' | 'full'

/** intended occupied [col, rowFromBottom] pairs, row 0 = board bottom */
export type BotCells = [number, number][]

export interface BotPlanMsg {
  type: 'plan'
  x: number
  rot: number
  /** rotation maneuver cold-clear-2 intends for this placement */
  spin?: BotSpin
  cells?: BotCells
  /** the bot wants the current piece swapped into hold before placing */
  hold?: boolean
  seq?: number
}

export interface BotHintPlacement {
  type: PieceType
  x: number
  rot: number
  spin?: BotSpin
  cells?: BotCells
}

export interface BotHintsMsg {
  type: 'hints'
  placements: BotHintPlacement[]
  /** placements[0] should be played after swapping the current piece into hold */
  hold?: boolean
  seq?: number
}

/** cold-clear-2 wasm could not be initialized; no bot brain is available */
export interface BotUnavailableMsg {
  type: 'unavailable'
  reason: string
  seq?: number
}

export interface BotInitMsg {
  type: 'init'
  profile: string
}

export interface BotResetMsg {
  type: 'reset'
}

export type BotInMsg = BotInitMsg | BotStateMsg | BotResetMsg
export type BotOutMsg = BotPlanMsg | BotHintsMsg | BotUnavailableMsg
