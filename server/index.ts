import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { LobbyRegistry } from './registry.ts'
import { Lobby, MAX_PLAYERS, type Member } from './lobby.ts'
import { MatchSession } from './match-session.ts'
import type { MatchEvent } from '../src/engine/match.ts'
import { roundScores } from './round-scores.ts'
import { sanitizeLobbySettings, sanitizeName } from '../shared/lobby-settings.ts'
import type { ClientMessage, LobbyState, ServerMessage, Visibility } from '../shared/protocol.ts'

const IDLE_MS = 30 * 60 * 1000
const IDLE_CHECK_MS = 60 * 1000

interface Conn {
  ws: WebSocket
  id: string
  name: string | null
  lobbyCode: string | null
  lastSeen: number
}

interface SessionHandle {
  match: MatchSession
  lobbyCode: string
}

let nextMatchId = 1

export interface ServerHandle {
  registry: LobbyRegistry
  server: import('node:http').Server
  /** live internal state sizes, for load/leak measurement */
  stats: () => {
    conns: number
    sessions: number
    lobbies: number
    /** cumulative work counters for profiling hot paths (monotonic, reset on restart) */
    work: { sends: number; stringifies: number; sessionScans: number }
  }
  /** force-close a client's socket (simulates a network drop / admin kick) */
  kick: (playerId: string) => void
  close: () => Promise<void>
}

/**
 * How long an *unexpected* disconnect (refresh, tab close, network blip) keeps
 * the player in their lobby + match before they are pruned, so they can rejoin.
 * An intentional leave (leave_lobby / dismiss_rejoin) is pruned instantly.
 * Exported so tests can shrink the window; returns the previous value.
 */
let reconnectGraceMs = 20_000
export function setReconnectGraceMs(ms: number): number {
  const prev = reconnectGraceMs
  reconnectGraceMs = ms
  return prev
}

/**
 * How long a `hello` presenting a *live* member's id may wait for that member's
 * own socket to close before it is rejected with a fresh identity. A refresh
 * races its own close by a few milliseconds, so the window must be wide enough
 * for the close to land; a claim that survives the window is a DIFFERENT client
 * (e.g. a second tab whose shared persisted id collided) and must not be granted
 * the member's identity. Exported so tests can shrink the window.
 */
let claimWindowMs = 3000
export function setClaimWindowMs(ms: number): number {
  const prev = claimWindowMs
  claimWindowMs = ms
  return prev
}

interface BufferedConn {
  /** the original connection object (socket closed, but id/lobbyCode preserved) */
  conn: Conn
  lobbyCode: string
  timer: ReturnType<typeof setTimeout>
}

export function startServer(port: number): ServerHandle {
  const registry = new LobbyRegistry()
  const conns = new Map<string, Conn>()
  const sessions = new Map<string, SessionHandle>()
  /** active matches per lobby (a lobby has at most a handful; usually exactly one) */
  const sessionsByLobby = new Map<string, SessionHandle[]>()
  /** unexpectedly-disconnected players held for the grace period pending rejoin */
  const buffered = new Map<string, BufferedConn>()
  /**
   * live-member claims: rejoinId -> the new socket presenting it, held until the
   * member's own (still-open) socket closes (a refresh racing its own close) or
   * a short window passes (a DIFFERENT client — never grant the identity).
   */
  const pendingClaims = new Map<string, { conn: Conn; timer: ReturnType<typeof setTimeout> }>()
  const server = createServer()
  const wss = new WebSocketServer({ server })

  // profiling counters: every ws.send, every JSON.stringify of a payload, and
  // every entry scanned by the no-matchId session lookup
  let sends = 0
  let stringifies = 0
  let sessionScans = 0

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      sends++
      stringifies++
      ws.send(JSON.stringify(msg))
    }
  }

  /** Send an already-serialized payload (broadcast fan-out reuses one stringify). */
  const sendRaw = (ws: WebSocket, payload: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      sends++
      ws.send(payload)
    }
  }

  /** Serialize once, fan out to every connected member. */
  const sendToLobby = (lobby: Lobby, msg: ServerMessage) => {
    stringifies++
    const payload = JSON.stringify(msg)
    for (const member of lobby.memberList) {
      const conn = conns.get(member.id)
      if (conn) sendRaw(conn.ws, payload)
    }
  }

  /** Like sendToLobby but skips one member (used for per-player relays the sender already knows). */
  const sendToLobbyExcept = (lobby: Lobby, exceptId: string, msg: ServerMessage) => {
    stringifies++
    const payload = JSON.stringify(msg)
    for (const member of lobby.memberList) {
      if (member.id === exceptId) continue
      const conn = conns.get(member.id)
      if (conn) sendRaw(conn.ws, payload)
    }
  }

  const lobbyState = (lobby: Lobby): LobbyState => ({
    code: lobby.code,
    visibility: lobby.visibility,
    hostId: lobby.hostId,
    players: lobby.memberList,
    settings: { ...lobby.settings },
  })

  const broadcastRoster = (lobby: Lobby) => {
    sendToLobby(lobby, { type: 'roster_update', players: lobby.memberList, hostId: lobby.hostId })
  }

  /** Push the public lobby list to every connected client not inside a lobby
   * (the ones actually looking at the list screen). Keeps the browser's
   * lobby browser live without any manual refresh. */
  const broadcastLobbyList = () => {
    stringifies++
    const payload = JSON.stringify({ type: 'lobby_list', lobbies: registry.publicList() })
    for (const conn of conns.values()) {
      if (conn.lobbyCode === null) sendRaw(conn.ws, payload)
    }
  }

  const handleLeave = (conn: Conn, lobby: Lobby) => {
    const { empty, newHostId } = lobby.leave(conn.id)
    conn.lobbyCode = null
    if (empty) {
      registry.remove(lobby.code)
      // iterate a copy: removeSession splices the live array
      for (const entry of [...(sessionsByLobby.get(lobby.code) ?? [])]) removeSession(entry.match.matchId)
      broadcastLobbyList()
      return
    }
    broadcastRoster(lobby)
    broadcastLobbyList()
    if (newHostId) {
      const hostConn = conns.get(newHostId)
      if (hostConn) send(hostConn.ws, { type: 'error', code: 'host_transferred', message: 'you are now the host' })
    }
  }

  const removeSession = (matchId: string): void => {
    const entry = sessions.get(matchId)
    if (!entry) return
    sessions.delete(matchId)
    const list = sessionsByLobby.get(entry.lobbyCode)
    if (list) {
      const i = list.indexOf(entry)
      if (i >= 0) list.splice(i, 1)
      if (list.length === 0) sessionsByLobby.delete(entry.lobbyCode)
    }
  }

  /**
   * The lobby a player id is currently a live member of, via their *active*
   * connection (still in conns, close not yet processed). Used when a page
   * refresh's new socket beats its own old socket's close: the player isn't in
   * `buffered` yet, but they're still a member, so we can still offer a rejoin.
   */
  const liveMemberLobby = (id: string): Lobby | undefined => {
    const live = conns.get(id)
    if (!live?.lobbyCode) return undefined
    const lobby = registry.get(live.lobbyCode)
    return lobby?.getMember(id) ? lobby : undefined
  }

  /**
   * Bind a returning socket to a member's identity and offer the rejoin. The
   * buffered entry keeps the *previous* (closed) conn so `pruneBuffered` can
   * still find the match via that conn's lobbyCode when a claimer never decides
   * (the returning socket's own lobbyCode is null until it accepts the offer).
   */
  const adoptRejoin = (conn: Conn, rejoinId: string, lobby: Lobby, fallbackName: string | null = null): void => {
    const entry = buffered.get(rejoinId)
    const member = lobby.getMember(rejoinId)
    if (!member) {
      send(conn.ws, { type: 'welcome', selfId: conn.id })
      return
    }
    member.reconnecting = true
    if (!entry) {
      buffered.set(rejoinId, {
        conn,
        lobbyCode: lobby.code,
        timer: setTimeout(() => pruneBuffered(rejoinId), reconnectGraceMs),
      })
    } else {
      clearTimeout(entry.timer)
      entry.timer = setTimeout(() => pruneBuffered(rejoinId), reconnectGraceMs)
    }
    broadcastRoster(lobby)
    const matchActive = (sessionsByLobby.get(lobby.code) ?? []).some((s) => s.match.match.status === 'active' && s.match.has(rejoinId))
    conns.delete(conn.id)
    conn.id = rejoinId
    conn.name = sanitizeName(conn.name ?? '', fallbackName ?? undefined)
    conns.set(conn.id, conn)
    send(conn.ws, { type: 'rejoin_offer', lobbyCode: lobby.code, matchActive })
    send(conn.ws, { type: 'welcome', selfId: conn.id })
  }

  const sessionFor = (conn: Conn, matchId?: string): SessionHandle | undefined => {
    // only an *active* match is a valid routing target: a finished session must
    // never receive locks/snapshots, otherwise a second match in the same lobby
    // routes against stale authority and every placement gets rolled back
    if (matchId) {
      const match = sessions.get(matchId)
      return match?.lobbyCode === conn.lobbyCode && match.match.match.status === 'active' && match.match.has(conn.id) ? match : undefined
    }
    // indexed by lobby instead of scanning every session in the server
    const list = conn.lobbyCode ? sessionsByLobby.get(conn.lobbyCode) : undefined
    if (list) {
      for (const entry of list) {
        sessionScans++
        if (entry.match.match.status === 'active' && entry.match.has(conn.id)) return entry
      }
    }
    return undefined
  }

  /** Permanently remove a player from their active match (leave or disconnect). */
  const removeFromMatch = (conn: Conn): void => {
    const match = sessionFor(conn)
    if (!match) return
    emitMatchEvents(match, match.match.match.removePlayer(conn.id))
    match.match.session.remove(conn.id)
    const lobby = registry.get(match.lobbyCode)
    if (lobby) sendToLobby(lobby, { type: 'player_left', playerId: conn.id })
  }

  /** The grace period for a buffered player ran out (or they dismissed the rejoin): prune them for good. */
  const pruneBuffered = (connId: string): void => {
    const entry = buffered.get(connId)
    if (!entry) return
    buffered.delete(connId)
    clearTimeout(entry.timer)
    const lobby = registry.get(entry.lobbyCode)
    // the old conn still carries lobbyCode, so sessionFor finds their match
    removeFromMatch(entry.conn)
    if (lobby) handleLeave(entry.conn, lobby)
  }

  const emitMatchEvents = (entry: SessionHandle, events: MatchEvent[]) => {
    const lobby = registry.get(entry.lobbyCode)
    if (!lobby) return
    // A fresh game is beginning: reset targeting + per-game eligibility, hand
    // every client a blank board, and re-mark spectators as sitting out (they
    // are revived by the engine's round reset). If nobody is left to actually
    // play, the match ends instead of replaying forever.
    const startNextGame = () => {
      entry.match.session.newGame()
      for (const specId of entry.match.session.spectatorIds()) entry.match.match.spectate(specId)
      const events: MatchEvent[] = []
      const alive = entry.match.match.aliveCount
      if (alive === 0) {
        // everyone is spectating: nobody can play, end with no winner
        events.push({ type: 'match_won', round: entry.match.match.round, winnerId: null, wins: entry.match.match.wins() })
      } else if (alive === 1) {
        // a single active player with everyone else watching: they own the match
        events.push({ type: 'match_won', round: entry.match.match.round, winnerId: entry.match.match.alivePlayerIds()[0]!, wins: entry.match.match.wins() })
      } else {
        sendToLobby(lobby, { type: 'game_start', round: entry.match.match.round, players: lobby.memberList, board: entry.match.freshBoard() })
      }
      if (events.length) emitMatchEvents(entry, events)
    }
    // when an elimination ALSO resolves the round (game_won/draw in the same
    // batch) the game_won/game_draw game_end already conveys the round over;
    // broadcasting the standalone eliminated game_end too would announce a
    // round end twice per death ("the player dying over and over"). Only the
    // ongoing N>2 case (death without a round resolution) gets its own game_end.
    const roundEndsInBatch = events.some((e) => e.type === 'game_won' || e.type === 'game_draw')
    for (const event of events) {
      if (event.type === 'eliminated' && event.alive > 0 && !roundEndsInBatch) sendToLobby(lobby, { type: 'game_end', round: entry.match.match.round, winnerId: null, eliminatedIds: [event.playerId], wins: entry.match.match.wins(), scores: roundScores(entry.match.match, null) })
      if (event.type === 'game_won') {
        // roundScores must be read before startNextGame starts the next round
        sendToLobby(lobby, { type: 'game_end', round: event.round, winnerId: event.winnerId, eliminatedIds: [], wins: event.wins, scores: roundScores(entry.match.match, event.winnerId) })
      }
      if (event.type === 'game_draw') sendToLobby(lobby, { type: 'game_end', round: event.round, winnerId: null, eliminatedIds: [], wins: entry.match.match.wins(), scores: roundScores(entry.match.match, null) })
      if (event.type === 'match_won') {
        // winning the whole match (series) earns exactly +1 game score on the
        // winner's lobby member — nothing per round, others get nothing — and
        // it persists until they leave or the lobby expires (across matches)
        if (event.winnerId) {
          const winner = lobby.getMember(event.winnerId)
          if (winner) {
            winner.score = (winner.score ?? 0) + 1
            lobby.touch()
            broadcastRoster(lobby)
          }
        }
        // the match is over: drop the session so a later match in the same
        // lobby can't be polluted by stale routing to this one
        removeSession(entry.match.matchId)
        sendToLobby(lobby, { type: 'match_end', winnerId: event.winnerId, wins: event.wins, scores: roundScores(entry.match.match, event.winnerId) })
      }
      if (event.type === 'game_won' && entry.match.match.status === 'active') startNextGame()
      if (event.type === 'game_draw') startNextGame()
    }
  }

  const handleMessage = (conn: Conn, raw: string) => {
    conn.lastSeen = Date.now()
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw) as ClientMessage
    } catch {
      send(conn.ws, { type: 'error', code: 'bad_message', message: 'malformed message' })
      return
    }

    switch (msg.type) {
      case 'hello': {
        conn.name = sanitizeName(msg.name)
        // A player returning after an unexpected disconnect presents their
        // previous id. Two cases:
        //
        // 1. The id is BUFFERED — their socket already closed and they were kept
        //    in the lobby + match for the grace period: adopt the identity and
        //    offer the rejoin right away (offer sent before welcome so the
        //    client can act on it in order).
        // 2. The id is a *live* member whose socket is STILL OPEN — a refresh
        //    whose new socket beat its own close, OR a different client (e.g. a
        //    second tab whose shared persisted id collided) trying to present it.
        //    Do NOT grant a live member's identity on sight: hold the claim until
        //    that member's own socket closes (a real refresh — the close is in
        //    flight) or a short window passes (a hijack — start fresh instead).
        if (msg.rejoinId && buffered.has(msg.rejoinId)) {
          const rejoinId = msg.rejoinId
          const entry = buffered.get(rejoinId)!
          const lobby = registry.get(entry.lobbyCode)
          if (!lobby) {
            send(conn.ws, { type: 'welcome', selfId: conn.id })
            return
          }
          adoptRejoin(conn, rejoinId, lobby, entry.conn.name)
          return
        }
        if (msg.rejoinId && liveMemberLobby(msg.rejoinId)) {
          const rejoinId = msg.rejoinId
          const prev = pendingClaims.get(rejoinId)
          if (prev) {
            // a newer claim supersedes an older one waiting on the same member
            clearTimeout(prev.timer)
            send(prev.conn.ws, { type: 'welcome', selfId: prev.conn.id })
          }
          pendingClaims.set(rejoinId, {
            conn,
            timer: setTimeout(() => {
              // the member's own socket never closed: this is not a refresh —
              // never hijack the live member; start the claimer as a fresh player
              if (pendingClaims.get(rejoinId)?.conn === conn) pendingClaims.delete(rejoinId)
              send(conn.ws, { type: 'welcome', selfId: conn.id })
            }, claimWindowMs),
          })
          return
        }
        send(conn.ws, { type: 'welcome', selfId: conn.id })
        return
      }
      case 'create_lobby': {
        if (conn.lobbyCode) {
          send(conn.ws, { type: 'error', code: 'already_in_lobby', message: 'leave your current lobby first' })
          return
        }
        const name = sanitizeName(msg.name, conn.name ?? undefined)
        conn.name = name
        const visibility: Visibility = msg.visibility === 'private' ? 'private' : 'public'
        const host: Member = { id: conn.id, name, joinedAt: Date.now() }
        const lobby = registry.create({ visibility, settings: sanitizeLobbySettings(msg.settings), host })
        conn.lobbyCode = lobby.code
        send(conn.ws, { type: 'lobby_state', lobby: lobbyState(lobby) })
        broadcastLobbyList()
        return
      }
      case 'join_lobby': {
        if (conn.lobbyCode) {
          send(conn.ws, { type: 'error', code: 'already_in_lobby', message: 'leave your current lobby first' })
          return
        }
        const lobby = registry.get(msg.code)
        if (!lobby) {
          send(conn.ws, { type: 'error', code: 'not_found', message: 'no lobby with that code' })
          return
        }
        if (lobby.isFull) {
          send(conn.ws, { type: 'error', code: 'lobby_full', message: `lobby is full (${MAX_PLAYERS} players)` })
          return
        }
        const name = sanitizeName(conn.name ?? 'PLAYER')
        conn.name = name
        lobby.join({ id: conn.id, name, joinedAt: Date.now() })
        conn.lobbyCode = lobby.code
        send(conn.ws, { type: 'lobby_state', lobby: lobbyState(lobby) })
        broadcastRoster(lobby)
        broadcastLobbyList()
        return
      }
      case 'leave_lobby': {
        if (!conn.lobbyCode) {
          send(conn.ws, { type: 'error', code: 'not_in_lobby', message: 'you are not in a lobby' })
          return
        }
        const lobby = registry.get(conn.lobbyCode)
        // intentional leave: pruned instantly (no grace), and the player is
        // permanently removed from the session (same as a disconnect), never
        // stranding a ghost that can't top out
        removeFromMatch(conn)
        conn.lobbyCode = null
        if (lobby) handleLeave(conn, lobby)
        return
      }
      case 'rejoin': {
        // attach this connection to the buffered lobby + match; the player was
        // kept in both for the grace period, so this is seamless
        const entry = buffered.get(conn.id)
        if (!entry) return // offer expired, or already consumed by another tab
        clearTimeout(entry.timer)
        buffered.delete(conn.id)
        conn.lobbyCode = entry.lobbyCode
        const lobby = registry.get(entry.lobbyCode)
        if (!lobby) {
          conn.lobbyCode = null
          return
        }
        const member = lobby.getMember(conn.id)
        if (member) member.reconnecting = false
        send(conn.ws, { type: 'lobby_state', lobby: lobbyState(lobby) })
        broadcastRoster(lobby)
        const sess = sessionFor(conn)
        if (sess && member && !member.spectating) {
          // back as a player: eligible for targeting again and back in the
          // running game (a genuine spectator stays spectating)
          sess.match.session.setSpectating(conn.id, false)
          sess.match.match.revive(conn.id)
        }
        if (sess) {
          // re-key the client's game screen at the current round
          send(conn.ws, { type: 'match_start', matchId: sess.match.matchId, players: lobby.memberList, settings: { ...lobby.settings }, round: sess.match.match.round })
        }
        return
      }
      case 'dismiss_rejoin': {
        // the player declined to come back: prune them right now
        if (buffered.has(conn.id)) pruneBuffered(conn.id)
        return
      }
      case 'settings_update': {
        if (!conn.lobbyCode) {
          send(conn.ws, { type: 'error', code: 'not_in_lobby', message: 'you are not in a lobby' })
          return
        }
        const lobby = registry.get(conn.lobbyCode)!
        if (lobby.hostId !== conn.id) {
          send(conn.ws, { type: 'error', code: 'forbidden', message: 'only the host can change room settings' })
          return
        }
        lobby.setSettings(conn.id, msg.settings)
        sendToLobby(lobby, { type: 'settings_update', settings: { ...lobby.settings } })
        return
      }
      case 'start_match': {
        if (!conn.lobbyCode) {
          send(conn.ws, { type: 'error', code: 'not_in_lobby', message: 'you are not in a lobby' })
          return
        }
        const lobby = registry.get(conn.lobbyCode)!
        if (lobby.hostId !== conn.id) {
          send(conn.ws, { type: 'error', code: 'forbidden', message: 'only the host can start the match' })
          return
        }
        if (lobby.memberList.filter((m) => !m.spectating).length < 2) {
          send(conn.ws, { type: 'error', code: 'need_players', message: 'need at least 2 players to start' })
          return
        }
        const members = lobby.memberList.map((p) => ({ id: p.id, name: p.name }))
        const matchId = `m${nextMatchId++}`
        const match = new MatchSession(matchId, members, lobby.settings)
        const handle: SessionHandle = { match, lobbyCode: lobby.code }
        sessions.set(matchId, handle)
        const lobbyMatches = sessionsByLobby.get(lobby.code) ?? []
        lobbyMatches.push(handle)
        sessionsByLobby.set(lobby.code, lobbyMatches)
        // lobby-chosen spectators sit out every game of the match
        for (const m of lobby.memberList) {
          if (m.spectating) {
            match.session.setSpectating(m.id, true)
            match.match.spectate(m.id)
          }
        }
        sendToLobby(lobby, {
          type: 'match_start',
          matchId,
          players: lobby.memberList,
          settings: { ...lobby.settings },
          round: match.match.round,
        })
        for (const m of lobby.memberList) {
          if (m.spectating) sendToLobby(lobby, { type: 'player_spectating', playerId: m.id, spectating: true })
        }
        return
      }
      case 'spectate': {
        // lobby-level role choice only: players cannot switch between spectating
        // and playing once the match has started
        if (!conn.lobbyCode) {
          send(conn.ws, { type: 'error', code: 'not_in_lobby', message: 'you are not in a lobby' })
          return
        }
        if (sessionFor(conn)) {
          send(conn.ws, { type: 'error', code: 'forbidden', message: 'role is locked once the match starts' })
          return
        }
        const lobby = registry.get(conn.lobbyCode)!
        const member = lobby.getMember(conn.id)
        if (!member) return
        member.spectating = msg.spectating
        member.afk = false
        broadcastRoster(lobby)
        return
      }
      case 'set_afk': {
        if (!conn.lobbyCode) {
          send(conn.ws, { type: 'error', code: 'not_in_lobby', message: 'you are not in a lobby' })
          return
        }
        const lobby = registry.get(conn.lobbyCode)!
        const member = lobby.getMember(conn.id)
        if (!member) return
        if (msg.afk) {
          // LEAVE while in a match: leave the game (it resolves around them)
          // but stay in the lobby, marked AFK and able to return to the game
          const sess = sessionFor(conn)
          if (sess) {
            // remember the current role so returning restores it
            member.spectating = sess.match.session.isSpectating(conn.id)
            emitMatchEvents(sess, sess.match.match.removePlayer(conn.id))
            sess.match.session.remove(conn.id)
          }
          member.afk = true
          sendToLobby(lobby, { type: 'player_afk', playerId: conn.id, afk: true })
          broadcastRoster(lobby)
          return
        }
        // return to the game: rejoin the active match in the remembered role
        member.afk = false
        const entry = (sessionsByLobby.get(lobby.code) ?? []).find((e) => e.match.match.status === 'active')
        if (entry) {
          const rejoinAsSpectator = member.spectating === true
          entry.match.match.addPlayer(conn.id)
          entry.match.session.add({ id: conn.id, name: conn.name ?? 'PLAYER' })
          if (rejoinAsSpectator) {
            entry.match.match.spectate(conn.id)
            entry.match.session.setSpectating(conn.id, true)
          }
          // re-enter the game on this client (the store keys the game screen on it)
          send(conn.ws, { type: 'match_start', matchId: entry.match.matchId, players: lobby.memberList, settings: { ...lobby.settings }, round: entry.match.match.round })
        }
        sendToLobby(lobby, { type: 'player_afk', playerId: conn.id, afk: false })
        broadcastRoster(lobby)
        return
      }
      case 'topout': {
        const sess = sessionFor(conn, msg.matchId)
        if (!sess) return
        if (sess.match.session.isSpectating(conn.id)) return
        // mark the player out of the current game so others can't target them
        sess.match.session.eliminate(conn.id)
        const roundBefore = sess.match.match.round
        emitMatchEvents(sess, sess.match.match.topOut(conn.id))
        // in an ongoing N>2 game a dead player automatically becomes a
        // spectator; if their death ended the game (round advanced) they are
        // simply revived for the next game and keep playing
        const lobby = registry.get(sess.lobbyCode)
        if (lobby && sess.match.match.status === 'active' && sess.match.match.round === roundBefore && sess.match.match.playerList.find((p) => p.id === conn.id)?.alive === false) {
          sess.match.session.setSpectating(conn.id, true)
          sendToLobby(lobby, { type: 'player_spectating', playerId: conn.id, spectating: true })
        }
        return
      }
      case 'target': {
        const sess = sessionFor(conn)
        if (!sess) return
        const lobby = registry.get(sess.lobbyCode)
        if (lobby) for (const ev of sess.match.target(conn.id, msg.mode, msg.targetId)) sendToLobby(lobby, ev)
        return
      }
      case 'lock': {
        const sess = sessionFor(conn)
        // an in-flight lock can land right after the session ended (opponent
        // left/disconnected); drop it silently like snapshot/topout/target so the
        // client isn't spammed with an error it can't act on mid-game
        if (!sess) return
        if (sess.match.session.isSpectating(conn.id)) return
        for (const ev of sess.match.move(conn.id, msg.lock)) {
          if (ev.type === 'garbage') {
            const target = conns.get(ev.to)
            if (target) send(target.ws, { type: 'garbage', lines: ev.lines, hole: ev.hole, from: ev.from })
          } else {
            const lobby = registry.get(sess.lobbyCode)
            if (lobby) sendToLobby(lobby, ev)
          }
        }
        return
      }
      case 'snapshot': {
        const sess = sessionFor(conn, msg.matchId)
        if (!sess) return
        // Cross-check the client's board against the server-authoritative copy;
        // on real divergence, resync the client instead of letting it silently drift.
        const res = sess.match.snapshot(conn.id, msg.board)
        const lobby = registry.get(sess.lobbyCode)
        // the round lets clients drop stale relays from a previous round that are
        // still in flight when the next round's game_start arrives; the sender is
        // skipped because it already knows the board it just reported
        if (lobby)
          sendToLobbyExcept(lobby, conn.id, {
            type: 'board_update',
            playerId: conn.id,
            board: msg.board,
            score: msg.score,
            pendingGarbage: sess.match.pending(conn.id),
            round: sess.match.match.round,
            // hold/next/lines are informational display data for the opponent
            // view (the board itself stays authoritative); old clients that
            // don't send them get neutral defaults
            lines: msg.lines ?? 0,
            hold: msg.hold ?? null,
            next: msg.next ?? [],
          })
        if (res.status === 'resync') {
          send(conn.ws, { type: 'resync', board: res.board, pendingGarbage: res.pendingGarbage })
        } else {
          send(conn.ws, { type: 'snapshot_ack', seq: msg.seq })
        }
        return
      }
      case 'list_lobbies': {
        send(conn.ws, { type: 'lobby_list', lobbies: registry.publicList() })
        return
      }
      case 'ping': {
        send(conn.ws, { type: 'pong', t: msg.t })
        return
      }
    }
  }

  wss.on('connection', (ws) => {
    const conn: Conn = { ws, id: randomUUID(), name: null, lobbyCode: null, lastSeen: Date.now() }
    conns.set(conn.id, conn)
    ws.on('message', (data) => {
      try {
        handleMessage(conn, data.toString())
      } catch {
        send(ws, { type: 'error', code: 'server_error', message: 'internal error' })
      }
    })
    ws.on('close', () => {
      // 1) a live-member claim was waiting on THIS socket to close (a refresh
      // whose new socket beat its own close): the close has landed, so complete
      // the claim — the waiting socket adopts the member's identity and gets
      // the rejoin offer, exactly as if the member had been buffered first.
      const pending = pendingClaims.get(conn.id)
      if (pending) {
        pendingClaims.delete(conn.id)
        clearTimeout(pending.timer)
        const claimer = pending.conn
        if (conns.get(claimer.id) === claimer) {
          const lobby = conn.lobbyCode ? registry.get(conn.lobbyCode) : undefined
          if (lobby && lobby.getMember(conn.id)) adoptRejoin(claimer, conn.id, lobby, conn.name)
          else send(claimer.ws, { type: 'welcome', selfId: claimer.id })
        }
        return
      }
      // 2) this socket is itself a claimer that gave up before the member's
      // socket closed: drop the claim so it can't complete against a dead socket
      for (const [rejoinId, claim] of pendingClaims) {
        if (claim.conn === conn) {
          pendingClaims.delete(rejoinId)
          clearTimeout(claim.timer)
          break
        }
      }
      // 3) only act if this socket still owns its id. After a rejoin-claim, a
      // stale duplicate (second refresh / second tab, or this socket's own
      // delayed close from a refresh whose new socket was processed first)
      // holds the same id — its close must not yank the live claimer's routing
      // entry, and must not re-buffer / re-ghost a member the claimer now owns.
      const superseded = conns.get(conn.id) !== conn
      if (!superseded) conns.delete(conn.id)
      if (!superseded && conn.lobbyCode && !buffered.has(conn.id)) {
        const lobby = registry.get(conn.lobbyCode)
        const member = lobby?.getMember(conn.id)
        if (lobby && member) {
          // unexpected disconnect (refresh / tab close / network blip): keep the
          // member and their match for a grace period so they can rejoin. An
          // intentional leave already ran removeFromMatch + handleLeave (lobbyCode
          // null by then) and is pruned instantly, so it never reaches here.
          member.reconnecting = true
          const sess = sessionFor(conn)
          if (sess) {
            // sit them out of the current game so a ghost can't win it, and stop
            // routing attacks at them while they're gone
            sess.match.match.spectate(conn.id)
            sess.match.session.setSpectating(conn.id, true)
          }
          broadcastRoster(lobby)
          const timer = setTimeout(() => pruneBuffered(conn.id), reconnectGraceMs)
          buffered.set(conn.id, { conn, lobbyCode: conn.lobbyCode, timer })
          return
        }
        conn.lobbyCode = null
      }
    })
    ws.on('error', () => {})
  })

  const idleTimer = setInterval(() => {
    const now = Date.now()
    for (const lobby of registry.all()) {
      if (now - lobby.lastActivity > IDLE_MS) {
        sendToLobby(lobby, { type: 'error', code: 'lobby_closed', message: 'lobby closed due to inactivity' })
        registry.remove(lobby.code)
        // iterate a copy: removeSession splices the live array
        for (const entry of [...(sessionsByLobby.get(lobby.code) ?? [])]) removeSession(entry.match.matchId)
        broadcastLobbyList()
      }
    }
  }, IDLE_CHECK_MS)

  server.listen(port)

  return {
    registry,
    server,
    stats: () => ({
      conns: conns.size,
      sessions: sessions.size,
      lobbies: registry.all().length,
      work: { sends, stringifies, sessionScans },
    }),
    kick: (playerId) => {
      const conn = conns.get(playerId)
      if (conn) conn.ws.close()
    },
    close: () =>
      new Promise((resolve) => {
        clearInterval(idleTimer)
        for (const entry of buffered.values()) clearTimeout(entry.timer)
        buffered.clear()
        for (const claim of pendingClaims.values()) clearTimeout(claim.timer)
        pendingClaims.clear()
        for (const conn of conns.values()) conn.ws.close()
        wss.close()
        server.close(() => resolve())
      }),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 8787
  startServer(port)
  console.log(`tetris-relinked server listening on ws://localhost:${port}`)
}