import { computeAttack, DEFAULT_ATTACK, type ClearInfo } from '../src/engine/attack.ts'
import { applyGarbageToBoard, emptyBoard, serializeBoard, type BoardCell } from '../shared/board.ts'
import type { LockEvent, LobbySettings, TargetMode } from '../shared/protocol.ts'

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
  mode: TargetMode
  manualTarget: string | null
  attackers: string[]
}

export type SnapshotResult = { status: 'ok' } | { status: 'resync'; board: string; pendingGarbage: number; score: number }
export type SessionEvent =
  | { type: 'garbage'; to: string; lines: number; hole: number; from: string }
  | { type: 'target_update'; playerId: string; mode: TargetMode; targetId: string | null }

export class Session {
  readonly matchId: string
  readonly settings: LobbySettings
  private players = new Map<string, PlayerState>()

  constructor(matchId: string, members: readonly SessionMember[], settings: LobbySettings) {
    this.matchId = matchId
    this.settings = { ...settings }
    for (const m of members) this.players.set(m.id, { id: m.id, name: m.name, board: emptyBoard(), score: 0, pendingGarbage: 0, mode: 'random', manualTarget: null, attackers: [] })
  }

  get summary() {
    return { matchId: this.matchId, players: [...this.players.values()].map(({ id, name }) => ({ id, name })), settings: { ...this.settings } }
  }

  has(id: string): boolean { return this.players.has(id) }
  pendingGarbageOf(id: string): number { return this.players.get(id)?.pendingGarbage ?? 0 }

  setTarget(byId: string, mode: TargetMode, targetId?: string): SessionEvent[] {
    const player = this.players.get(byId)
    if (!player) return []
    player.mode = mode
    player.manualTarget = mode === 'manual' && targetId && this.players.has(targetId) && targetId !== byId ? targetId : null
    return [{ type: 'target_update', playerId: byId, mode, targetId: this.targetFor(player, byId) }]
  }

  move(byId: string, lock: LockEvent): SessionEvent[] {
    const from = this.players.get(byId)
    if (!from) return []
    const total = computeAttack({ count: lock.rows, spin: lock.spin, piece: lock.piece, perfectClear: lock.perfectClear } as ClearInfo, DEFAULT_ATTACK, lock.combo, lock.b2b, lock.streak).totalLines
    if (total <= 0) return []
    from.score += total
    const targetId = this.targetFor(from, byId)
    if (!targetId) return []
    const target = this.players.get(targetId)!
    target.board = applyGarbageToBoard(target.board, total)
    target.attackers = [byId, ...target.attackers.filter((id) => id !== byId)]
    return [
      { type: 'garbage', to: targetId, lines: total, hole: 0, from: byId },
      { type: 'target_update', playerId: byId, mode: from.mode, targetId },
    ]
  }

  checkSnapshot(id: string, board: string, score: number): SnapshotResult {
    const p = this.players.get(id)
    if (!p || (serializeBoard(p.board) === board && p.score === score)) return { status: 'ok' }
    return { status: 'resync', board: serializeBoard(p.board), pendingGarbage: p.pendingGarbage, score: p.score }
  }

  dropPlayer(id: string): void { this.remove(id) }

  remove(id: string): void {
    this.players.delete(id)
    for (const player of this.players.values()) {
      player.manualTarget = player.manualTarget === id ? null : player.manualTarget
      player.attackers = player.attackers.filter((attacker) => attacker !== id)
    }
  }

  private targetFor(player: PlayerState, byId: string): string | null {
    const opponents = [...this.players.keys()].filter((id) => id !== byId)
    if (opponents.length === 0) return null
    if (player.mode === 'manual' && player.manualTarget && opponents.includes(player.manualTarget)) return player.manualTarget
    if (player.mode === 'revenge') {
      const attacker = player.attackers.find((id) => opponents.includes(id))
      if (attacker) return attacker
    }
    return opponents[0]
  }
}
