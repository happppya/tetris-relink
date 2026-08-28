import type { PieceType } from '../src/engine/types.ts'

export type Visibility = 'public' | 'private'

export type SpinKind = 'none' | 'mini' | 'full'

/** A piece placement reported to the server (computed attack is server-side). */
export interface LockEvent {
  rows: number
  spin: SpinKind
  piece: PieceType | null
  perfectClear: boolean
  combo: number
  b2b: boolean
  streak: number
}

/** Serialized board (see shared/board.ts). */
export type Board = string

export interface LobbySettings {
  mode: 'firstToX' | 'winByX'
  /** games won needed to take the match (first-to-X); also the X in win-by-X is `winBy` */
  goal: number
  /** required lead in games won (win-by-X) */
  winBy: number
}

export interface LobbyPlayer {
  id: string
  name: string
  isHost: boolean
}

export interface LobbyState {
  code: string
  visibility: Visibility
  hostId: string
  players: LobbyPlayer[]
  settings: LobbySettings
}

export interface PublicLobbyInfo {
  code: string
  hostName: string
  playerCount: number
  settings: LobbySettings
}

export type ClientMessage =
  | { type: 'hello'; name: string }
  | { type: 'create_lobby'; name: string; visibility: Visibility; settings: LobbySettings }
  | { type: 'join_lobby'; code: string }
  | { type: 'leave_lobby' }
  | { type: 'settings_update'; settings: LobbySettings }
  | { type: 'start_match' }
  | { type: 'list_lobbies' }
  | { type: 'lock'; lock: LockEvent }
  | { type: 'snapshot'; board: Board; score: number; seq: number }
  | { type: 'ping'; t: number }

export type ServerMessage =
  | { type: 'welcome'; selfId: string }
  | { type: 'lobby_state'; lobby: LobbyState }
  | { type: 'roster_update'; players: LobbyPlayer[]; hostId: string }
  | { type: 'settings_update'; settings: LobbySettings }
  | { type: 'lobby_list'; lobbies: PublicLobbyInfo[] }
  | { type: 'match_start'; matchId: string; players: LobbyPlayer[]; settings: LobbySettings }
  | { type: 'garbage'; lines: number; hole: number; from: string }
  | { type: 'snapshot_ack'; seq: number }
  | { type: 'resync'; board: Board; pendingGarbage: number; score: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; t: number }