import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { LobbyRegistry } from './registry.ts'
import { Lobby, MAX_PLAYERS, type Member } from './lobby.ts'
import { Session } from './session.ts'
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
  session: Session
  playerIds: string[]
}

let nextMatchId = 1

export interface ServerHandle {
  registry: LobbyRegistry
  server: import('node:http').Server
  close: () => Promise<void>
}

export function startServer(port: number): ServerHandle {
  const registry = new LobbyRegistry()
  const conns = new Map<string, Conn>()
  const sessions = new Map<string, SessionHandle>()
  const server = createServer()
  const wss = new WebSocketServer({ server })

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  const sendToLobby = (lobby: Lobby, msg: ServerMessage) => {
    for (const member of lobby.memberList) {
      const conn = conns.get(member.id)
      if (conn) send(conn.ws, msg)
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

  const handleLeave = (conn: Conn, lobby: Lobby) => {
    const { empty, newHostId } = lobby.leave(conn.id)
    conn.lobbyCode = null
    if (empty) {
      registry.remove(lobby.code)
      return
    }
    broadcastRoster(lobby)
    if (newHostId) {
      const hostConn = conns.get(newHostId)
      if (hostConn) send(hostConn.ws, { type: 'error', code: 'host_transferred', message: 'you are now the host' })
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
        return
      }
      case 'leave_lobby': {
        if (!conn.lobbyCode) {
          send(conn.ws, { type: 'error', code: 'not_in_lobby', message: 'you are not in a lobby' })
          return
        }
        const lobby = registry.get(conn.lobbyCode)
        conn.lobbyCode = null
        if (lobby) handleLeave(conn, lobby)
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
        if (lobby.size < 2) {
          send(conn.ws, { type: 'error', code: 'need_players', message: 'need at least 2 players to start' })
          return
        }
        const members = lobby.memberList.map((p) => ({ id: p.id, name: p.name }))
        const matchId = `m${nextMatchId++}`
        const session = new Session(matchId, members, lobby.settings)
        sessions.set(matchId, { session, playerIds: members.map((m) => m.id) })
        sendToLobby(lobby, {
          type: 'match_start',
          matchId,
          players: lobby.memberList,
          settings: { ...lobby.settings },
        })
        return
      }
      case 'lock': {
        const sess = conn.lobbyCode ? sessions.get(`m${nextMatchId - 1}`) : undefined
        if (!sess || !sess.session.has(conn.id)) {
          send(conn.ws, { type: 'error', code: 'not_in_match', message: 'you are not in an active match' })
          return
        }
        for (const ev of sess.session.move(conn.id, msg.lock)) {
          if (ev.type === 'garbage') {
            const target = conns.get(ev.to)
            if (target) send(target.ws, { type: 'garbage', lines: ev.lines, hole: ev.hole, from: ev.from })
          }
        }
        return
      }
      case 'snapshot': {
        const sess = conn.lobbyCode ? sessions.get(`m${nextMatchId - 1}`) : undefined
        if (!sess || !sess.session.has(conn.id)) return
        const res = sess.session.checkSnapshot(conn.id, msg.board, msg.score)
        if (res.status === 'resync') {
          send(conn.ws, { type: 'resync', board: res.board, pendingGarbage: res.pendingGarbage, score: res.score })
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
      conns.delete(conn.id)
      if (conn.lobbyCode) {
        const lobby = registry.get(conn.lobbyCode)
        conn.lobbyCode = null
        if (lobby) handleLeave(conn, lobby)
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
      }
    }
  }, IDLE_CHECK_MS)

  server.listen(port)

  return {
    registry,
    server,
    close: () =>
      new Promise((resolve) => {
        clearInterval(idleTimer)
        for (const conn of conns.values()) conn.ws.close()
        wss.close()
        server.close(() => resolve())
      }),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 8787
  startServer(port)
  console.log(`tetris-liberation server listening on ws://localhost:${port}`)
}