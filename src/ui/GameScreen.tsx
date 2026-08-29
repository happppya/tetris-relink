import { useEffect, useRef, useState } from 'react'
import { GameRunner, type RunResult } from '../game/runner'
import { bindInput, drainFrame } from '../game/input'
import { useSettings, handlingFromSettings } from '../state/settings'
import { useStats } from '../state/stats'
import { renderBoard, drawMiniPiece } from '../render/canvas'
import { EffectsSystem } from '../render/effects'
import { ClearPopupRenderer, SendPopupRenderer, clearLabels } from '../render/cleartext'
import type { GameEvent } from '../engine/game'
import { formatTime, formatNum } from './format'
import { StreakBox } from './StreakBox'

const CELL = 30

interface Props {
  mode: 'sprint' | 'blitz'
  blitzDuration?: 60 | 180 | 300
  onExit: () => void
}

function HudRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between font-mono text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-200">{value}</span>
    </div>
  )
}

export function GameScreen({ mode, blitzDuration, onExit }: Props) {
  const settings = useSettings()
  const stats = useStats()
  const [retryKey, setRetryKey] = useState(0)
  const [paused, setPaused] = useState(false)
  const [result, setResult] = useState<{ run: RunResult; newRecord: boolean; prevBest: number | null } | null>(null)
  const [hud, setHud] = useState({ score: 0, lines: 0, level: 1, timeMs: 0, pps: 0, apm: 0, streak: 0 })
  const [blitzLeftMs, setBlitzLeftMs] = useState((blitzDuration ?? 0) * 1000)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const holdRef = useRef<HTMLCanvasElement>(null)
  const nextRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const holdCtx = holdRef.current!.getContext('2d')!
    const nextCtx = nextRef.current!.getContext('2d')!

    let pausedLocal = false
    let done = false
    const fx = new EffectsSystem(settings.fx)
    fx.setShakeEnabled(settings.shake)
    let frameHadHardDrop = false
    const popups = new ClearPopupRenderer()
    const sendPopups = new SendPopupRenderer()
    let lastHudUpdate = 0

    const runner = new GameRunner({
      mode,
      blitzDuration,
      gameOptions: {
        handling: handlingFromSettings(settings),
        attack: settings.attack,
        scoring: settings.scoring,
        startLevel: settings.startLevel,
      },
      onEvent: (events: GameEvent[]) => {
        const now = performance.now()
        for (const ev of events) {
          if (ev.type === 'clear') {
            if (settings.clearPopups) popups.push(clearLabels(ev.info), now)
            if (settings.fx.sendPopups) sendPopups.push(ev.attack, runner.game.combo, now, ev.rows, ev.pieceX, CELL)
            fx.lineClear(ev.rows, CELL, ev.info, ev.attack, runner.game.combo)
          }
          if (ev.type === 'lock' && frameHadHardDrop) {
            fx.hardDropImpact(ev.piece, CELL)
          }
        }
      },
      onEnd: (run) => {
        let newRecord = false
        let prevBest: number | null = null
        if (mode === 'sprint') {
          // topped-out runs are invalid: only a completed 40L counts as a record
          if (run.lines >= 40) {
            prevBest = useStats.getState().sprintBestMs
            newRecord = stats.recordSprint(run.timeMs)
          }
        } else if (mode === 'blitz' && blitzDuration) {
          prevBest = useStats.getState().blitzBestScore[blitzDuration]
          newRecord = stats.recordBlitz(blitzDuration, run.score)
        }
        stats.countGame()
        done = true
        setResult({ run, newRecord, prevBest })
      },
    })

    const input = bindInput(settings.keybinds)

    let raf = 0
    let last = performance.now()

    const loop = (t: number) => {
      const dt = t - last
      last = t

      const ctrl = drainFrame(input, runner)
      frameHadHardDrop = ctrl.hardDrop
      if (ctrl.retry) {
        input.detach()
        setRetryKey((k) => k + 1)
        return
      }
      if (ctrl.pause) {
        pausedLocal = !pausedLocal
        setPaused(pausedLocal)
        if (pausedLocal) runner.clearActions()
      }

      runner.advance(dt, { dir: input.dir, softDrop: input.softDrop })

      const g = runner.game
      renderBoard(ctx, g.board, g.active, g.ghostPiece, {
        cellSize: CELL,
        showGhost: settings.ghost,
      })

      fx.update(dt / 1000)
      fx.draw(ctx)
      fx.drawOverlay(ctx, canvas.width, canvas.height, t)

      if (settings.clearPopups) {
        popups.draw(ctx, canvas.width, canvas.height, t)
      }
      if (settings.fx.sendPopups) {
        sendPopups.draw(ctx, canvas.width, canvas.height, t)
      }

      fx.applyShake(canvas, t)

      holdCtx.clearRect(0, 0, holdCtx.canvas.width, holdCtx.canvas.height)
      drawMiniPiece(holdCtx, g.hold, holdCtx.canvas.width / 2, 24, 12)
      nextCtx.clearRect(0, 0, nextCtx.canvas.width, nextCtx.canvas.height)
      g.nextQueue.forEach((type, i) => {
        drawMiniPiece(nextCtx, type, nextCtx.canvas.width / 2, 24 + i * 44, i === 0 ? 12 : 10)
      })

      if (t - lastHudUpdate > 100 || done) {
        lastHudUpdate = t
        setHud({
          score: g.score,
          lines: g.lines,
          level: g.level,
          timeMs: runner.elapsedMs,
          pps: g.pps,
          apm: g.apm,
          streak: g.streak,
        })
        if (mode === 'blitz' && blitzDuration && !runner.ended) {
          setBlitzLeftMs(Math.max(0, blitzDuration * 1000 - runner.elapsedMs))
        }
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      input.detach()
      runner.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey])

  const overlayVisible = paused || result !== null

  return (
    <main className="flex min-h-screen items-center justify-center gap-8">
      <aside className="flex w-40 flex-col gap-4">
        <div>
          <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">HOLD</h2>
          <canvas ref={holdRef} width={120} height={48} className="border border-neutral-800" />
        </div>
        <div>
          <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">
            {mode === 'sprint' ? 'SPRINT 40L' : `BLITZ ${formatTime(blitzLeftMs)}`}
          </h2>
          <div className="font-mono text-sm">
            <HudRow label="SCORE" value={hud.score.toLocaleString()} />
            <HudRow label="LINES" value={String(hud.lines)} />
            <HudRow label="LEVEL" value={String(hud.level)} />
            <HudRow label="TIME" value={formatTime(hud.timeMs)} />
            <HudRow label="PPS" value={formatNum(hud.pps)} />
            <HudRow label="APM" value={formatNum(hud.apm)} />
          </div>
          <StreakBox value={hud.streak} />
        </div>
      </aside>

      <div ref={wrapRef} className="flex items-start">
        <canvas ref={canvasRef} width={300} height={600} className="border border-neutral-700" />
        <div className="ml-2">
          <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">NEXT</h2>
          <canvas ref={nextRef} width={120} height={230} className="border border-neutral-800" />
        </div>
      </div>

      {overlayVisible && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 font-mono">
          {result ? (
            <div className="w-80 border border-neutral-600 bg-black p-6">
              <h2 className="mb-4 text-center text-lg tracking-widest text-neutral-100">
                {result.run.mode === 'sprint' ? (result.run.lines >= 40 ? 'FINISHED' : 'GAME OVER') : "TIME'S UP"}
              </h2>
              {result.newRecord && (
                <p className="mb-2 text-center text-sm text-neutral-300">NEW RECORD</p>
              )}
              <div className="mb-4">
                {result.run.mode === 'sprint' && <HudRow label="TIME" value={formatTime(result.run.timeMs)} />}
                <HudRow label="SCORE" value={result.run.score.toLocaleString()} />
                <HudRow label="LINES" value={String(result.run.lines)} />
                <HudRow label="PPS" value={formatNum(result.run.pps)} />
                <HudRow label="APM" value={formatNum(result.run.apm)} />
                {mode === 'sprint' && result.run.lines >= 40 && (
                  <HudRow
                    label="BEST TIME"
                    value={formatTime(
                      result.newRecord ? result.run.timeMs : (result.prevBest ?? result.run.timeMs),
                    )}
                  />
                )}
                {mode === 'blitz' && (
                  <HudRow
                    label="BEST SCORE"
                    value={(result.newRecord ? result.run.score : (result.prevBest ?? 0)).toLocaleString()}
                  />
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setResult(null)
                    setPaused(false)
                    setRetryKey((k) => k + 1)
                  }}
                  className="flex-1 border border-neutral-500 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
                >
                  RETRY
                </button>
                <button onClick={onExit} className="flex-1 border border-neutral-700 py-2 text-sm text-neutral-400 hover:bg-neutral-900">
                  MENU
                </button>
              </div>
            </div>
          ) : (
            <div className="w-64 border border-neutral-600 bg-black p-6 text-center">
              <h2 className="mb-4 text-lg tracking-widest text-neutral-100">PAUSED</h2>
              <p className="mb-4 text-xs text-neutral-500">{settings.keybinds.pause} to resume</p>
              <button onClick={onExit} className="w-full border border-neutral-700 py-2 text-sm text-neutral-400 hover:bg-neutral-900">
                QUIT TO MENU
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  )
}
