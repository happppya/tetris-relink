import type { LobbyPlayer, LobbySettings, Visibility } from '../shared/protocol.ts'
import { sanitizeLobbySettings } from '../shared/lobby-settings.ts'

export const MAX_PLAYERS = 8

export interface Member {
  id: string
  name: string
  joinedAt: number
  /** chose to watch instead of play (also records the role while AFK, for rejoin) */
  spectating?: boolean
  /** pressed leave mid-match: out of the game, still in the lobby */
  afk?: boolean
  /** game score: +1 per round won, persists until the member leaves / lobby expires */
  score?: number
  /** socket dropped unexpectedly: kept for a grace period so they can rejoin */
  reconnecting?: boolean
}

export interface LobbyOptions {
  code: string
  visibility: Visibility
  settings: LobbySettings
  host: Member
}

export class Lobby {
  readonly code: string
  visibility: Visibility
  settings: LobbySettings
  hostId: string
  lastActivity = Date.now()

  private members = new Map<string, Member>()

  constructor(opts: LobbyOptions) {
    this.code = opts.code
    this.visibility = opts.visibility
    this.settings = { ...opts.settings }
    this.hostId = opts.host.id
    this.members.set(opts.host.id, opts.host)
  }

  get size(): number {
    return this.members.size
  }

  get isFull(): boolean {
    return this.members.size >= MAX_PLAYERS
  }

  has(id: string): boolean {
    return this.members.has(id)
  }

  get memberList(): LobbyPlayer[] {
    return [...this.members.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((m) => ({ id: m.id, name: m.name, isHost: m.id === this.hostId, spectating: m.spectating ?? false, afk: m.afk ?? false, score: m.score ?? 0, reconnecting: m.reconnecting ?? false }))
  }

  getMember(id: string): Member | undefined {
    return this.members.get(id)
  }

  join(member: Member): boolean {
    if (this.isFull || this.members.has(member.id)) return false
    this.members.set(member.id, member)
    this.touch()
    return true
  }

  /** Removes a member. Returns the new host id (or null if none changed). */
  leave(id: string): { empty: boolean; newHostId: string | null } {
    this.members.delete(id)
    this.touch()
    if (this.members.size === 0) return { empty: true, newHostId: null }
    if (id === this.hostId) {
      const earliest = [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0]
      this.hostId = earliest.id
      return { empty: false, newHostId: earliest.id }
    }
    return { empty: false, newHostId: null }
  }

  /** Host-only settings update; sanitizes untrusted input. Returns false if not host. */
  setSettings(byId: string, raw: unknown): boolean {
    if (byId !== this.hostId) return false
    this.settings = sanitizeLobbySettings(raw)
    this.touch()
    return true
  }

  touch(): void {
    this.lastActivity = Date.now()
  }
}