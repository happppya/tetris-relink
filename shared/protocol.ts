import type { PieceType } from '../src/engine/types.ts'

export type Visibility = 'public' | 'private'

export type SpinKind = 'none' | 'mini' | 'full'
export type TargetMode = 'manual' | 'revenge' | 'random'

/**
 * A piece placement reported to the server. `cells` are the placed mino
 * positions in visible-board coordinates (0..19); the server reconstructs the
 * board from them to be authoritative.
 */
export interface LockEvent {
  rows: number
  spin: SpinKind
  piece: PieceType | null
  perfectClear: boolean
  combo: number
  b2b: boolean
  streak: number
  cells?: { x: number; y: number }[]
}

/** Serialized board (see shared/board.ts). */
export type Board = string

export interface LobbySettings {
  mode: 'firstToX' | 'winByX'
  /** games won needed to take the match (first-to-X); also the X in win-by-X is `winBy` */
  goal: number
  /** required lead in games won (win-by-X) */
  winBy: number
  /** four-wide mode: grey walls fill the side columns, leaving a 4-cell-wide well; absent = off on the wire */
  fourWide?: boolean
}

export interface LobbyPlayer {
  id: string
  name: string
  isHost: boolean
  /** chose to watch instead of play (lobby choice / current role) */
  spectating?: boolean
  /** pressed leave mid-match: out of the game, still in the lobby */
  afk?: boolean
  /** game score: +1 per round won, persists in the lobby until leave/expiry */
  score: number
  /** socket dropped unexpectedly: kept in the lobby for a grace period so they can rejoin */
  reconnecting?: boolean
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
  | { type: 'hello'; name: string; rejoinId?: string }
  | { type: 'rejoin' }
  | { type: 'dismiss_rejoin' }
  | { type: 'create_lobby'; name: string; visibility: Visibility; settings: LobbySettings }
  | { type: 'join_lobby'; code: string }
  | { type: 'leave_lobby' }
  | { type: 'settings_update'; settings: LobbySettings }
  | { type: 'start_match' }
  | { type: 'list_lobbies' }
  | { type: 'spectate'; spectating: boolean }
  | { type: 'set_afk'; afk: boolean }
  | { type: 'lock'; lock: LockEvent }
  | { type: 'target'; mode: TargetMode; targetId?: string }
  | { type: 'snapshot'; board: Board; score: number; seq: number; matchId: string; lines?: number; hold?: PieceType | null; next?: PieceType[] }
  | { type: 'topout'; matchId: string }
  | { type: 'ping'; t: number }

export type ServerMessage =
  | { type: 'welcome'; selfId: string }
  | { type: 'lobby_state'; lobby: LobbyState }
  | { type: 'roster_update'; players: LobbyPlayer[]; hostId: string }
  | { type: 'settings_update'; settings: LobbySettings }
  | { type: 'lobby_list'; lobbies: PublicLobbyInfo[] }
  | { type: 'match_start'; matchId: string; players: LobbyPlayer[]; settings: LobbySettings; round: number }
  | { type: 'rejoin_offer'; lobbyCode: string; matchActive: boolean }
  | { type: 'board_update'; playerId: string; board: Board; score: number; pendingGarbage: number; round: number; lines?: number; hold?: PieceType | null; next?: PieceType[] }
  | { type: 'game_end'; round: number; winnerId: string | null; eliminatedIds: string[]; wins: Record<string, number>; scores: Record<string, number> }
  | { type: 'game_start'; round: number; players: LobbyPlayer[]; board: Board }
  | { type: 'match_end'; winnerId: string | null; wins: Record<string, number>; scores: Record<string, number> }
  | { type: 'player_left'; playerId: string }
  | { type: 'player_spectating'; playerId: string; spectating: boolean }
  | { type: 'player_afk'; playerId: string; afk: boolean }
  | { type: 'garbage'; lines: number; hole: number; from: string }
  | { type: 'target_update'; playerId: string; mode: TargetMode; targetId: string | null }
  | { type: 'snapshot_ack'; seq: number }
  | { type: 'resync'; board: Board; pendingGarbage: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; t: number }