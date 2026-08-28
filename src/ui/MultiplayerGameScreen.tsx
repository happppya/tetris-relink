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

export function MultiplayerGameScreen({ onExit }: { onExit: () => void }) {
  const settings = useSettings()
  const match = useLobby((s) => s.match)
  const clearMatch = useLobby((s) => s.clearMatch)
  const [hud, setHud] = useState({ score: 0, lines: 0, incoming: 0, latency: 0 })
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nextRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!match) return
    const ctx = canvasRef.current!.getContext('2d')!
    const nextCtx = nextRef.current!.getContext('2d')!
    let snapshotSeq = 0
    let lastSnapshot = 0
    let lastLockPieces = 0
    let stopped = false
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
      if (!paused) {
        runner.advance(dt, { dir: input.dir, softDrop: input.softDrop, actions })
        const g = runner.game
        if (g.frames - lastSnapshot >= 30) {
          lastSnapshot = g.frames
          snapshotSeq++
          net.send({ type: 'snapshot', board: serializeBoard(g.board.slice(-20)), score: g.score, seq: snapshotSeq })
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
    }
  }, [match, settings, clearMatch])

  if (!match) return null
  return (
    <main className="flex min-h-screen items-center justify-center gap-6 font-mono">
      <aside className="w-40">
        <h2 className="mb-2 text-xs tracking-widest text-neutral-500">MATCH</h2>
        <p className="mb-4 text-xs text-neutral-400">{match.settings.mode === 'firstToX' ? `FIRST TO ${match.settings.goal}` : `WIN BY ${match.settings.winBy}`}</p>
        <p className="text-xs text-neutral-500">{hud.latency}ms</p>
        <p className="text-sm text-neutral-200">SCORE {hud.score}</p>
        <p className="text-sm text-neutral-200">LINES {hud.lines}</p>
        <GarbageMeter amount={hud.incoming} />
      </aside>
      <div className="flex items-start gap-2">
        <canvas ref={canvasRef} width={300} height={600} className="border border-neutral-700" />
        <div><h2 className="mb-1 text-xs tracking-widest text-neutral-500">NEXT</h2><canvas ref={nextRef} width={120} height={230} className="border border-neutral-800" /></div>
      </div>
      <aside className="w-48">
        <h2 className="mb-2 text-xs tracking-widest text-neutral-500">OPPONENTS</h2>
        {match.players.filter((p) => p.id !== useLobby.getState().selfId).map((p) => <p key={p.id} className="text-sm text-neutral-300">{p.name}</p>)}
        {error && <p className="mt-4 text-xs text-red-400">{error}</p>}
        <button onClick={() => { clearMatch(); onExit() }} className="mt-6 border border-neutral-700 px-3 py-2 text-xs text-neutral-400">LEAVE</button>
      </aside>
    </main>
  )
}
