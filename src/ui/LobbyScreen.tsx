import { useEffect, useState } from 'react'
import { useLobby } from '../state/lobby'
import { describeLobbySettings, isMatchPoint } from '../../shared/lobby-settings.ts'
import type { LobbySettings } from '../../shared/protocol.ts'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between font-mono text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-200">{value}</span>
    </div>
  )
}

export function LobbyScreen({ onExit }: { onExit: () => void }) {
  const lobby = useLobby((s) => s.lobby)
  const selfId = useLobby((s) => s.selfId)
  const error = useLobby((s) => s.error)
  const updateSettings = useLobby((s) => s.updateSettings)
  const leaveLobby = useLobby((s) => s.leaveLobby)
  const startMatch = useLobby((s) => s.startMatch)
  const setSpectating = useLobby((s) => s.setSpectating)
  const returnToGame = useLobby((s) => s.returnToGame)

  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!lobby) onExit()
  }, [lobby, onExit])

  if (!lobby) return null

  const isHost = selfId === lobby.hostId
  const self = lobby.players.find((p) => p.id === selfId)
  const selfAfk = self?.afk === true
  const selfSpectating = self?.spectating === true

  const patch = (p: Partial<LobbySettings>) => updateSettings({ ...lobby.settings, ...p })

  const clampNum = (v: number) => Math.min(99, Math.max(1, Math.round(v)))

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(lobby.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard unavailable; the code is visible on screen
    }
  }

  const gameScores: Record<string, number> = Object.fromEntries(lobby.players.map((p) => [p.id, p.score]))

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 font-mono">
      <h1 className="text-xl tracking-[0.3em] text-neutral-200">LOBBY</h1>

      <div className="flex items-start gap-4">
        <aside className="w-56 border border-neutral-800 p-4">
          <h2 className="mb-3 font-mono text-xs tracking-widest text-neutral-500">ROSTER</h2>
          <div className="flex flex-col gap-1">
            {lobby.players.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-neutral-200">
                  {p.name}
                  {p.id === selfId && <span className="ml-1 text-neutral-600">(you)</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs tracking-widest">
                  {p.isHost && <span className="text-neutral-400">HOST</span>}
                  {p.reconnecting ? <span className="text-neutral-500">RECONNECTING…</span> : p.afk ? <span className="text-neutral-600">AFK</span> : p.spectating ? <span className="text-neutral-500">SPECTATE</span> : null}
                  {isMatchPoint(gameScores, lobby.settings, p.id) && p.score > 0 && <span className="text-[10px] text-yellow-400">MP</span>}
                  <span className="text-neutral-200">{p.score}</span>
                </span>
              </div>
            ))}
          </div>
        </aside>

        <div className="flex w-80 flex-col gap-4">
      <div className="border border-neutral-800 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs tracking-widest text-neutral-500">
            {lobby.visibility === 'public' ? 'PUBLIC' : 'PRIVATE'}
          </span>
          <button onClick={copyCode} className="text-xs text-neutral-400 hover:text-neutral-200">
            {copied ? 'COPIED' : 'COPY'} CODE
          </button>
        </div>
        <p className="mb-3 text-center text-2xl tracking-[0.4em] text-neutral-100">{lobby.code}</p>
        <Field label="PLAYERS" value={`${lobby.players.length}/8`} />
        <Field label="RULES" value={describeLobbySettings(lobby.settings)} />
      </div>

      {selfAfk ? (
        <div className="w-80 border border-neutral-800 p-4">
          <h2 className="mb-2 font-mono text-xs tracking-widest text-neutral-500">YOU ARE AFK</h2>
          <p className="mb-3 text-xs text-neutral-600">you left the game but are still in the lobby</p>
          <div className="flex gap-2">
            <button onClick={returnToGame} className="flex-1 border border-neutral-300 py-2 text-sm tracking-widest text-neutral-100 hover:bg-neutral-900">
              RETURN TO GAME
            </button>
            <button onClick={() => { leaveLobby(); onExit() }} className="flex-1 border border-neutral-700 py-2 text-sm text-neutral-400 hover:bg-neutral-900">
              LEAVE LOBBY
            </button>
          </div>
        </div>
      ) : (
        <div className="w-80 border border-neutral-800 p-4">
          <h2 className="mb-3 font-mono text-xs tracking-widest text-neutral-500">YOUR ROLE</h2>
          <div className="flex gap-2">
            {(['play', 'spectate'] as const).map((role) => (
              <button
                key={role}
                onClick={() => setSpectating(role === 'spectate')}
                className={`flex-1 border px-2 py-1 text-xs tracking-widest ${
                  (role === 'spectate') === selfSpectating
                    ? 'border-neutral-300 text-neutral-100'
                    : 'border-neutral-800 text-neutral-500 hover:border-neutral-600'
                }`}
              >
                {role === 'spectate' ? 'SPECTATE' : 'PLAY'}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="w-80 border border-neutral-800 p-4">
        <h2 className="mb-3 font-mono text-xs tracking-widest text-neutral-500">
          ROOM SETTINGS {!isHost && <span className="text-neutral-600">· host only</span>}
        </h2>
        <div className="mb-3 flex gap-2">
          {(['firstToX', 'winByX'] as const).map((m) => (
            <button
              key={m}
              disabled={!isHost}
              onClick={() => patch({ mode: m })}
              className={`flex-1 border px-2 py-1 text-xs tracking-widest ${
                lobby.settings.mode === m
                  ? 'border-neutral-300 text-neutral-100'
                  : 'border-neutral-800 text-neutral-500 hover:border-neutral-600'
              } disabled:opacity-60`}
            >
              {m === 'firstToX' ? 'FIRST TO X' : 'WIN BY X'}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-neutral-500">4-WIDE</span>
          <button
            disabled={!isHost}
            onClick={() => patch({ fourWide: !lobby.settings.fourWide })}
            className={`w-16 border px-2 py-0.5 text-xs ${
              lobby.settings.fourWide ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500'
            } disabled:opacity-60`}
          >
            {lobby.settings.fourWide ? 'ON' : 'OFF'}
          </button>
        </div>
        {lobby.settings.mode === 'firstToX' ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-500">FIRST TO</span>
            <input
              type="number"
              min={1}
              max={99}
              disabled={!isHost}
              value={lobby.settings.goal}
              onChange={(e) => {
                const v = clampNum(Number(e.target.value) || 1)
                patch({ goal: v })
              }}
              className="w-16 border border-neutral-800 bg-black px-2 py-1 text-right text-neutral-200 outline-none focus:border-neutral-500"
            />
          </div>
        ) : (
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-500">WIN BY</span>
            <input
              type="number"
              min={1}
              max={99}
              disabled={!isHost}
              value={lobby.settings.winBy}
              onChange={(e) => {
                const v = clampNum(Number(e.target.value) || 1)
                patch({ winBy: v })
              }}
              className="w-16 border border-neutral-800 bg-black px-2 py-1 text-right text-neutral-200 outline-none focus:border-neutral-500"
            />
          </div>
        )}
      </div>

      {error && <p className="w-80 text-center text-xs text-red-400">{error}</p>}

      {!selfAfk && (
      <div className="flex w-80 gap-2">
        {isHost ? (
          <button
            onClick={startMatch}
            className="flex-1 border border-neutral-300 py-2 text-sm tracking-widest text-neutral-100 hover:bg-neutral-900"
          >
            START
          </button>
        ) : (
          <p className="flex-1 py-2 text-center text-xs text-neutral-600">waiting for host to start…</p>
        )}
        <button
          onClick={() => {
            leaveLobby()
            onExit()
          }}
          className="flex-1 border border-neutral-700 py-2 text-sm text-neutral-400 hover:bg-neutral-900"
        >
          LEAVE
        </button>
      </div>
      )}
        </div>
      </div>
    </main>
  )
}