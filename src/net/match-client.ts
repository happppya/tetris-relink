import type { Game, GameEvent } from '../engine/game'
import { HIDDEN_H, type ActivePiece, type Cell, type PieceType } from '../engine/types'
import { cellsFor } from '../engine/pieces'
import { deserializeBoard, serializeBoard } from '../../shared/board.ts'
import type { ClientMessage, LockEvent, ServerMessage, TargetMode } from '../../shared/protocol.ts'

export interface OpponentState {
  board: Cell[][]
  score: number
  lines: number
  incoming: number
  hold: PieceType | null
  next: PieceType[]
  left?: boolean
  spectating?: boolean
  afk?: boolean
  wins: number
  alive: boolean
}

/** A round just finished: the ranked scoreboard shown during the short intermission before the next round. */
export interface Intermission {
  round: number
  winnerId: string | null
  /** each player's round score when the round ended, ranked in the UI */
  scores: Record<string, number>
  /** game scores (rounds won) carried into the next round */
  wins: Record<string, number>
}

export interface MatchClientState {
  opponents: Record<string, OpponentState>
  round: number
  wins: Record<string, number>
  error: string | null
  finished: boolean
  targetMode: TargetMode
  targetId: string | null
  /** this client is watching, not playing (lobby choice or died mid-game) */
  spectating: boolean
  /** set between rounds (and on match end); the UI shows the scoreboard */
  intermission: Intermission | null
}

export interface MatchClientHooks {
  game: Game
  matchId: string
  send: (msg: ClientMessage) => void
  onMessage: (handler: (msg: ServerMessage) => void) => () => void
  selfId: () => string | null
  /**
   * The roster from `match_start`. The server broadcasts `player_spectating`
   * immediately after `match_start`, and that message races the creation of
   * this client (and can be dropped before the subscription exists) — so the
   * role flags carried by `match_start` itself seed self/opponent spectating.
   */
  players?: { id: string; name: string; spectating?: boolean }[]
  /** current round from match_start, so a rejoin lands in the right round */
  round?: number
}

const SNAPSHOT_INTERVAL_FRAMES = 30

/**
 * The client half of an authoritative match: sends the one-lock-per-placement
 * messages (with the placed cells so the server can reconstruct the board),
 * throttled snapshots, and applies every server message to the local `Game`.
 * Used by the multiplayer game screen and by tests that drive the real client
 * stack against a live server.
 */
export class MatchClient {
  readonly game: Game
  /** corrective resyncs received; zero means the client stayed authoritative */
  resyncs = 0

  private readonly matchId: string
  private readonly send: (msg: ClientMessage) => void
  private readonly selfId: () => string | null
  private readonly unsubscribe: () => void
  private readonly listeners = new Set<(state: MatchClientState) => void>()
  private matchEndHandler: (winnerId: string | null, wins: Record<string, number>) => void = () => {}
  private state: MatchClientState = {
    opponents: {},
    round: 1,
    wins: {},
    error: null,
    finished: false,
    targetMode: 'random',
    targetId: null,
    spectating: false,
    intermission: null,
  }
  private lastSnapshot = 0
  private snapshotSeq = 0
  private spectating = false

  constructor(hooks: MatchClientHooks) {
    this.game = hooks.game
    this.matchId = hooks.matchId
    this.send = hooks.send
    this.selfId = hooks.selfId
    const selfId = hooks.selfId()
    const opponents: Record<string, OpponentState> = {}
    for (const p of hooks.players ?? []) {
      if (p.id === selfId) {
        this.spectating = p.spectating ?? false
      } else {
        opponents[p.id] = {
          board: [],
          score: 0,
          lines: 0,
          incoming: 0,
          hold: null,
          next: [],
          wins: 0,
          alive: true,
          spectating: p.spectating ?? false,
        }
      }
    }
    this.state = { ...this.state, spectating: this.spectating, opponents, round: hooks.round ?? 1 }
    this.unsubscribe = hooks.onMessage((msg) => this.handle(msg))
  }

  /** Current UI-relevant state (opponents, round, wins, error, targeting). */
  getState(): MatchClientState {
    return {
      ...this.state,
      opponents: this.state.opponents,
      wins: { ...this.state.wins },
    }
  }

  subscribe(listener: (state: MatchClientState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onMatchEnd(handler: (winnerId: string | null, wins: Record<string, number>) => void): void {
    this.matchEndHandler = handler
  }

  destroy(): void {
    this.unsubscribe()
    this.listeners.clear()
  }

  /** Placed mino positions in visible-board coordinates (0..19). */
  cellsForPiece(piece: ActivePiece | null): { x: number; y: number }[] {
    if (!piece) return []
    return cellsFor(piece.type, piece.rot)
      .map((c) => ({ x: piece.x + c.x, y: piece.y + c.y }))
      .filter((c) => c.y >= HIDDEN_H)
      .map((c) => ({ x: c.x, y: c.y - HIDDEN_H }))
  }

  sendLock(lock: Omit<LockEvent, 'cells'>, piece: ActivePiece | null): void {
    if (this.spectating) return
    this.send({ type: 'lock', lock: { ...lock, cells: this.cellsForPiece(piece) } })
  }

  sendTopout(): void {
    if (this.spectating) return
    this.send({ type: 'topout', matchId: this.matchId })
  }

  isSpectating(): boolean {
    return this.spectating
  }

  setTarget(mode: TargetMode, targetId?: string): void {
    this.send({ type: 'target', mode, targetId })
  }

  /**
   * One placement reports exactly ONE lock (with the placed cells) so the server
   * can authoritatively reconstruct the board; a top-out reports the death.
   */
  handleEvents(events: GameEvent[]): void {
    let pendingPiece: ActivePiece | null = null
    for (const ev of events) {
      if (ev.type === 'lock') {
        pendingPiece = ev.piece
      } else if (ev.type === 'clear') {
        this.sendLock(
          { rows: ev.info.count, spin: ev.info.spin, piece: ev.info.piece, perfectClear: ev.info.perfectClear, combo: this.game.combo - 1, b2b: ev.attack.b2b, streak: ev.attack.streakBonus },
          pendingPiece,
        )
        pendingPiece = null
      } else if (ev.type === 'gameover') {
        pendingPiece = null
        this.sendTopout()
      }
    }
    if (pendingPiece) {
      this.sendLock({ rows: 0, spin: 'none', piece: pendingPiece.type, perfectClear: false, combo: this.game.combo, b2b: this.game.b2bActive, streak: this.game.streak }, pendingPiece)
    }
  }

  /** Throttled (~10Hz) snapshot of the visible board for server cross-checking and opponent relay. */
  maybeSendSnapshot(): void {
    if (this.spectating) return
    const g = this.game
    if (g.frames - this.lastSnapshot < SNAPSHOT_INTERVAL_FRAMES) return
    this.lastSnapshot = g.frames
    this.snapshotSeq++
    this.send({
      type: 'snapshot',
      board: serializeBoard(g.board.slice(-20)),
      score: g.score,
      lines: g.lines,
      hold: g.hold,
      next: g.nextQueue,
      seq: this.snapshotSeq,
      matchId: this.matchId,
    })
  }

  private setState(patch: Partial<MatchClientState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'game_end':
        // a round really ended when there is a survivor (or a draw, which
        // carries no eliminated ids); a mid-round elimination just marks that
        // player out and the round continues, so no intermission for it
        this.setState({
          round: msg.round,
          wins: msg.wins,
          error: msg.winnerId ? `GAME WON BY ${msg.winnerId}` : 'GAME OVER',
          opponents: Object.fromEntries(
            Object.entries(this.state.opponents).map(([id, value]) => [
              id,
              { ...value, alive: !msg.eliminatedIds.includes(id), wins: msg.wins[id] ?? value.wins },
            ]),
          ),
          intermission: msg.winnerId !== null || msg.eliminatedIds.length === 0 ? { round: msg.round, winnerId: msg.winnerId, scores: msg.scores, wins: msg.wins } : this.state.intermission,
        })
        break
      case 'game_start': {
        const board = deserializeBoard(msg.board) as Cell[][]
        if (board.length === 20 && board.every((row) => row.length === 10)) {
          const snap = this.game.snapshot()
          this.game.restore({
            ...snap,
            board: [...snap.board.slice(0, HIDDEN_H), ...board],
            score: 0,
            lines: 0,
            piecesPlaced: 0,
            frames: 0,
            over: false,
            garbageQueue: [],
            hold: null,
            holdBlocked: false,
            combo: 0,
            streak: 0,
            b2bActive: false,
          })
        }
        this.setState({ round: msg.round, error: null, opponents: {} })
        break
      }
      case 'match_end':
        // keep the final round's scoreboard up during the exit window
        this.setState({ error: msg.winnerId ? `MATCH WON BY ${msg.winnerId}` : 'MATCH OVER', finished: true, intermission: { round: this.state.round, winnerId: msg.winnerId, scores: msg.scores, wins: msg.wins } })
        this.matchEndHandler(msg.winnerId, msg.wins)
        break
      case 'player_spectating':
        if (msg.playerId === this.selfId()) {
          // this client is watching now (lobby choice or died mid-game): stop
          // sending gameplay and let the UI switch to the spectator view
          this.spectating = msg.spectating
          this.setState({ spectating: msg.spectating })
        } else {
          this.setState({
            opponents: {
              ...this.state.opponents,
              [msg.playerId]: {
                ...(this.state.opponents[msg.playerId] ?? { board: [], score: 0, lines: 0, incoming: 0, hold: null, next: [], wins: 0, alive: true }),
                spectating: msg.spectating,
              },
            },
          })
        }
        break
      case 'player_afk':
        // an AFK player is out of the game (frozen board pruned) but still in
        // the lobby and able to return; show the marker instead of a stale board
        this.setState({
          opponents: {
            ...this.state.opponents,
            [msg.playerId]: {
              ...(this.state.opponents[msg.playerId] ?? { board: [], score: 0, lines: 0, incoming: 0, hold: null, next: [], wins: 0, alive: true }),
              afk: msg.afk,
              board: msg.afk ? [] : this.state.opponents[msg.playerId]?.board ?? [],
            },
          },
        })
        break
      case 'player_left':
        // prune the leaver from the opponent view entirely: their board, hold,
        // next, and stats are stale the instant they leave — only the left
        // marker (and their wins tally) survive, so the UI stops showing a
        // frozen "afk" board for someone who is no longer in the match
        this.setState({
          opponents: {
            ...this.state.opponents,
            [msg.playerId]: {
              board: [],
              score: 0,
              lines: 0,
              incoming: 0,
              hold: null,
              next: [],
              left: true,
              alive: false,
              wins: this.state.opponents[msg.playerId]?.wins ?? 0,
            },
          },
        })
        break
      case 'target_update':
        if (msg.playerId === this.selfId()) this.setState({ targetMode: msg.mode, targetId: msg.targetId })
        break
      case 'board_update': {
        if (msg.playerId === this.selfId()) break
        // relays from a previous round are still in flight when the next
        // round's game_start lands; drop them so old boards never linger
        if (msg.round !== this.state.round) break
        const board = deserializeBoard(msg.board) as Cell[][]
        if (board.length === 20 && board.every((row) => row.length === 10)) {
          this.setState({
            opponents: {
              ...this.state.opponents,
              [msg.playerId]: {
                board,
                score: msg.score,
                lines: msg.lines ?? 0,
                incoming: msg.pendingGarbage,
                hold: msg.hold ?? null,
                next: msg.next ?? [],
                wins: this.state.opponents[msg.playerId]?.wins ?? 0,
                alive: this.state.opponents[msg.playerId]?.alive ?? true,
              },
            },
          })
        }
        break
      }
      case 'garbage':
        this.game.receiveGarbage(msg.lines, false, msg.hole)
        break

      case 'resync': {
        // the server is authoritative for boards: adopt its state (plus any
        // garbage still owed) so a genuinely-desynced client converges
        this.resyncs++
        const board = deserializeBoard(msg.board) as Cell[][]
        if (board.length === 20 && board.every((row) => row.length === 10)) {
          const snap = this.game.snapshot()
          this.game.restore({ ...snap, board: [...snap.board.slice(0, HIDDEN_H), ...board], score: msg.score, garbageQueue: [] })
          if (msg.pendingGarbage > 0) this.game.receiveGarbage(msg.pendingGarbage, false, 0)
        }
        this.setState({ error: null })
        break
      }
    }
  }
}
