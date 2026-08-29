import { computeAttack, DEFAULT_ATTACK, type ClearInfo } from '../src/engine/attack.ts'
import {
  applyLock,
  createAuthority,
  pendingGarbage,
  queueGarbage,
  resetAuthority,
  serializeAuthority,
  type BoardAuthority,
} from './authority.ts'
import type { LockEvent, LobbySettings, TargetMode } from '../shared/protocol.ts'

export interface SessionMember {
  id: string
  name: string
}

interface PlayerState {
  id: string
  name: string
  auth: BoardAuthority
  score: number
  mode: TargetMode
  manualTarget: string | null
  attackers: string[]
}

export type SnapshotResult =
  | { status: 'ok' }
  | { status: 'resync'; board: string; pendingGarbage: number; score: number }
export type SessionEvent =
  | { type: 'garbage'; to: string; lines: number; hole: number; from: string }
  | { type: 'target_update'; playerId: string; mode: TargetMode; targetId: string | null }

export class Session {
  readonly matchId: string
  readonly settings: LobbySettings
  private players = new Map<string, PlayerState>()
  /** players eliminated for the current game (topped out) — not targetable */
  private unavailable = new Set<string>()

  constructor(matchId: string, members: readonly SessionMember[], settings: LobbySettings) {
    this.matchId = matchId
    this.settings = { ...settings }
    for (const m of members) {
      this.players.set(m.id, { id: m.id, name: m.name, auth: createAuthority(), score: 0, mode: 'random', manualTarget: null, attackers: [] })
    }
  }

  get summary() {
    return { matchId: this.matchId, players: [...this.players.values()].map(({ id, name }) => ({ id, name })), settings: { ...this.settings } }
  }

  has(id: string): boolean { return this.players.has(id) }
  pendingGarbageOf(id: string): number { return this.players.get(id) ? pendingGarbage(this.players.get(id)!.auth) : 0 }

  /** Mark a player out of the current game (e.g. top-out); it can no longer be targeted. */
  eliminate(id: string): void {
    if (this.players.has(id)) this.unavailable.add(id)
  }

  /** A fresh game starts: everyone is eligible again, targeting and boards reset. */
  newGame(): void {
    this.unavailable.clear()
    for (const player of this.players.values()) {
      resetAuthority(player.auth)
      player.mode = 'random'
      player.manualTarget = null
      player.attackers = []
    }
  }

  setTarget(byId: string, mode: TargetMode, targetId?: string): SessionEvent[] {
    const player = this.players.get(byId)
    if (!player) return []
    player.mode = mode
    player.manualTarget = mode === 'manual' && targetId && this.players.has(targetId) && targetId !== byId && !this.unavailable.has(targetId) ? targetId : null
    return [{ type: 'target_update', playerId: byId, mode, targetId: this.targetFor(player, byId) }]
  }

  /**
   * Apply a placement. The server reconstructs the player's board from the
   * reported cells (authoritative), clears rows and reconciles garbage itself:
   * a clear first cancels the player's queued incoming garbage ("wait a little"
   * — garbage is held until a non-clearing placement), and only the surplus
   * attack that isn't used up cancelling is forwarded to the target.
   */
  move(byId: string, lock: LockEvent): SessionEvent[] {
    const from = this.players.get(byId)
    if (!from) return []
    let total = 0
    let surplus = 0
    if (lock.cells && lock.cells.length > 0) {
      // authoritative path: reconstruct the board from the placement's cells,
      // clear rows and reconcile garbage (cancel incoming, forward only surplus)
      const outcome = applyLock(from.auth, {
        cells: lock.cells,
        rows: lock.rows,
        spin: lock.spin,
        piece: lock.piece,
        combo: lock.combo,
        b2b: lock.b2b,
        streak: lock.streak,
      })
      if (outcome.invalid) return [] // bogus/desynced lock: don't reward or mutate
      total = outcome.total
      surplus = outcome.surplus
    } else {
      // no geometry reported (test/legacy path): route the reported attack
      // without touching the board, keeping routing tests isolated from board state
      total = computeAttack({ count: lock.rows, spin: lock.spin, piece: lock.piece, perfectClear: lock.perfectClear } as ClearInfo, DEFAULT_ATTACK, lock.combo, lock.b2b, lock.streak).totalLines
      surplus = total
    }
    from.score += total

    if (surplus <= 0) return []
    const targetId = this.targetFor(from, byId)
    if (!targetId) return []
    const target = this.players.get(targetId)!
    queueGarbage(target.auth, surplus, 0)
    target.attackers = [byId, ...target.attackers.filter((id) => id !== byId)]
    return [
      { type: 'garbage', to: targetId, lines: surplus, hole: 0, from: byId },
      { type: 'target_update', playerId: byId, mode: from.mode, targetId },
    ]
  }

  /** Cross-check a client snapshot against the authoritative board; resync on divergence. */
  checkSnapshot(id: string, board: string, _score: number): SnapshotResult {
    const p = this.players.get(id)
    if (!p) return { status: 'ok' }
    const authoritative = serializeAuthority(p.auth)
    if (authoritative === board) return { status: 'ok' }
    return { status: 'resync', board: authoritative, pendingGarbage: pendingGarbage(p.auth), score: p.score }
  }

  dropPlayer(id: string): void { this.remove(id) }

  remove(id: string): void {
    this.players.delete(id)
    this.unavailable.delete(id)
    for (const player of this.players.values()) {
      player.manualTarget = player.manualTarget === id ? null : player.manualTarget
      player.attackers = player.attackers.filter((attacker) => attacker !== id)
    }
  }

  private targetFor(player: PlayerState, byId: string): string | null {
    // only living, connected, in-game opponents are eligible targets
    const opponents = [...this.players.keys()].filter((id) => id !== byId && !this.unavailable.has(id))
    if (opponents.length === 0) return null
    if (player.mode === 'manual' && player.manualTarget && opponents.includes(player.manualTarget)) return player.manualTarget
    if (player.mode === 'revenge') {
      const attacker = player.attackers.find((id) => opponents.includes(id))
      if (attacker) return attacker
    }
    return opponents[0]
  }
}