import type { LobbyPlayer, LobbySettings, Visibility } from '../shared/protocol.ts'
import { sanitizeLobbySettings } from '../shared/lobby-settings.ts'

export const MAX_PLAYERS = 8

export interface Member {
  id: string
  name: string
  joinedAt: number
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
      .map((m) => ({ id: m.id, name: m.name, isHost: m.id === this.hostId }))
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