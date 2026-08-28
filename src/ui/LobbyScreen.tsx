import { useEffect, useState } from 'react'
import { useLobby } from '../state/lobby'
import { describeLobbySettings } from '../../shared/lobby-settings.ts'
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

  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!lobby) onExit()
  }, [lobby, onExit])

  if (!lobby) return null

  const isHost = selfId === lobby.hostId

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

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 font-mono">
      <h1 className="text-xl tracking-[0.3em] text-neutral-200">LOBBY</h1>

      <div className="w-80 border border-neutral-800 p-4">
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

      <div className="w-80 border border-neutral-800 p-4">
        <h2 className="mb-3 font-mono text-xs tracking-widest text-neutral-500">ROSTER</h2>
        <div className="flex flex-col gap-1">
          {lobby.players.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm">
              <span className="text-neutral-200">
                {p.name}
                {p.id === selfId && <span className="ml-2 text-neutral-600">(you)</span>}
              </span>
              {p.isHost && <span className="text-xs tracking-widest text-neutral-400">HOST</span>}
            </div>
          ))}
        </div>
      </div>

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
    </main>
  )
}