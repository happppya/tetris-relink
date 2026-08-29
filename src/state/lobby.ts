import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { NetConnection, net } from '../net/connection'
import { sanitizeLobbySettings, sanitizeName } from '../../shared/lobby-settings.ts'
import type { LobbySettings, LobbyState, PublicLobbyInfo, ServerMessage, Visibility } from '../../shared/protocol.ts'

export type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

interface LobbyStore {
  status: ConnStatus
  latency: number | null
  error: string | null
  lobby: LobbyState | null
  selfId: string | null
  name: string
  lobbies: PublicLobbyInfo[]
  /** a rejoin offer from the server after an unexpected disconnect (fresh load): the UI shows a popup */
  pendingRejoin: { lobbyCode: string; matchActive: boolean } | null
  setName: (name: string) => void
  connect: (url?: string) => void
  disconnect: () => void
  createLobby: (visibility: Visibility, settings: LobbySettings) => void
  joinLobby: (code: string) => void
  leaveLobby: () => void
  updateSettings: (settings: LobbySettings) => void
  startMatch: () => void
  refreshLobbies: () => void
  /** lobby role choice before the match starts (spectate = watch, not play) */
  setSpectating: (spectating: boolean) => void
  /** press LEAVE mid-match: leave the game but stay in the lobby, marked AFK */
  goAfk: () => void
  /** from the lobby while AFK: rejoin the running game */
  returnToGame: () => void
  /** accept the pending rejoin offer: back into the lobby + match */
  rejoinGame: () => void
  /** decline the pending rejoin offer: the server prunes you instantly */
  dismissRejoin: () => void
  match: Extract<ServerMessage, { type: 'match_start' }> | null
  clearMatch: () => void
}

/**
 * A lobby store bound to one connection. The app uses the `useLobby` singleton
 * (backed by the shared `net`); tests can build additional independent
 * client-side stores backed by their own `NetConnection` to exercise the real
 * client stack against a live server.
 */
export function createLobbyStore(conn: NetConnection = net) {
  let lastCode: string | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let connectUrl: string | undefined
  /** set while an in-app auto-reconnect is re-joining via the server offer */
  let rejoining = false

  // hello carries the persisted selfId so the server can offer a rejoin after
  // an unexpected disconnect (refresh / tab close / network blip)
  const sendHello = () => {
    const s = store.getState()
    conn.send({ type: 'hello', name: s.name, rejoinId: s.selfId ?? undefined })
  }
  function scheduleReconnect(): void {
    if (reconnectTimer) return
    reconnectAttempts++
    if (reconnectAttempts > 3) {
      lastCode = null
      store.setState({ status: 'disconnected', error: 'connection lost' })
      return
    }
    store.setState({ status: 'reconnecting' })
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      conn
        .connect(connectUrl)
        .then(() => sendHello())
        .catch(() => scheduleReconnect())
    }, 1000)
  }

  function applyMessage(msg: ServerMessage): void {
    const s = store.getState()
    switch (msg.type) {
      case 'welcome':
        reconnectAttempts = 0
        store.setState({ status: 'connected', selfId: msg.selfId, error: null })
        // an in-app auto-reconnect already sent `rejoin` when the offer landed,
        // so don't also re-join the lobby via code here
        if (rejoining) {
          rejoining = false
        } else if (lastCode) {
          conn.send({ type: 'join_lobby', code: lastCode })
        } else {
          conn.send({ type: 'list_lobbies' })
        }
        break
      case 'rejoin_offer':
        if (lastCode) {
          // the drop happened while this store was in a lobby: an in-app
          // reconnect, the user never left — rejoin silently, no popup
          rejoining = true
          conn.send({ type: 'rejoin' })
        } else {
          // fresh page load: surface the offer so the UI can ask
          store.setState({ pendingRejoin: { lobbyCode: msg.lobbyCode, matchActive: msg.matchActive } })
        }
        break
      case 'lobby_state':
        lastCode = msg.lobby.code
        store.setState({ lobby: msg.lobby, error: null })
        break
      case 'roster_update':
        if (s.lobby) store.setState({ lobby: { ...s.lobby, players: msg.players, hostId: msg.hostId } })
        break
      case 'settings_update':
        if (s.lobby) store.setState({ lobby: { ...s.lobby, settings: msg.settings } })
        break
      case 'lobby_list':
        store.setState({ lobbies: msg.lobbies })
        break
      case 'match_start':
        store.setState({ match: msg })
        break
      case 'error':
        if (msg.code === 'connection_lost') {
          // the socket dropped: leave the match screen and reconnect. The server
          // keeps us in the lobby + match for a grace period, and the reconnect
          // presents our id and is offered a rejoin (auto-accepted in-app).
          store.setState({ match: null, pendingRejoin: null })
          scheduleReconnect()
        } else {
          if (msg.code === 'not_found' && lastCode) {
            // the lobby we were reconnecting to is gone: fall back to the list
            // screen with a fresh list instead of a stale one
            lastCode = null
            conn.send({ type: 'list_lobbies' })
          }
          store.setState({ error: msg.message })
        }
        break
      case 'pong':
        break
    }
  }

  const store = create<LobbyStore>()(
    persist(
      (set, get) => ({
        status: 'disconnected',
        latency: null,
        error: null,
        lobby: null,
        selfId: null,
        name: 'PLAYER',
        lobbies: [],
        pendingRejoin: null,
        match: null,
        setName: (name) => set({ name: sanitizeName(name) }),
        connect: (url?: string) => {
          if (conn.connected || get().status === 'connecting' || get().status === 'reconnecting') return
          connectUrl = url
          set({ status: 'connecting', error: null })
          conn
            .connect(url)
            .then(() => sendHello())
            .catch(() => set({ status: 'disconnected', error: 'could not reach server' }))
        },
        disconnect: () => {
          // intentional disconnect through the interface: pruned instantly by
          // the server (no rejoin grace), like any leave
          if (get().lobby || get().match) {
            lastCode = null
            conn.send({ type: 'leave_lobby' })
          }
          conn.close()
          lastCode = null
          reconnectAttempts = 0
          set({ status: 'disconnected', lobby: null, match: null, error: null, pendingRejoin: null })
        },
        createLobby: (visibility, settings) => {
          const name = get().name
          conn.send({ type: 'create_lobby', name, visibility, settings: sanitizeLobbySettings(settings) })
        },
        joinLobby: (code) => {
          conn.send({ type: 'join_lobby', code: code.trim().toUpperCase() })
        },
        leaveLobby: () => {
          // a double-press (or a stale call after the match ended) must not send
          // a second leave that the server would answer with not_in_lobby
          if (!get().lobby && !get().match) return
          lastCode = null
          conn.send({ type: 'leave_lobby' })
          set({ lobby: null, match: null, error: null })
        },
        updateSettings: (settings) => {
          conn.send({ type: 'settings_update', settings: sanitizeLobbySettings(settings) })
        },
        startMatch: () => {
          conn.send({ type: 'start_match' })
        },
        refreshLobbies: () => {
          conn.send({ type: 'list_lobbies' })
        },
        setSpectating: (spectating) => {
          conn.send({ type: 'spectate', spectating })
        },
        goAfk: () => {
          if (!get().match) return
          conn.send({ type: 'set_afk', afk: true })
          set({ match: null })
        },
        returnToGame: () => {
          conn.send({ type: 'set_afk', afk: false })
        },
        rejoinGame: () => {
          conn.send({ type: 'rejoin' })
          set({ pendingRejoin: null })
        },
        dismissRejoin: () => {
          conn.send({ type: 'dismiss_rejoin' })
          set({ pendingRejoin: null })
        },
        clearMatch: () => set({ match: null }),
      }),
      {
        name: 'tetris-liberation-lobby',
        // selfId is persisted so a refresh can present the previous identity to
        // the server and be offered a rejoin of the game they were in
        partialize: (s) => ({ name: s.name, selfId: s.selfId }),
        storage: createJSONStorage(() => localStorage),
      },
    ),
  )

  conn.onMessage(applyMessage)
  return store
}

export type LobbyHook = ReturnType<typeof createLobbyStore>

export const useLobby = createLobbyStore()
