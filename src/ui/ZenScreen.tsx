import { useEffect, useRef, useState } from 'react'
import { GameRunner } from '../game/runner'
import { InputManager } from '../game/input'
import { Game, type GameEvent, type GameSnapshot } from '../engine/game'
import { useSettings, msToFrames } from '../state/settings'
import { useZen, zenLevelInfo, type GarbageMode, type GarbageMultiplier } from '../state/zen'
import { renderBoard, drawMiniPiece, PIECE_COLORS } from '../render/canvas'
import { EffectsSystem } from '../render/effects'
import { ClearPopupRenderer, clearLabels } from '../render/cleartext'
import { cellsFor } from '../engine/pieces'
import { HIDDEN_H, type Cell, type InputAction } from '../engine/types'
import { HintProvider } from '../ai/assistant'
import { applyPlacementToBoard, boardsEqual, placementCells } from '../ai/board'
import type { BotHintPlacement } from '../ai/protocol'
import { formatTime, formatNum } from './format'
import { GarbageMeter } from './GarbageMeter'
import { StreakBox } from './StreakBox'
import { BOT_PROFILES } from '../ai/profiles'

const CELL = 30
const CHEESE_ROWS = 6

function HudRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between font-mono text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-200">{value}</span>
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`border px-2 py-1 font-mono text-xs ${
        active ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500 hover:border-neutral-400'
      }`}
    >
      {children}
    </button>
  )
}

const GARBAGE_MODES: { id: GarbageMode; label: string; hint: string }[] = [
  { id: 'none', label: 'NONE', hint: 'no garbage' },
  { id: 'backfire', label: 'BACKFIRE', hint: 'attacks return after next placement (ignores cancelling)' },
  { id: 'unclear', label: 'UNCLEAR', hint: 'attacks return instantly' },
  { id: 'cheese', label: 'CHEESE LAYER', hint: 'bottom rows stay filled with garbage' },
]

export function ZenScreen({ onExit }: { onExit: () => void }) {
  const settings = useSettings()
  const zenSettings = useZen((s) => s.settings)
  const updateZen = useZen((s) => s.updateSettings)
  const levelInfo = zenLevelInfo(useZen((s) => s.xp))

  const [retryKey, setRetryKey] = useState(0)
  const [paused, setPaused] = useState(false)
  const [over, setOver] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [assistActive, setAssistActive] = useState(false)
  const [hud, setHud] = useState({ score: 0, lines: 0, timeMs: 0, pps: 0, apm: 0, incoming: 0, streak: 0 })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const holdRef = useRef<HTMLCanvasElement>(null)
  const nextRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const undoStack = useRef<GameSnapshot[]>([])
  const redoStack = useRef<GameSnapshot[]>([])
  const assistActiveRef = useRef(false)
  const zenRef = useRef(zenSettings)
  useEffect(() => {
    zenRef.current = zenSettings
    if (!zenSettings.practice) {
      undoStack.current.length = 0
      redoStack.current.length = 0
    }
  }, [zenSettings])

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const holdCtx = holdRef.current!.getContext('2d')!
    const nextCtx = nextRef.current!.getContext('2d')!

    let pausedLocal = false
    let done = false
    let lastHudUpdate = 0
    let contributed = 0
    const fx = new EffectsSystem(settings.effectsLevel)
    fx.setShakeEnabled(settings.shake)
    let frameHadHardDrop = false
    const popups = new ClearPopupRenderer()
    const hintProvider = new HintProvider()
    let hintPlacements: BotHintPlacement[] = []
    /** hintBoards[i] = board that hintPlacements[i] was planned against */
    let hintBoards: Cell[][] = []
    /** first hint assumes the current piece is swapped into hold */
    let hintUsesHold = false
    let hintsDirty = true
    let lastHintRequest = 0
    /** seq of the latest issued request; replies for older ones are ignored */
    let hintReqSeq = 0
    /** true while the latest request has not been answered yet */
    let hintAwaiting = false
    let adviceProfile = ''
    let adviceCount = 0

    const runner = new GameRunner({
      mode: 'zen',
      gameOptions: {
        startLevel: zenSettings.gravityLevel,
        attack: settings.attack,
        scoring: settings.scoring,
        cheeseRows: zenSettings.garbage === 'cheese' ? CHEESE_ROWS : 0,
        handling: {
          dasFrames: Math.max(1, msToFrames(settings.dasMs)),
          arrFrames: msToFrames(settings.arrMs),
          sddFrames: msToFrames(settings.sddMs),
        },
      },
      onEvent: (events: GameEvent[]) => {
        const now = performance.now()
        for (const ev of events) {
          if (ev.type === 'clear') {
            if (settings.clearPopups) popups.push(clearLabels(ev.info), now)
            fx.lineClear(ev.rows, CELL, ev.info, runner.game.combo)
            if (zenRef.current.garbage === 'backfire') {
              runner.game.receiveGarbage(Math.round(ev.attack.totalLines * zenRef.current.multiplier), true)
            } else if (zenRef.current.garbage === 'unclear') {
              runner.game.receiveGarbageNow(Math.round(ev.attack.totalLines * zenRef.current.multiplier))
            }
          }
          if (ev.type === 'lock' && !done) {
            if (frameHadHardDrop) fx.hardDropImpact(ev.piece, CELL)
            undoStack.current.push(runner.game.snapshot())
            redoStack.current.length = 0
            // keep the promised chain when the player followed the advice;
            // only re-query when the board diverged from the predicted line
            if (
              hintBoards.length > 1 &&
              hintPlacements.length > 0 &&
              boardsEqual(runner.game.board, hintBoards[1])
            ) {
              hintPlacements = hintPlacements.slice(1)
              hintBoards = hintBoards.slice(1)
              if (hintPlacements.length === 0) hintUsesHold = false
              // keep the pipeline full: top up as soon as a hint is consumed
              if (hintPlacements.length < Math.max(1, zenRef.current.hintCount)) {
                hintsDirty = true
              }
            } else {
              hintsDirty = true
              hintPlacements = []
              hintBoards = []
              hintUsesHold = false
            }
          }
          if (ev.type === 'hold') {
            if (hintUsesHold && hintPlacements.length > 0) {
              // the player executed the advised swap: the held piece is now
              // falling, exactly what hints[0] planned for — drop it and keep
              // the promised chain, like following a placement
              hintPlacements = hintPlacements.slice(1)
              hintBoards = hintBoards.slice(1)
              hintUsesHold = false
              if (hintPlacements.length < Math.max(1, zenRef.current.hintCount)) {
                hintsDirty = true
              }
            } else {
              // unprompted swap: the old plan no longer applies
              hintsDirty = true
              hintPlacements = []
              hintBoards = []
            }
          }
          if (ev.type === 'garbage') {
            hintsDirty = true
            hintPlacements = []
            hintBoards = []
            hintUsesHold = false
          }
          if (ev.type === 'gameover') {
            done = true
            setOver(true)
          }
        }
      },
      onEnd: () => {},
    })
    gameRef.current = runner.game

    const clearHints = () => {
      hintsDirty = true
      hintPlacements = []
      hintBoards = []
      hintUsesHold = false
    }

    const requestHints = () => {
      const g = runner.game
      if (!g.active || g.over) return
      lastHintRequest = performance.now()
      const seq = ++hintReqSeq
      hintAwaiting = true
      const requestBoard = g.board.map((row) => [...row])
      hintProvider
        .request({
          board: requestBoard,
          current: g.active.type,
          next: g.nextQueue,
          hold: g.holdBlocked ? null : g.hold,
          b2b: g.b2bActive,
          combo: g.combo,
          profile: zenRef.current.assistProfile,
          count: Math.max(1, zenRef.current.hintCount),
        })
        .then((r) => {
          if (r.seq !== seq) return // superseded; its replacement owns the state
          hintAwaiting = false
          if (!assistActiveRef.current) return
          hintPlacements = r.placements
          hintUsesHold = !!r.hold && r.placements.length > 0
          // each hint applies to the board its predecessor produced (line
          // clears included), not to the live board — render against those
          const boards: Cell[][] = []
          let b = requestBoard
          for (const h of r.placements) {
            boards.push(b)
            const nb = applyPlacementToBoard(b, h)
            if (!nb) break
            b = nb
          }
          hintBoards = boards
        })
    }

    const undo = () => {
      if (!zenRef.current.practice || pausedLocal || done || undoStack.current.length === 0) return
      redoStack.current.push(runner.game.snapshot())
      runner.game.restore(undoStack.current.pop()!)
      clearHints()
    }
    const redo = () => {
      if (!zenRef.current.practice || pausedLocal || done || redoStack.current.length === 0) return
      undoStack.current.push(runner.game.snapshot())
      runner.game.restore(redoStack.current.pop()!)
      clearHints()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      if (e.code === 'KeyZ') {
        e.preventDefault()
        undo()
      } else if (e.code === 'KeyY') {
        e.preventDefault()
        redo()
      }
    }

    const codeMap: Partial<Record<string, InputAction>> = {}
    for (const [action, code] of Object.entries(settings.keybinds)) {
      if (code) codeMap[code] = action as InputAction
    }
    const input = new InputManager(() => codeMap)
    input.attach()
    window.addEventListener('keydown', onKeyDown)

    let raf = 0
    let last = performance.now()

    const loop = (t: number) => {
      const dt = t - last
      last = t

      const actions = input.drainActions()
      frameHadHardDrop = actions.includes('hardDrop')
      if (actions.includes('retry')) {
        input.detach()
        window.removeEventListener('keydown', onKeyDown)
        setRetryKey((k) => k + 1)
        return
      }
      if (actions.includes('pause')) {
        pausedLocal = !pausedLocal
        setPaused(pausedLocal)
      }
      if (actions.includes('assist')) {
        const next = !assistActiveRef.current
        assistActiveRef.current = next
        setAssistActive(next)
        hintsDirty = true
        if (!next) hintPlacements = []
      }

      runner.advance(dt, { dir: input.dir, softDrop: input.softDrop, actions })

      const g = runner.game
      renderBoard(ctx, g.board, g.active, g.ghostPiece, {
        cellSize: CELL,
        showGhost: settings.ghost,
      })

      fx.update(dt / 1000)
      fx.draw(ctx)
      fx.drawOverlay(ctx, canvas.width, canvas.height, t)
      if (settings.clearPopups) popups.draw(ctx, canvas.width, canvas.height, t)

      if (assistActiveRef.current && zenRef.current.assist && !pausedLocal && !done) {
        const g = runner.game
        const staleChain =
          hintPlacements.length === 0 || hintPlacements[0].type !== g.active.type
        const throttled = performance.now() - lastHintRequest <= 250
        if (
          hintsDirty ||
          adviceProfile !== zenRef.current.assistProfile ||
          adviceCount !== zenRef.current.hintCount
        ) {
          hintsDirty = false
          adviceProfile = zenRef.current.assistProfile
          adviceCount = zenRef.current.hintCount
          requestHints()
        } else if (
          staleChain &&
          !hintAwaiting &&
          !throttled
        ) {
          // self-heal dropped replies instead of idling forever; gated on the
          // latest request having been answered so slow searches (tall stacks)
          // are never superseded in a loop
          requestHints()
        }
        hintPlacements.forEach((h, i) => {
          const base = hintBoards[i] ?? g.board
          let abs = placementCells(base, h)
          if (!abs) {
            const cells = cellsFor(h.type, h.rot)
            let py = -4
            outer: for (;;) {
              for (const c of cells) {
                const y = py + c.y + 1
                if (y >= 24 || (y >= 0 && base[y][h.x + c.x] !== null)) break outer
              }
              py++
            }
            abs = cells.map((c) => ({ x: h.x + c.x, y: py + c.y }))
          }
          ctx.save()
          ctx.globalAlpha = Math.max(0.2, 0.65 - i * 0.15)
          ctx.strokeStyle = PIECE_COLORS[h.type]
          ctx.lineWidth = 2
          for (const c of abs) {
            const ay = c.y - HIDDEN_H
            if (ay >= 0) ctx.strokeRect(c.x * CELL + 2, ay * CELL + 2, CELL - 4, CELL - 4)
          }
          ctx.restore()
        })
        if (hintUsesHold) {
          ctx.save()
          ctx.font = 'bold 14px ui-monospace, monospace'
          ctx.fillStyle = '#e5e5e5'
          ctx.globalAlpha = 0.9
          ctx.fillText('SWAP → HOLD', 8, 18)
          ctx.restore()
        }
      }
      fx.applyShake(canvas, t)

      holdCtx.clearRect(0, 0, holdCtx.canvas.width, holdCtx.canvas.height)
      drawMiniPiece(holdCtx, g.hold, holdCtx.canvas.width / 2, 24, 12)
      nextCtx.clearRect(0, 0, nextCtx.canvas.width, nextCtx.canvas.height)
      g.nextQueue.forEach((type, i) => {
        drawMiniPiece(nextCtx, type, nextCtx.canvas.width / 2, 24 + i * 44, i === 0 ? 12 : 10)
      })

      if (t - lastHudUpdate > 100) {
        lastHudUpdate = t
        setHud({
          score: g.score,
          lines: g.lines,
          timeMs: runner.elapsedMs,
          pps: g.pps,
          apm: g.apm,
          incoming: g.pendingGarbage,
          streak: g.streak,
        })
      }

      if (g.score > contributed) {
        useZen.getState().addXp(g.score - contributed)
        contributed = g.score
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      input.detach()
      window.removeEventListener('keydown', onKeyDown)
      runner.abort()
      hintProvider.destroy()
      gameRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey])

  const onGravity = (v: number) => {
    updateZen({ gravityLevel: v })
    if (gameRef.current) gameRef.current.level = v
  }

  useEffect(() => {
    gameRef.current?.setCheese(zenSettings.garbage === 'cheese' ? CHEESE_ROWS : 0)
  }, [zenSettings.garbage])

  return (
    <main className="flex min-h-screen items-center justify-center gap-8">
      <aside className="flex w-40 flex-col gap-4">
        <div>
          <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">HOLD</h2>
          <canvas ref={holdRef} width={120} height={48} className="border border-neutral-800" />
        </div>
        <div className="font-mono text-sm">
          <HudRow label="SCORE" value={hud.score.toLocaleString()} />
          <HudRow label="LINES" value={String(hud.lines)} />
          <HudRow label="TIME" value={formatTime(hud.timeMs)} />
          <HudRow label="PPS" value={formatNum(hud.pps)} />
          <HudRow label="APM" value={formatNum(hud.apm)} />
        </div>
        <StreakBox value={hud.streak} />
        <button
          onClick={() => setSidebarOpen(true)}
          className="border border-neutral-700 px-3 py-1 font-mono text-xs text-neutral-400 hover:border-neutral-400 hover:text-neutral-200"
        >
          ZEN SETUP
        </button>
        {zenSettings.assist && (
          <button
            onClick={() => {
              const next = !assistActive
              assistActiveRef.current = next
              setAssistActive(next)
            }}
            className={`border px-3 py-1 font-mono text-xs ${
              assistActive ? 'border-neutral-100 text-neutral-100' : 'border-neutral-700 text-neutral-500 hover:border-neutral-400'
            }`}
          >
            ASSIST [{settings.keybinds.assist ?? 'G'}] {assistActive ? 'ON' : 'OFF'}
          </button>
        )}
      </aside>

      <div className="flex flex-col items-center gap-2">
        <div className="flex items-start">
          <canvas ref={canvasRef} width={300} height={600} className="border border-neutral-700" />
          {zenSettings.garbage !== 'none' && (
            <div className="ml-1">
              <GarbageMeter amount={hud.incoming} />
            </div>
          )}
          <div className="ml-2">
            <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">NEXT</h2>
            <canvas ref={nextRef} width={120} height={230} className="border border-neutral-800" />
          </div>
        </div>
        <div className="w-full font-mono text-xs text-neutral-500">
          <span className="float-left">LV {levelInfo.level}</span>
          <span className="float-right">
            {levelInfo.into}/{levelInfo.req} XP
          </span>
        </div>
      </div>

      {sidebarOpen && (
        <aside className="fixed right-0 top-0 z-10 h-full w-72 overflow-y-auto border-l border-neutral-700 bg-black p-6 font-mono">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs tracking-widest text-neutral-500">ZEN SETUP</h2>
            <button onClick={() => setSidebarOpen(false)} className="text-xs text-neutral-500 hover:text-neutral-200">
              CLOSE
            </button>
          </div>

          <section className="mb-6">
            <h3 className="mb-2 border-b border-neutral-800 pb-1 text-[10px] tracking-widest text-neutral-600">GRAVITY</h3>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={19}
                value={zenSettings.gravityLevel}
                onChange={(e) => onGravity(Number(e.target.value))}
                className="w-32 accent-neutral-300"
              />
              <span className="w-8 text-right text-xs text-neutral-200">{zenSettings.gravityLevel}</span>
            </div>
          </section>

          <section className="mb-6">
            <h3 className="mb-2 border-b border-neutral-800 pb-1 text-[10px] tracking-widest text-neutral-600">PRACTICE MODE</h3>
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-500">{zenSettings.practice ? 'CTRL+Z / CTRL+Y' : 'undo/redo off'}</span>
              <button
                onClick={() => updateZen({ practice: !zenSettings.practice })}
                className={`w-16 border px-2 py-0.5 text-xs ${
                  zenSettings.practice ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500'
                }`}
              >
                {zenSettings.practice ? 'ON' : 'OFF'}
              </button>
            </div>
          </section>

          <section className="mb-6">
            <h3 className="mb-2 border-b border-neutral-800 pb-1 text-[10px] tracking-widest text-neutral-600">ASSIST MODE</h3>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-neutral-500">bot hints overlay</span>
              <button
                onClick={() => updateZen({ assist: !zenSettings.assist })}
                className={`w-16 border px-2 py-0.5 text-xs ${
                  zenSettings.assist ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500'
                }`}
              >
                {zenSettings.assist ? 'ON' : 'OFF'}
              </button>
            </div>
            {zenSettings.assist && (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <span className="w-20 text-xs text-neutral-500">HINTS</span>
                  <input
                    type="range"
                    min={1}
                    max={4}
                    value={zenSettings.hintCount}
                    onChange={(e) => updateZen({ hintCount: Number(e.target.value) })}
                    className="w-24 accent-neutral-300"
                  />
                  <span className="w-4 text-right text-xs text-neutral-200">{zenSettings.hintCount}</span>
                </div>
                <div className="flex flex-col gap-1">
                  {BOT_PROFILES.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => updateZen({ assistProfile: p.id })}
                      title={p.description}
                      className={`border px-2 py-1 text-left text-xs ${
                        zenSettings.assistProfile === p.id
                          ? 'border-neutral-300 text-neutral-100'
                          : 'border-neutral-800 text-neutral-500 hover:border-neutral-600'
                      }`}
                    >
                      {p.label}
                      <span className="block text-[10px] text-neutral-600">{p.description}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="mb-6">
            <h3 className="mb-2 border-b border-neutral-800 pb-1 text-[10px] tracking-widest text-neutral-600">GARBAGE</h3>
            <div className="flex flex-col gap-1">
              {GARBAGE_MODES.map(({ id, label, hint }) => (
                <button
                  key={id}
                  onClick={() => updateZen({ garbage: id })}
                  className={`border px-2 py-1 text-left text-xs ${
                    zenSettings.garbage === id
                      ? 'border-neutral-300 text-neutral-100'
                      : 'border-neutral-800 text-neutral-500 hover:border-neutral-600'
                  }`}
                >
                  {label}
                  <span className="block text-[10px] text-neutral-600">{hint}</span>
                </button>
              ))}
            </div>
            {(zenSettings.garbage === 'backfire' || zenSettings.garbage === 'unclear') && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-neutral-500">RATE</span>
                {([0.5, 1, 2] as GarbageMultiplier[]).map((m) => (
                  <ModeButton key={m} active={zenSettings.multiplier === m} onClick={() => updateZen({ multiplier: m })}>
                    {m}X
                  </ModeButton>
                ))}
              </div>
            )}
          </section>

          <p className="text-[10px] leading-relaxed text-neutral-600">
            Total score flows into your XP at all times. Level requirement scales linearly.
          </p>
        </aside>
      )}

      {(paused || over) && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 font-mono">
          <div className="w-64 border border-neutral-600 bg-black p-6 text-center">
            <h2 className="mb-4 text-lg tracking-widest text-neutral-100">{over ? 'GAME OVER' : 'PAUSED'}</h2>
            {!over && <p className="mb-4 text-xs text-neutral-500">{settings.keybinds.pause} to resume</p>}
            <button
              onClick={() => {
                setOver(false)
                setPaused(false)
                setRetryKey((k) => k + 1)
              }}
              className="mb-2 w-full border border-neutral-500 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
            >
              RETRY
            </button>
            <button onClick={onExit} className="w-full border border-neutral-700 py-2 text-sm text-neutral-400 hover:bg-neutral-900">
              QUIT TO MENU
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
