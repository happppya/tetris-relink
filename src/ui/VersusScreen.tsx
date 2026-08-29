import { useEffect, useRef, useState } from 'react'
import { GameRunner, STEP_MS, type RunResult } from '../game/runner'
import { bindInput, drainFrame } from '../game/input'
import { BotDriver } from '../ai/botdriver'
import { Game } from '../engine/game'
import { useSettings, handlingFromSettings } from '../state/settings'
import { useStats } from '../state/stats'
import { renderBoard, drawMiniPiece } from '../render/canvas'
import { EffectsSystem } from '../render/effects'
import { ClearPopupRenderer, clearLabels } from '../render/cleartext'
import type { GameEvent } from '../engine/game'
import { formatTime, formatNum } from './format'
import { StreakBox } from './StreakBox'
import { GarbageMeter } from './GarbageMeter'
import { getBotProfile } from '../ai/profiles'
import { TOTAL_H } from '../engine/types'

const CELL = 30
const AI_CELL_SMALL = 16
const NEXT_W = 120
const NEXT_H = 230

function HudRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between font-mono text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-200">{value}</span>
    </div>
  )
}

function NextColumn({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  return (
    <div className="ml-2">
      <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">NEXT</h2>
      <canvas ref={canvasRef} width={NEXT_W} height={NEXT_H} className="border border-neutral-800" />
    </div>
  )
}

interface SideHud {
  score: number
  lines: number
  pps: number
  apm: number
  sent: number
  incoming: number
  streak: number
}

function stackHeight(board: (string | null)[][]): number {
  for (let y = 0; y < TOTAL_H; y++) {
    if (board[y].some((c) => c !== null)) return TOTAL_H - y
  }
  return 0
}

export function VersusScreen({ onExit }: { onExit: () => void }) {
  const settings = useSettings()
  const stats = useStats()
  const [retryKey, setRetryKey] = useState(0)
  const [paused, setPaused] = useState(false)
  const [outcome, setOutcome] = useState<{ result: 'win' | 'lose'; run: RunResult } | null>(null)
  const [timeMs, setTimeMs] = useState(0)
  const [playerHud, setPlayerHud] = useState<SideHud>({
    score: 0,
    lines: 0,
    pps: 0,
    apm: 0,
    sent: 0,
    incoming: 0,
    streak: 0,
  })
  const [aiHud, setAiHud] = useState<SideHud & { height: number }>({
    score: 0,
    lines: 0,
    pps: 0,
    apm: 0,
    sent: 0,
    incoming: 0,
    streak: 0,
    height: 0,
  })

  const playerCanvasRef = useRef<HTMLCanvasElement>(null)
  const playerHoldRef = useRef<HTMLCanvasElement>(null)
  const playerNextRef = useRef<HTMLCanvasElement>(null)
  const aiCanvasRef = useRef<HTMLCanvasElement>(null)
  const aiHoldRef = useRef<HTMLCanvasElement>(null)
  const aiNextRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const pCtx = playerCanvasRef.current!.getContext('2d')!
    const aCtx = aiCanvasRef.current!.getContext('2d')!
    const pHoldCtx = playerHoldRef.current!.getContext('2d')!
    const pNextCtx = playerNextRef.current!.getContext('2d')!
    const aHoldCtx = aiHoldRef.current!.getContext('2d')!
    const aNextCtx = aiNextRef.current!.getContext('2d')!

    const aiCell = settings.opponentBoardSize === 'full' ? CELL : AI_CELL_SMALL

    let pausedLocal = false
    let finished = false
    let lastHudUpdate = 0
    let adaptTimer = 0
    let aiAcc = 0
    let basePps = settings.ai.pps
    let livePps = settings.ai.pps
    const fx = new EffectsSystem(settings.effectsLevel)
    fx.setShakeEnabled(settings.shake)
    let frameHadHardDrop = false
    const popups = new ClearPopupRenderer()

    const playerRunner = new GameRunner({
      mode: 'versus',
      gameOptions: {
        sendsGarbage: true,
        attack: settings.attack,
        handling: handlingFromSettings(settings),
      },
      onEvent: (events: GameEvent[]) => {
        const now = performance.now()
        for (const ev of events) {
          if (ev.type === 'attack' && !aiGame.over) {
            aiGame.receiveGarbage(ev.lines)
          }
          if (ev.type === 'clear') {
            if (settings.clearPopups) popups.push(clearLabels(ev.info), now)
            fx.lineClear(ev.rows, CELL, ev.info, player.combo)
          }
          if (ev.type === 'lock' && frameHadHardDrop) {
            fx.hardDropImpact(ev.piece, CELL)
          }
        }
      },
      onEnd: () => {},
    })
    const player = playerRunner.game

    const aiGame = new Game({
      sendsGarbage: true,
      attack: settings.attack,
      // snappier handling than the player defaults so the bot can hit its PPS
      // target; arr must stay > 0 because 0 slides all the way to the wall
      handling: { dasFrames: 1, arrFrames: 1, sddFrames: 0 },
    })
    const bot = new BotDriver(aiGame, {
      pps: livePps,
      profile: settings.botProfile,
      handling: { dasFrames: 1, arrFrames: 1, sddFrames: 0 },
    })
    bot.tick()

    const handleAiEvents = (events: GameEvent[]) => {
      for (const ev of events) {
        if (ev.type === 'attack' && !player.over) {
          player.receiveGarbage(ev.lines)
        }
      }
    }

    const input = bindInput(settings.keybinds)

    let raf = 0
    let last = performance.now()

    const loop = (t: number) => {
      const dt = t - last
      last = t

      const ctrl = drainFrame(input, playerRunner)
      frameHadHardDrop = ctrl.hardDrop
      if (ctrl.retry) {
        input.detach()
        setRetryKey((k) => k + 1)
        return
      }
      if (ctrl.pause) {
        pausedLocal = !pausedLocal
        setPaused(pausedLocal)
        if (pausedLocal) playerRunner.clearActions()
      }

      if (!pausedLocal && !finished) {
        playerRunner.advance(dt, { dir: input.dir, softDrop: input.softDrop })

        aiAcc = Math.min(aiAcc + dt, 200)
        while (aiAcc >= STEP_MS && !finished) {
          aiAcc -= STEP_MS
          const events = aiGame.tick(bot.tick())
          if (events.length) handleAiEvents(events)

          adaptTimer++
          if (settings.ai.mode === 'adaptive' && adaptTimer % 60 === 0) {
            const ph = stackHeight(player.board)
            const ah = stackHeight(aiGame.board)
            if (ph < ah - 2) livePps = Math.min(livePps * 1.12, basePps * 2)
            else if (ph > ah + 2) livePps = Math.max(livePps * 0.88, basePps * 0.5)
            bot.setPps(livePps)
          }

          if (playerRunner.ended || player.over || aiGame.over) {
            finished = true
            const win = aiGame.over && !player.over ? true : false
            if (!player.over && aiGame.over) {
              playerRunner.abort()
            } else {
              playerRunner.finish()
            }
            stats.countGame()
            setOutcome({
              result: win ? 'win' : 'lose',
              run: {
                mode: 'versus',
                timeMs: Math.round(playerRunner.elapsedMs),
                score: player.score,
                lines: player.lines,
                pps: player.pps,
                apm: player.apm,
              },
            })
          }
        }
      }

      const g = player
      renderBoard(pCtx, g.board, g.active, g.ghostPiece, { cellSize: CELL, showGhost: settings.ghost })
      renderBoard(aCtx, aiGame.board, aiGame.active, null, { cellSize: aiCell, showGhost: false })

      fx.update(dt / 1000)
      fx.draw(pCtx)
      fx.drawOverlay(pCtx, pCtx.canvas.width, pCtx.canvas.height, t)

      if (settings.clearPopups) {
        popups.draw(pCtx, pCtx.canvas.width, pCtx.canvas.height, t)
      }

      fx.applyShake(playerCanvasRef.current!, t)

      pHoldCtx.clearRect(0, 0, pHoldCtx.canvas.width, pHoldCtx.canvas.height)
      drawMiniPiece(pHoldCtx, g.hold, pHoldCtx.canvas.width / 2, 24, 12)
      pNextCtx.clearRect(0, 0, pNextCtx.canvas.width, pNextCtx.canvas.height)
      g.nextQueue.forEach((type, i) => {
        drawMiniPiece(pNextCtx, type, pNextCtx.canvas.width / 2, 24 + i * 44, i === 0 ? 12 : 10)
      })
      aHoldCtx.clearRect(0, 0, aHoldCtx.canvas.width, aHoldCtx.canvas.height)
      drawMiniPiece(aHoldCtx, aiGame.hold, aHoldCtx.canvas.width / 2, 24, 12)
      aNextCtx.clearRect(0, 0, aNextCtx.canvas.width, aNextCtx.canvas.height)
      aiGame.nextQueue.forEach((type, i) => {
        drawMiniPiece(aNextCtx, type, aNextCtx.canvas.width / 2, 24 + i * 44, i === 0 ? 12 : 10)
      })

      if (t - lastHudUpdate > 100) {
        lastHudUpdate = t
        setTimeMs(playerRunner.elapsedMs)
        setPlayerHud({
          score: g.score,
          lines: g.lines,
          pps: g.pps,
          apm: g.apm,
          sent: g.sentLines,
          incoming: g.pendingGarbage,
          streak: g.streak,
        })
        setAiHud({
          score: aiGame.score,
          lines: aiGame.lines,
          pps: aiGame.pps,
          apm: aiGame.apm,
          sent: aiGame.sentLines,
          incoming: aiGame.pendingGarbage,
          streak: aiGame.streak,
          height: stackHeight(aiGame.board),
        })
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      input.detach()
      playerRunner.abort()
      bot.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey])

  return (
    <main className="flex min-h-screen items-center justify-center gap-6">
      <aside className="flex w-40 flex-col gap-4">
        <div>
          <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">HOLD</h2>
          <canvas ref={playerHoldRef} width={120} height={48} className="border border-neutral-800" />
        </div>
        <div className="font-mono text-sm">
          <HudRow label="SCORE" value={playerHud.score.toLocaleString()} />
          <HudRow label="LINES" value={String(playerHud.lines)} />
          <HudRow label="TIME" value={formatTime(timeMs)} />
          <HudRow label="PPS" value={formatNum(playerHud.pps)} />
          <HudRow label="APM" value={formatNum(playerHud.apm)} />
          <HudRow label="SENT" value={String(playerHud.sent)} />
          <HudRow label="INCOMING" value={String(playerHud.incoming)} />
        </div>
        <StreakBox value={playerHud.streak} />
      </aside>

      {/* next queue sits flush against the top right of the player's board */}
      <div className="flex items-start">
        <div className="flex">
          <canvas ref={playerCanvasRef} width={300} height={600} className="border border-neutral-700" />
          <div className="ml-1">
            <GarbageMeter amount={playerHud.incoming} />
          </div>
        </div>
        <NextColumn canvasRef={playerNextRef} />
      </div>

      <div className="flex items-start gap-6">
        <aside className="flex w-40 flex-col gap-4">
          <h2 className="font-mono text-xs tracking-widest text-neutral-500">OPPONENT</h2>
          <div>
            <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">HOLD</h2>
            <canvas ref={aiHoldRef} width={120} height={48} className="border border-neutral-800" />
          </div>
          <div className="font-mono text-sm">
            <HudRow label="SCORE" value={aiHud.score.toLocaleString()} />
            <HudRow label="LINES" value={String(aiHud.lines)} />
            <HudRow label="TIME" value={formatTime(timeMs)} />
            <HudRow label="PPS" value={formatNum(aiHud.pps)} />
            <HudRow label="APM" value={formatNum(aiHud.apm)} />
            <HudRow label="SENT" value={String(aiHud.sent)} />
            <HudRow label="INCOMING" value={String(aiHud.incoming)} />
          </div>
          <StreakBox value={aiHud.streak} />
          <p className="font-mono text-xs text-neutral-600">
            {getBotProfile(settings.botProfile).label.toLowerCase()} · {settings.ai.mode === 'adaptive' ? 'adaptive' : 'fixed'} ·{' '}
            {aiHud.height}h
          </p>
        </aside>

        <div className="flex items-start pt-5">
          <canvas
            ref={aiCanvasRef}
            width={10 * (settings.opponentBoardSize === 'full' ? CELL : AI_CELL_SMALL)}
            height={20 * (settings.opponentBoardSize === 'full' ? CELL : AI_CELL_SMALL)}
            className="border border-neutral-800"
          />
          <div className="ml-1">
            <GarbageMeter
              amount={aiHud.incoming}
              height={20 * (settings.opponentBoardSize === 'full' ? CELL : AI_CELL_SMALL)}
            />
          </div>
        </div>

        <div className="ml-2 pt-5">
          <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">NEXT</h2>
          <canvas ref={aiNextRef} width={NEXT_W} height={NEXT_H} className="border border-neutral-800" />
        </div>
      </div>

      {(paused || outcome) && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 font-mono">
          {outcome ? (
            <div className="w-80 border border-neutral-600 bg-black p-6">
              <h2 className="mb-4 text-center text-lg tracking-widest text-neutral-100">
                {outcome.result === 'win' ? 'VICTORY' : 'DEFEAT'}
              </h2>
              <div className="mb-4">
                <HudRow label="SCORE" value={outcome.run.score.toLocaleString()} />
                <HudRow label="LINES" value={outcome.run.lines.toLocaleString()} />
                <HudRow label="TIME" value={formatTime(outcome.run.timeMs)} />
                <HudRow label="APM" value={formatNum(outcome.run.apm)} />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setOutcome(null)
                    setRetryKey((k) => k + 1)
                  }}
                  className="flex-1 border border-neutral-500 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
                >
                  REMATCH
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
