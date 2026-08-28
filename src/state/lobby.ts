import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { net } from '../net/connection'
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
  setName: (name: string) => void
  connect: () => void
  disconnect: () => void
  createLobby: (visibility: Visibility, settings: LobbySettings) => void
  joinLobby: (code: string) => void
  leaveLobby: () => void
  updateSettings: (settings: LobbySettings) => void
  startMatch: () => void
  refreshLobbies: () => void
  match: Extract<ServerMessage, { type: 'match_start' }> | null
  clearMatch: () => void
}

let lastCode: string | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectAttempts++
  if (reconnectAttempts > 3) {
    lastCode = null
    useLobby.setState({ status: 'disconnected', error: 'connection lost' })
    return
  }
  useLobby.setState({ status: 'reconnecting' })
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    net.connect()
      .then(() => net.send({ type: 'hello', name: useLobby.getState().name }))
      .catch(() => scheduleReconnect())
  }, 1000)
}

function applyMessage(msg: ServerMessage): void {
  const s = useLobby.getState()
  switch (msg.type) {
    case 'welcome':
      reconnectAttempts = 0
      useLobby.setState({ status: 'connected', selfId: msg.selfId, error: null })
      if (lastCode) net.send({ type: 'join_lobby', code: lastCode })
      break
    case 'lobby_state':
      lastCode = msg.lobby.code
      useLobby.setState({ lobby: msg.lobby, error: null })
      break
    case 'roster_update':
      if (s.lobby) useLobby.setState({ lobby: { ...s.lobby, players: msg.players, hostId: msg.hostId } })
      break
    case 'settings_update':
      if (s.lobby) useLobby.setState({ lobby: { ...s.lobby, settings: msg.settings } })
      break
    case 'lobby_list':
      useLobby.setState({ lobbies: msg.lobbies })
      break
    case 'match_start':
      useLobby.setState({ match: msg })
      break
    case 'error':
      if (msg.code === 'connection_lost') {
        scheduleReconnect()
      } else {
        if (msg.code === 'not_found' && lastCode) lastCode = null
        useLobby.setState({ error: msg.message })
      }
      break
    case 'pong':
      break
  }
}

net.onMessage(applyMessage)

export const useLobby = create<LobbyStore>()(
  persist(
    (set, get) => ({
      status: 'disconnected',
      latency: null,
      error: null,
      lobby: null,
      selfId: null,
      name: 'PLAYER',
      lobbies: [],
      match: null,
      setName: (name) => set({ name: sanitizeName(name) }),
      connect: () => {
        if (net.connected || get().status === 'connecting' || get().status === 'reconnecting') return
        set({ status: 'connecting', error: null })
        net.connect()
          .then(() => net.send({ type: 'hello', name: get().name }))
          .catch(() => set({ status: 'disconnected', error: 'could not reach server' }))
      },
      disconnect: () => {
        net.close()
        lastCode = null
        reconnectAttempts = 0
        set({ status: 'disconnected', lobby: null, error: null })
      },
      createLobby: (visibility, settings) => {
        const name = get().name
        net.send({ type: 'create_lobby', name, visibility, settings: sanitizeLobbySettings(settings) })
      },
      joinLobby: (code) => {
        net.send({ type: 'join_lobby', code: code.trim().toUpperCase() })
      },
      leaveLobby: () => {
        lastCode = null
        net.send({ type: 'leave_lobby' })
        set({ lobby: null, error: null })
      },
      updateSettings: (settings) => {
        net.send({ type: 'settings_update', settings: sanitizeLobbySettings(settings) })
      },
      startMatch: () => {
        net.send({ type: 'start_match' })
      },
      refreshLobbies: () => {
        net.send({ type: 'list_lobbies' })
      },
      clearMatch: () => set({ match: null }),
    }),
    {
      name: 'tetris-liberation-lobby',
      partialize: (s) => ({ name: s.name }),
    },
  ),
)