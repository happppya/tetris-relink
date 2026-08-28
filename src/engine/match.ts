export type MatchMode = 'firstToX' | 'winByX'

/**
 * Series-of-games scoring rules. Structurally identical to
 * `shared/protocol.ts` `LobbySettings`, so lobby settings flow straight in.
 */
export interface MatchSettings {
  mode: MatchMode
  /** games won needed to take the match (first-to-X) */
  goal: number
  /** required lead in games won (win-by-X) */
  winBy: number
}

export type EliminationReason = 'topout' | 'forfeit'

export type MatchEvent =
  | { type: 'eliminated'; playerId: string; reason: EliminationReason; alive: number }
  | { type: 'game_won'; round: number; winnerId: string; wins: Record<string, number> }
  | { type: 'game_draw'; round: number }
  | { type: 'match_won'; round: number; winnerId: string; wins: Record<string, number> }

export type MatchStatus = 'active' | 'finished'

export interface MatchPlayer {
  id: string
  wins: number
  alive: boolean
}

const clampInt = (v: number, min: number, fallback: number) => (Number.isFinite(v) ? Math.max(min, Math.round(v)) : fallback)

/**
 * A series-of-games tetris match. Each game is last-man-standing: players who
 * top out are eliminated for that game; when one survivor remains they win the
 * game. The match ends per the settings (first-to-X or win-by-X). If the final
 * players top out together there is no survivor: the game is a draw, no win is
 * awarded, and it is replayed.
 */
export class Match {
  readonly settings: MatchSettings
  round = 1
  status: MatchStatus = 'active'
  winnerId: string | null = null
  lastGameWinnerId: string | null = null
  lastGameDraw = false

  private players = new Map<string, MatchPlayer>()

  constructor(settings: MatchSettings, playerIds: readonly string[]) {
    this.settings = {
      mode: settings.mode === 'winByX' ? 'winByX' : 'firstToX',
      goal: clampInt(settings.goal, 1, 1),
      winBy: clampInt(settings.winBy, 1, 1),
    }
    for (const id of playerIds) this.players.set(id, { id, wins: 0, alive: true })
  }

  get playerList(): MatchPlayer[] {
    return [...this.players.values()].map((p) => ({ ...p }))
  }

  get aliveCount(): number {
    let n = 0
    for (const p of this.players.values()) if (p.alive) n++
    return n
  }

  alivePlayerIds(): string[] {
    return [...this.players.values()].filter((p) => p.alive).map((p) => p.id)
  }

  wins(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [id, p] of this.players) out[id] = p.wins
    return out
  }

  /** A player tops out: eliminated for the current game. */
  topOut(playerId: string): MatchEvent[] {
    return this.topOutSimultaneous([playerId])
  }

  /** A player forfeits (e.g., disconnect mid-game): same as topping out. */
  forfeit(playerId: string): MatchEvent[] {
    if (this.status === 'finished') return []
    const p = this.players.get(playerId)
    if (!p || !p.alive) return []
    p.alive = false
    const events: MatchEvent[] = [{ type: 'eliminated', playerId, reason: 'forfeit', alive: this.aliveCount }]
    this.resolve(events)
    return events
  }

  /**
   * Several players top out in the same tick. If every remaining player tops
   * out together there is no survivor: the game is a draw, no win is awarded,
   * and it is replayed.
   */
  topOutSimultaneous(playerIds: readonly string[]): MatchEvent[] {
    if (this.status === 'finished') return []
    const events: MatchEvent[] = []
    for (const id of new Set(playerIds)) {
      const p = this.players.get(id)
      if (!p || !p.alive) continue
      p.alive = false
      events.push({ type: 'eliminated', playerId: id, reason: 'topout', alive: this.aliveCount })
    }
    this.resolve(events)
    return events
  }

  private resolve(events: MatchEvent[]): void {
    if (this.status === 'finished') return
    const alive = this.alivePlayerIds()
    if (alive.length === 0) {
      this.lastGameDraw = true
      this.lastGameWinnerId = null
      events.push({ type: 'game_draw', round: this.round })
      this.nextGame()
      return
    }
    if (alive.length === 1) {
      const survivor = this.players.get(alive[0])!
      survivor.wins++
      this.lastGameDraw = false
      this.lastGameWinnerId = survivor.id
      events.push({ type: 'game_won', round: this.round, winnerId: survivor.id, wins: this.wins() })
      if (this.isMatchOver()) {
        this.status = 'finished'
        this.winnerId = survivor.id
        events.push({ type: 'match_won', round: this.round, winnerId: survivor.id, wins: this.wins() })
      } else {
        this.nextGame()
      }
    }
  }

  private nextGame(): void {
    this.round++
    for (const p of this.players.values()) p.alive = true
  }

  private isMatchOver(): boolean {
    const wins = Object.values(this.wins())
    if (this.settings.mode === 'firstToX') {
      return wins.some((w) => w >= this.settings.goal)
    }
    const sorted = [...wins].sort((a, b) => b - a)
    if (sorted.length === 0) return false
    if (sorted.length === 1) return sorted[0] >= this.settings.winBy
    return sorted[0] - sorted[1] >= this.settings.winBy
  }
}