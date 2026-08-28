import { useEffect, useState } from 'react'
import { useLobby } from '../state/lobby'
import { describeLobbySettings } from '../../shared/lobby-settings.ts'
import type { Visibility } from '../../shared/protocol.ts'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-80 border border-neutral-800 p-4">
      <h2 className="mb-3 font-mono text-xs tracking-widest text-neutral-500">{title}</h2>
      {children}
    </div>
  )
}

export function MultiplayerScreen({ onBack }: { onBack: () => void }) {
  const status = useLobby((s) => s.status)
  const latency = useLobby((s) => s.latency)
  const error = useLobby((s) => s.error)
  const name = useLobby((s) => s.name)
  const lobbies = useLobby((s) => s.lobbies)
  const setName = useLobby((s) => s.setName)
  const createLobby = useLobby((s) => s.createLobby)
  const joinLobby = useLobby((s) => s.joinLobby)
  const refreshLobbies = useLobby((s) => s.refreshLobbies)
  const connect = useLobby((s) => s.connect)

  const [visibility, setVisibility] = useState<Visibility>('public')
  const [joinCode, setJoinCode] = useState('')

  useEffect(() => {
    connect()
    refreshLobbies()
  }, [connect, refreshLobbies])

  const connected = status === 'connected'

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 font-mono">
      <h1 className="text-xl tracking-[0.3em] text-neutral-200">MULTIPLAYER</h1>
      <div className="flex w-80 justify-between text-xs text-neutral-500">
        <span>
          {status}
          {connected && latency !== null && ` · ${Math.round(latency)}ms`}
        </span>
        <button onClick={onBack} className="text-neutral-400 hover:text-neutral-200">
          ← MENU
        </button>
      </div>

      <Section title="PLAYER">
        <input
          value={name}
          maxLength={16}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-neutral-800 bg-black px-2 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-500"
        />
      </Section>

      <Section title="CREATE LOBBY">
        <div className="mb-3 flex gap-2">
          {(['public', 'private'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVisibility(v)}
              className={`flex-1 border px-2 py-1 text-xs tracking-widest ${
                visibility === v
                  ? 'border-neutral-300 text-neutral-100'
                  : 'border-neutral-800 text-neutral-500 hover:border-neutral-600'
              }`}
            >
              {v.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          disabled={!connected}
          onClick={() => createLobby(visibility, { mode: 'firstToX', goal: 7, winBy: 2 })}
          className="w-full border border-neutral-700 py-2 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-40"
        >
          CREATE
        </button>
      </Section>

      <Section title="JOIN BY CODE">
        <div className="flex gap-2">
          <input
            value={joinCode}
            maxLength={5}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="CODE"
            className="flex-1 border border-neutral-800 bg-black px-2 py-1 text-sm tracking-[0.3em] text-neutral-200 outline-none focus:border-neutral-500"
          />
          <button
            disabled={!connected || joinCode.length < 5}
            onClick={() => joinLobby(joinCode)}
            className="border border-neutral-700 px-3 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-40"
          >
            JOIN
          </button>
        </div>
      </Section>

      <Section title="LOBBIES">
        <div className="mb-2 flex justify-between text-xs text-neutral-500">
          <span>{lobbies.length} PUBLIC</span>
          <button onClick={refreshLobbies} className="text-neutral-400 hover:text-neutral-200">
            REFRESH
          </button>
        </div>
        {lobbies.length === 0 && <p className="py-2 text-xs text-neutral-600">no public lobbies</p>}
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {lobbies.map((l) => (
            <div key={l.code} className="flex items-center gap-2 border border-neutral-900 px-2 py-1 text-xs">
              <span className="tracking-widest text-neutral-300">{l.code}</span>
              <span className="flex-1 truncate text-neutral-500">{l.hostName}</span>
              <span className="text-neutral-500">{l.playerCount}p</span>
              <span className="hidden text-neutral-600 sm:inline">{describeLobbySettings(l.settings)}</span>
              <button
                disabled={!connected}
                onClick={() => joinLobby(l.code)}
                className="border border-neutral-700 px-2 py-0.5 text-neutral-200 hover:bg-neutral-900 disabled:opacity-40"
              >
                JOIN
              </button>
            </div>
          ))}
        </div>
      </Section>

      {error && <p className="w-80 text-center text-xs text-red-400">{error}</p>}
    </main>
  )
}