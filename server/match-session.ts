import { Match } from '../src/engine/match.ts'
import { Session, type SessionEvent, type SessionMember } from './session.ts'
import type { Board, LobbySettings, LockEvent, TargetMode } from '../shared/protocol.ts'
import { emptyBoard, fourWideBoard, serializeBoard } from '../shared/board.ts'

export class MatchSession {
  readonly match: Match
  readonly session: Session
  readonly matchId: string
  private readonly settings: LobbySettings

  constructor(matchId: string, members: readonly SessionMember[], settings: LobbySettings) {
    this.matchId = matchId
    this.match = new Match(settings, members.map(({ id }) => id))
    this.session = new Session(matchId, members, settings)
    this.settings = { ...settings }
  }

  has(id: string): boolean { return this.session.has(id) }
  move(id: string, lock: LockEvent): SessionEvent[] { return this.session.move(id, lock) }
  target(id: string, mode: TargetMode, targetId?: string): SessionEvent[] { return this.session.setTarget(id, mode, targetId) }
  snapshot(id: string, board: string) { return this.session.checkSnapshot(id, board) }
  pending(id: string): number { return this.session.pendingGarbageOf(id) }
  remove(id: string): void { this.session.remove(id) }
  freshBoard(): Board { return serializeBoard(this.settings.fourWide ? fourWideBoard() : emptyBoard()) }
}
