import { generateCode } from './codes.ts'
import { Lobby, type Member } from './lobby.ts'
import type { LobbySettings, PublicLobbyInfo, Visibility } from '../shared/protocol.ts'

export interface CreateLobbyOptions {
  visibility: Visibility
  settings: LobbySettings
  host: Member
}

export class LobbyRegistry {
  private lobbies = new Map<string, Lobby>()

  create(opts: CreateLobbyOptions): Lobby {
    let code = generateCode()
    while (this.lobbies.has(code)) code = generateCode()
    const lobby = new Lobby({ code, visibility: opts.visibility, settings: opts.settings, host: opts.host })
    this.lobbies.set(code, lobby)
    return lobby
  }

  get(code: string): Lobby | undefined {
    return this.lobbies.get(code.toUpperCase())
  }

  remove(code: string): void {
    this.lobbies.delete(code.toUpperCase())
  }

  all(): Lobby[] {
    return [...this.lobbies.values()]
  }

  publicList(): PublicLobbyInfo[] {
    return this.all()
      .filter((l) => l.visibility === 'public')
      .map((l) => ({
        code: l.code,
        hostName: l.memberList.find((p) => p.isHost)?.name ?? '?',
        playerCount: l.size,
        settings: { ...l.settings },
      }))
  }
}