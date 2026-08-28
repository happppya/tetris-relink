import { useEffect, useRef, useState } from 'react'
import { GameRunner } from '../game/runner'
import { InputManager } from '../game/input'
import { useSettings, msToFrames } from '../state/settings'
import { useLobby } from '../state/lobby'
import { net } from '../net/connection'
import { renderBoard, drawMiniPiece } from '../render/canvas'
import { GarbageMeter } from './GarbageMeter'
import type { GameEvent } from '../engine/game'
import type { InputAction, Cell } from '../engine/types'
import type { ServerMessage } from '../../shared/protocol.ts'
import { deserializeBoard, serializeBoard } from '../../shared/board.ts'

const CELL = 30
const OPPONENT_CELL = 8
const MAX_OPPONENTS = 7

export function MultiplayerGameScreen({ onExit }: { onExit: () => void }) {
  const settings = useSettings()
  const match = useLobby((s) => s.match)
  const clearMatch = useLobby((s) => s.clearMatch)
  const [hud, setHud] = useState({ score: 0, lines: 0, incoming: 0, latency: 0 })
  const [error, setError] = useState<string | null>(null)
  const [targetMode, setTargetMode] = useState<'manual' | 'revenge' | 'random'>('random')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [opponents, setOpponents] = useState<Record<string, { board: Cell[][]; score: number; incoming: number; left?: boolean; wins: number; alive: boolean }>>({})
  const [round, setRound] = useState(1)
  const [wins, setWins] = useState<Record<string, number>>({})
  const [finished, setFinished] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nextRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!match) return
    const selectedTargetMode = targetMode
    const ctx = canvasRef.current!.getContext('2d')!
    const nextCtx = nextRef.current!.getContext('2d')!
    let snapshotSeq = 0
    let lastSnapshot = 0
    let lastLockPieces = 0
    let stopped = false
    let endTimer: ReturnType<typeof setTimeout> | null = null
    let raf = 0
    let last = performance.now()
    let paused = false

    const runner = new GameRunner({
      mode: 'versus',
      gameOptions: {
        sendsGarbage: true,
        attack: settings.attack,
        handling: {
          dasFrames: Math.max(1, msToFrames(settings.dasMs)),
          arrFrames: msToFrames(settings.arrMs),
          sddFrames: msToFrames(settings.sddMs),
        },
      },
      onEvent: (events: GameEvent[]) => {
        for (const ev of events) {
          if (ev.type === 'clear') {
            net.send({ type: 'lock', lock: { rows: ev.info.count, spin: ev.info.spin, piece: ev.info.piece, perfectClear: ev.info.perfectClear, combo: runner.game.combo - 1, b2b: ev.attack.b2b, streak: ev.attack.streakBonus } })
          } else if (ev.type === 'lock' && runner.game.piecesPlaced > lastLockPieces) {
            net.send({ type: 'lock', lock: { rows: 0, spin: 'none', piece: ev.piece.type, perfectClear: false, combo: runner.game.combo, b2b: runner.game.b2bActive, streak: runner.game.streak } })
          }
        }
        lastLockPieces = runner.game.piecesPlaced
      },
      onEnd: () => {},
    })

    const unsubscribe = net.onMessage((msg: ServerMessage) => {
      if (msg.type === 'game_end') {
        setRound(msg.round)
        setWins(msg.wins)
        setError(msg.winnerId ? `GAME WON BY ${msg.winnerId}` : 'GAME OVER')
        setOpponents((current) => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, { ...value, alive: !msg.eliminatedIds.includes(id), wins: msg.wins[id] ?? value.wins }])))
      }
      if (msg.type === 'game_start') {
        const board = deserializeBoard(msg.board) as Cell[][]
        if (board.length === 20 && board.every((row) => row.length === 10)) {
          const snap = runner.game.snapshot()
          runner.game.restore({ ...snap, board: [...snap.board.slice(0, 4), ...board], score: 0, lines: 0, piecesPlaced: 0, frames: 0, over: false, garbageQueue: [] })
        }
        setRound(msg.round); setError(null); setOpponents({})
      }
      if (msg.type === 'match_end') { setError(`MATCH WON BY ${msg.winnerId}`); setFinished(true); runner.abort(); endTimer = setTimeout(() => { clearMatch(); onExit() }, 3000) }
      if (msg.type === 'player_left') setOpponents((current) => ({ ...current, [msg.playerId]: { ...(current[msg.playerId] ?? { board: [], score: 0, incoming: 0, wins: 0, alive: false }), left: true, alive: false } }))
      if (msg.type === 'target_update' && msg.playerId === useLobby.getState().selfId) { setTargetMode(msg.mode); setTargetId(msg.targetId) }
      if (msg.type === 'board_update' && msg.playerId !== useLobby.getState().selfId) {
        const board = deserializeBoard(msg.board) as Cell[][]
        if (board.length === 20 && board.every((row) => row.length === 10)) setOpponents((current) => ({ ...current, [msg.playerId]: { board, score: msg.score, incoming: msg.pendingGarbage, wins: current[msg.playerId]?.wins ?? 0, alive: current[msg.playerId]?.alive ?? true } }))
      }
      if (msg.type === 'garbage') {
        runner.game.receiveGarbage(msg.lines, false, msg.hole)
        setHud((h) => ({ ...h, incoming: runner.game.pendingGarbage }))
      } else if (msg.type === 'resync') {
        const board = deserializeBoard(msg.board) as Cell[][]
        const snap = runner.game.snapshot()
        if (board.length !== 20 || board.some((row) => row.length !== 10)) {
          setError('received invalid resync state')
          return
        }
        runner.game.restore({ ...snap, board: [
          ...snap.board.slice(0, snap.board.length - board.length),
          ...board,
        ], score: msg.score, garbageQueue: [] })
        if (msg.pendingGarbage > 0) runner.game.receiveGarbage(msg.pendingGarbage, false, 0)
        setError(null)
      }
    })

    const codeMap: Partial<Record<string, InputAction>> = {}
    for (const [action, code] of Object.entries(settings.keybinds)) if (code) codeMap[code] = action as InputAction
    const input = new InputManager(() => codeMap)
    input.attach()

    const loop = (t: number) => {
      if (stopped) return
      const dt = t - last
      last = t
      const actions = input.drainActions()
      if (actions.includes('pause')) paused = !paused
      if (actions.includes('assist')) net.send({ type: 'target', mode: selectedTargetMode })
      if (actions.includes('retry')) return
      if (!paused) {
        runner.advance(dt, { dir: input.dir, softDrop: input.softDrop, actions })
        const g = runner.game
        if (g.frames - lastSnapshot >= 30) {
          lastSnapshot = g.frames
          snapshotSeq++
          net.send({ type: 'snapshot', board: serializeBoard(g.board.slice(-20)), score: g.score, seq: snapshotSeq, matchId: match.matchId })
        }
        // Locks are sent from the event stream via the same tick cadence.
        // runner events are captured below by comparing the lock event count.
        setHud({ score: g.score, lines: g.lines, incoming: g.pendingGarbage, latency: Math.round(net.latency) })
      }
      const g = runner.game
      renderBoard(ctx, g.board, g.active, g.ghostPiece, { cellSize: CELL, showGhost: settings.ghost })
      nextCtx.clearRect(0, 0, nextCtx.canvas.width, nextCtx.canvas.height)
      g.nextQueue.forEach((type, i) => drawMiniPiece(nextCtx, type, nextCtx.canvas.width / 2, 24 + i * 44, i === 0 ? 12 : 10))
      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      input.detach()
      unsubscribe()
      runner.abort()
      if (endTimer) clearTimeout(endTimer)
    }
  }, [match, settings, targetMode, clearMatch, onExit])

  if (!match) return null
  return (
    <main className="flex min-h-screen items-center justify-center gap-6 font-mono">
      <aside className="w-40">
        <h2 className="mb-2 text-xs tracking-widest text-neutral-500">MATCH</h2>
        <p className="mb-4 text-xs text-neutral-400">ROUND {round} · {match.settings.mode === 'firstToX' ? `FIRST TO ${match.settings.goal}` : `WIN BY ${match.settings.winBy}`}</p>
        <p className="text-xs text-neutral-500">{Object.entries(wins).map(([id, value]) => `${match.players.find((player) => player.id === id)?.name ?? id}: ${value}`).join(' · ')}</p>
        <p className="text-xs text-neutral-500">{hud.latency}ms · {targetMode.toUpperCase()}</p>
        <div className="mt-3 flex gap-1">
          {(['manual', 'revenge', 'random'] as const).map((mode) => <button key={mode} onClick={() => { setTargetMode(mode); setTargetId(null); net.send({ type: 'target', mode }) }} className={`border px-1 text-[10px] ${targetMode === mode ? 'border-neutral-300 text-neutral-100' : 'border-neutral-800 text-neutral-500'}`}>{mode.slice(0, 3).toUpperCase()}</button>)}
        </div>
        <p className="text-sm text-neutral-200">SCORE {hud.score}</p>
        <p className="text-sm text-neutral-200">LINES {hud.lines}</p>
        <GarbageMeter amount={hud.incoming} />
      </aside>
      <div className="flex items-start gap-2">
        <canvas ref={canvasRef} width={300} height={600} className="border border-neutral-700" />
        <div><h2 className="mb-1 text-xs tracking-widest text-neutral-500">NEXT</h2><canvas ref={nextRef} width={120} height={230} className="border border-neutral-800" /></div>
      </div>
      <aside className="w-64">
        <h2 className="mb-2 text-xs tracking-widest text-neutral-500">OPPONENTS</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {match.players.filter((p) => p.id !== useLobby.getState().selfId).slice(0, MAX_OPPONENTS).map((p) => {
          const opponent = opponents[p.id]
          return <button key={p.id} disabled={opponent?.left || opponent?.alive === false} onClick={() => { setTargetMode('manual'); setTargetId(p.id); net.send({ type: 'target', mode: 'manual', targetId: p.id }) }} className={`flex min-w-0 items-start gap-2 text-left disabled:opacity-40 ${targetId === p.id ? 'border border-neutral-300' : ''}`}><div className="min-w-0 flex-1"><p className="truncate text-sm text-neutral-300">{p.name}{opponent?.left ? ' · LEFT' : opponent?.alive === false ? ' · OUT' : ''}</p><p className="text-xs text-neutral-600">{opponent?.wins ?? 0}W · SCORE {opponent?.score ?? 0} · IN {opponent?.incoming ?? 0}</p></div>{opponent?.board.length === 20 && <canvas ref={(canvas) => { if (canvas) renderBoard(canvas.getContext('2d')!, opponent.board, null, null, { cellSize: OPPONENT_CELL, showGhost: false }) }} width={80} height={160} className="border border-neutral-800" />}</button>
        })}
        </div>
        {error && <p className="mt-4 text-xs text-red-400">{error}</p>}
        <button disabled={finished} onClick={() => { clearMatch(); onExit() }} className="mt-6 border border-neutral-700 px-3 py-2 text-xs text-neutral-400 disabled:opacity-40">LEAVE</button>
      </aside>
    </main>
  )
}
