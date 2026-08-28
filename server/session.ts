import { computeAttack, DEFAULT_ATTACK, type ClearInfo } from '../src/engine/attack.ts'
import { applyGarbageToBoard, emptyBoard, serializeBoard, type BoardCell } from '../shared/board.ts'
import type { LockEvent, LobbySettings } from '../shared/protocol.ts'

export interface SessionMember {
  id: string
  name: string
}

interface PlayerState {
  id: string
  name: string
  board: BoardCell[][]
  score: number
  pendingGarbage: number
}

export type SnapshotResult =
  | { status: 'ok' }
  | { status: 'resync'; board: string; pendingGarbage: number; score: number }

export type SessionEvent =
  | { type: 'garbage'; to: string; lines: number; hole: number; from: string }
  | { type: 'resync'; to: string; board: string; pendingGarbage: number; score: number }

export interface SessionSummary {
  matchId: string
  players: SessionMember[]
  settings: LobbySettings
}

/**
 * Authoritative in-match state for one player: the server's copy of the board,
 * the score, and the pending (cancellable) garbage queue. The server is the
 * authority on attacks, garbage, and desync resolution.
 */
export class Session {
  readonly matchId: string
  readonly settings: LobbySettings
  private players = new Map<string, PlayerState>()

  constructor(matchId: string, members: readonly SessionMember[], settings: LobbySettings) {
    this.matchId = matchId
    this.settings = { ...settings }
    for (const m of members) {
      this.players.set(m.id, { id: m.id, name: m.name, board: emptyBoard(), score: 0, pendingGarbage: 0 })
    }
  }

  get summary(): SessionSummary {
    return {
      matchId: this.matchId,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name })),
      settings: { ...this.settings },
    }
  }

  has(id: string): boolean {
    return this.players.has(id)
  }

  pendingGarbageOf(id: string): number {
    return this.players.get(id)?.pendingGarbage ?? 0
  }

  /**
   * A player's move. Computes the attack from the room's attack table, applies
   * it to the target's authoritative board, and returns the events to relay.
   */
  move(byId: string, lock: LockEvent): SessionEvent[] {
    const from = this.players.get(byId)
    if (!from) return []
    const events: SessionEvent[] = []
    const attack = computeAttack(
      { count: lock.rows, spin: lock.spin, piece: lock.piece, perfectClear: lock.perfectClear } as ClearInfo,
      DEFAULT_ATTACK,
      lock.combo,
      lock.b2b,
      lock.streak,
    )
    const total = attack.totalLines
    if (total > 0) {
      from.score += total
      const targets = this.livingTargets(byId)
      if (targets.length > 0) {
        const targetId = targets[0]
        const target = this.players.get(targetId)!
        const hole = 0
        target.board = applyGarbageToBoard(target.board, total)
        events.push({ type: 'garbage', to: targetId, lines: total, hole, from: byId })
      }
    }
    return events
  }

  /**
   * Server-side snapshot cross-check. A mismatch means the client has drifted;
   * returns the authoritative state so the client can resync.
   */
  checkSnapshot(id: string, board: string, score: number): SnapshotResult {
    const p = this.players.get(id)
    if (!p) return { status: 'ok' }
    if (serializeBoard(p.board) !== board || p.score !== score) {
      return {
        status: 'resync',
        board: serializeBoard(p.board),
        pendingGarbage: p.pendingGarbage,
        score: p.score,
      }
    }
    return { status: 'ok' }
  }

  /** A player tops out: garbage pending on them is dropped, board resets. */
  dropPlayer(id: string): void {
    const p = this.players.get(id)
    if (!p) return
    p.board = emptyBoard()
    p.pendingGarbage = 0
  }

  private livingTargets(byId: string): string[] {
    return [...this.players.values()].filter((p) => p.id !== byId).map((p) => p.id)
  }
}