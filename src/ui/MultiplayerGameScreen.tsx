import { useEffect, useRef, useState } from 'react'
import { GameRunner } from '../game/runner'
import { bindInput, drainFrame } from '../game/input'
import { useSettings, handlingFromSettings } from '../state/settings'
import { useLobby } from '../state/lobby'
import { net } from '../net/connection'
import { MatchClient, type Intermission, type OpponentState } from '../net/match-client'
import { renderBoard, drawMiniPiece } from '../render/canvas'
import { SpectatorBoard } from './SpectatorBoard'
import { EffectsSystem } from '../render/effects'
import { ClearPopupRenderer, SendPopupRenderer, clearLabels } from '../render/cleartext'
import { PopupLayer } from '../render/PopupLayer'
import { GarbageMeter } from './GarbageMeter'
import { StreakBox } from './StreakBox'
import { formatNum } from './format'
import { isMatchPoint } from '../../shared/lobby-settings.ts'
import type { GameEvent } from '../engine/game'
import type { LobbyPlayer, LobbySettings, TargetMode } from '../../shared/protocol.ts'

/** how long the ranked round scoreboard stays up between rounds */
const INTERMISSION_MS = 4000

const CELL = 30
const AI_CELL_SMALL = 16
const OPPONENT_CELL = 8
const NEXT_W = 120
const NEXT_H = 230
const MAX_OPPONENTS = 7

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

interface PlayerHud {
  score: number
  lines: number
  pps: number
  apm: number
  sent: number
  streak: number
  incoming: number
  latency: number
}

const statusLabel = (opp: OpponentState | undefined): string =>
  opp?.left ? ' · LEFT' : opp?.afk ? ' · AFK' : opp?.spectating ? ' · SPECTATING' : opp?.alive === false ? ' · OUT' : ''

/**
 * The intermission scoreboard shown between rounds (and on match end): every
 * player's round score, ranked, with the round winner and any player on match
 * point (one round win away from taking the match) highlighted.
 */
function IntermissionOverlay({ intermission, players, settings, final = false }: { intermission: Intermission; players: LobbyPlayer[]; settings: LobbySettings; final?: boolean }) {
  const rows = Object.entries(intermission.scores)
    .map(([id, score]) => ({
      id,
      score,
      name: players.find((p) => p.id === id)?.name ?? id,
      mp: isMatchPoint(intermission.wins, settings, id),
    }))
    .sort((a, b) => b.score - a.score)
  const winnerName = intermission.winnerId ? players.find((p) => p.id === intermission.winnerId)?.name ?? intermission.winnerId : null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 font-mono">
      <div className="w-96 border border-neutral-700 bg-black p-6">
        <h2 className="mb-1 text-center text-sm tracking-[0.3em] text-neutral-300">
          {intermission.winnerId ? `ROUND ${intermission.round} COMPLETE` : `ROUND ${intermission.round} · DRAW`}
        </h2>
        {winnerName && <p className="mb-4 text-center text-xs text-neutral-500">{winnerName} WINS THE ROUND</p>}
        <div className="flex flex-col gap-1">
          {rows.map((r, i) => (
            <div key={r.id} className={`flex items-center justify-between border px-3 py-1 text-sm ${r.id === intermission.winnerId ? 'border-neutral-400 text-neutral-100' : 'border-neutral-900 text-neutral-400'}`}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-neutral-600">{i + 1}</span>
                <span className="truncate">{r.name}</span>
                {r.id === intermission.winnerId && <span>✓</span>}
                {final && r.id === intermission.winnerId && <span className="shrink-0 text-[10px] tracking-widest text-green-400">WINNER</span>}
                {r.mp && <span className="shrink-0 text-[10px] tracking-widest text-yellow-400">MATCH POINT</span>}
              </span>
              <span className="shrink-0 text-neutral-200">{r.score.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-neutral-600">{final ? (intermission.winnerId ? 'match over — returning to lobby…' : 'match over — nobody left to play') : intermission.winnerId ? 'next round…' : 'replaying round…'}</p>
      </div>
    </div>
  )
}

/**
 * Full per-player panel used by the spectator view when there are one or two
 * players to watch: name, hold, stats, board with incoming meter, and next.
 * Data (board/hold/next/stats) arrives via ~10Hz relays, so everything is drawn
 * in ref callbacks at render time.
 */
function SpectatorPanel({ player, opp, cell }: { player: LobbyPlayer; opp: OpponentState | undefined; cell: number }) {
  return (
    <div className="flex items-start gap-4">
      <aside className="flex w-40 flex-col gap-3">
        <p className="text-sm text-neutral-300">
          {player.name}
          {statusLabel(opp)}
        </p>
        <div>
          <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">HOLD</h2>
          <canvas
            ref={(canvas) => {
              if (!canvas) return
              const ctx = canvas.getContext('2d')!
              ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
              drawMiniPiece(ctx, opp?.hold ?? null, ctx.canvas.width / 2, 24, 12)
            }}
            width={120}
            height={48}
            className="border border-neutral-800"
          />
        </div>
        <div className="font-mono text-sm">
          <HudRow label="SCORE" value={(opp?.score ?? 0).toLocaleString()} />
          <HudRow label="LINES" value={String(opp?.lines ?? 0)} />
          <HudRow label="INCOMING" value={String(opp?.incoming ?? 0)} />
        </div>
      </aside>
      <div className="flex items-start">
        <SpectatorBoard board={opp?.board ?? null} cell={cell} detail="full" />
        <div className="ml-1">
          <GarbageMeter amount={opp?.incoming ?? 0} height={20 * cell} />
        </div>
      </div>
      <div className="ml-1">
        <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">NEXT</h2>
        <canvas
          ref={(canvas) => {
            if (!canvas) return
            const ctx = canvas.getContext('2d')!
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
            ;(opp?.next ?? []).forEach((type, i) => drawMiniPiece(ctx, type, ctx.canvas.width / 2, 24 + i * 44, i === 0 ? 12 : 10))
          }}
          width={NEXT_W}
          height={NEXT_H}
          className="border border-neutral-800"
        />
      </div>
    </div>
  )
}

export function MultiplayerGameScreen({ onExit }: { onExit: () => void }) {
  const settings = useSettings()
  const match = useLobby((s) => s.match)
  const selfId = useLobby((s) => s.selfId)
  const clearMatch = useLobby((s) => s.clearMatch)
  const [hud, setHud] = useState<PlayerHud>({ score: 0, lines: 0, pps: 0, apm: 0, sent: 0, streak: 0, incoming: 0, latency: 0 })
  const [error, setError] = useState<string | null>(null)
  const [targetMode, setTargetMode] = useState<TargetMode>('random')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [opponents, setOpponents] = useState<Record<string, OpponentState>>({})
  const [round, setRound] = useState(1)
  const [wins, setWins] = useState<Record<string, number>>({})
  const [finished, setFinished] = useState(false)
  const [intermission, setIntermission] = useState<Intermission | null>(null)
  // spectating is server-driven (lobby choice before the match, or auto when
  // the player dies mid-game); the loop must not recreate the game when it
  // flips, so it reads the live value from this ref
  const [spectating, setSpectating] = useState(false)
  const spectatingRef = useRef(false)
  // the intermission scoreboard pauses the round: the loop reads this ref so
  // no pieces drop behind the overlay, and the timer below dismisses it
  const intermissionRef = useRef<Intermission | null>(null)
  // onExit is a fresh closure per App render; the match effect must not recreate
  // the game when App re-renders (roster updates during the match), so the exit
  // callback is read from this ref instead of the dependency array
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  // targetMode lives in state for rendering, but the game-loop effect must NOT
  // recreate the whole game when it changes (switching targeting modes would
  // tear down and rebuild the GameRunner/MatchClient, wiping the board and all
  // combo/hold/streak state). The loop reads the live value from this ref.
  const targetModeRef = useRef<TargetMode>('random')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const holdRef = useRef<HTMLCanvasElement>(null)
  const nextRef = useRef<HTMLCanvasElement>(null)
  const aiHoldRef = useRef<HTMLCanvasElement>(null)
  const aiNextRef = useRef<HTMLCanvasElement>(null)
  const opponentsRef = useRef<Record<string, OpponentState>>({})

  useEffect(() => {
    if (!match) return
    let stopped = false
    let endTimer: ReturnType<typeof setTimeout> | null = null
    let intermissionTimer: ReturnType<typeof setTimeout> | null = null
    let raf = 0
    let last = performance.now()
    let lastHudUpdate = 0
    let currentRound = match.round
    let paused = false

    const fx = new EffectsSystem(settings.fx)
    fx.setShakeEnabled(settings.shake)
    const popups = new ClearPopupRenderer()
    const sendPopups = new SendPopupRenderer()

    const runner = new GameRunner({
      mode: 'versus',
      gameOptions: {
        sendsGarbage: true,
        attack: settings.attack,
        fourWide: match.settings.fourWide,
        handling: handlingFromSettings(settings),
      },
      onEvent: (events: GameEvent[]) => {
        client.handleEvents(events)
        const now = performance.now()
        for (const ev of events) {
          if (ev.type === 'clear') {
            if (settings.clearPopups) popups.push(clearLabels(ev.info), now)
            if (settings.fx.sendPopups) sendPopups.push(ev.attack, runner.game.combo, now, ev.rows, ev.pieceX, CELL)
            fx.lineClear(ev.rows, CELL, ev.info, ev.attack, runner.game.combo)
          }
        }
      },
      onEnd: () => {},
    })

    const client = new MatchClient({
      game: runner.game,
      matchId: match.matchId,
      send: (msg) => net.send(msg),
      onMessage: (handler) => net.onMessage(handler),
      selfId: () => useLobby.getState().selfId,
      players: match.players,
      round: match.round,
    })
    const unsubscribeState = client.subscribe((s) => {
      opponentsRef.current = s.opponents
      setOpponents(s.opponents)
      // the next round's game_start restored a fresh board: a top-out had
      // finalized this runner (singleplayer end-of-run semantics), so un-finalize
      // it or the round never ticks on this client
      if (s.round !== currentRound) {
        currentRound = s.round
        runner.reset()
      }
      setRound(s.round)
      setWins(s.wins)
      setError(s.error)
      setFinished(s.finished)
      targetModeRef.current = s.targetMode
      setTargetMode(s.targetMode)
      setTargetId(s.targetId)
      spectatingRef.current = s.spectating
      setSpectating(s.spectating)
      const hadIntermission = intermissionRef.current !== null
      intermissionRef.current = s.intermission
      setIntermission(s.intermission)
      // a round just ended: hold the scoreboard up for a short intermission,
      // then let the next round (already reset by game_start) run
      if (s.intermission && !hadIntermission) {
        intermissionTimer = setTimeout(() => {
          intermissionRef.current = null
          setIntermission(null)
          // keep the store in sync so an opponent's next board_update can't
          // resurrect a scoreboard that already dismissed
          client.clearIntermission()
        }, INTERMISSION_MS)
      }
    })
    client.onMatchEnd(() => {
      runner.abort()
      endTimer = setTimeout(() => {
        clearMatch()
        onExitRef.current()
      }, 3000)
    })

    const input = bindInput(settings.keybinds)

    const loop = (t: number) => {
      if (stopped) return
      const dt = t - last
      last = t
      const ctrl = drainFrame(input, runner)
      // the intermission scoreboard blocks input: drain-but-discard spends any
      // key pressed while it is up so it can't place a piece when play resumes
      // ("the game only starts after the scoreboard disappears")
      if (intermissionRef.current) runner.clearActions()
      if (ctrl.pause) {
        paused = !paused
        if (paused) runner.clearActions()
      }
      if (ctrl.assist) client.setTarget(targetModeRef.current)
      // retry is ignored mid-match: rounds are server-authoritative and can't be
      // restarted from the client, and returning here would kill the rAF loop
      // and freeze all input for good
      // the intermission scoreboard pauses play: the round under it was already
      // reset by game_start, so nothing is lost by waiting it out
      if (!paused && !spectatingRef.current && !intermissionRef.current) {
        runner.advance(dt, { dir: input.dir, softDrop: input.softDrop })
        client.maybeSendSnapshot()
        // keep React renders off the input hot path: a full re-render every frame
        // throttles the main thread and makes inputs feel delayed/dropped
        if (t - lastHudUpdate > 100) {
          lastHudUpdate = t
          const g = runner.game
          setHud({ score: g.score, lines: g.lines, pps: g.pps, apm: g.apm, sent: g.sentLines, streak: g.streak, incoming: g.pendingGarbage, latency: Math.round(net.latency) })
        }
      }
      // the playing layout unmounts while spectating, so the canvases may be
      // gone — re-acquire contexts fresh each frame to survive remounts
      if (!spectatingRef.current && canvasRef.current && overlayRef.current && holdRef.current && nextRef.current) {
        const g = runner.game
        const ctx = canvasRef.current.getContext('2d')!
        renderBoard(ctx, g.board, g.active, g.ghostPiece, { cellSize: CELL, showGhost: settings.ghost })
        fx.update(dt / 1000)
        fx.draw(ctx)
        fx.drawOverlay(ctx, canvasRef.current.width, canvasRef.current.height, t)
        // popup VFX draws on a dedicated overlay above the board and side panels
        const overlay = overlayRef.current
        if (overlay.width !== canvasRef.current.width) overlay.width = canvasRef.current.width
        if (overlay.height !== canvasRef.current.height) overlay.height = canvasRef.current.height
        const overlayCtx = overlay.getContext('2d')!
        overlayCtx.clearRect(0, 0, overlay.width, overlay.height)
        if (settings.clearPopups) popups.draw(overlayCtx, overlay.width, overlay.height, t)
        if (settings.fx.sendPopups) sendPopups.draw(overlayCtx, overlay.width, overlay.height, t)
        fx.applyShake(canvasRef.current, t)
        const holdCtx = holdRef.current.getContext('2d')!
        holdCtx.clearRect(0, 0, holdCtx.canvas.width, holdCtx.canvas.height)
        drawMiniPiece(holdCtx, g.hold, holdCtx.canvas.width / 2, 24, 12)
        const nextCtx = nextRef.current.getContext('2d')!
        nextCtx.clearRect(0, 0, nextCtx.canvas.width, nextCtx.canvas.height)
        g.nextQueue.forEach((type, i) => drawMiniPiece(nextCtx, type, nextCtx.canvas.width / 2, 24 + i * 44, i === 0 ? 12 : 10))
      }
      // the 1v1 opponent panel shows the opponent's hold and next pieces,
      // relayed from their snapshots (~10Hz), drawn here every frame
      if (!spectatingRef.current && (aiHoldRef.current || aiNextRef.current)) {
        const opp = opponentsRef.current[opponentId]
        if (opp && aiHoldRef.current) {
          const aiHoldCtx = aiHoldRef.current.getContext('2d')!
          aiHoldCtx.clearRect(0, 0, aiHoldCtx.canvas.width, aiHoldCtx.canvas.height)
          drawMiniPiece(aiHoldCtx, opp.hold, aiHoldCtx.canvas.width / 2, 24, 12)
        }
        if (opp && aiNextRef.current) {
          const aiNextCtx = aiNextRef.current.getContext('2d')!
          aiNextCtx.clearRect(0, 0, aiNextCtx.canvas.width, aiNextCtx.canvas.height)
          opp.next.forEach((type, i) => drawMiniPiece(aiNextCtx, type, aiNextCtx.canvas.width / 2, 24 + i * 44, i === 0 ? 12 : 10))
        }
      }
      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      input.detach()
      unsubscribeState()
      client.destroy()
      runner.abort()
      if (endTimer) clearTimeout(endTimer)
      if (intermissionTimer) clearTimeout(intermissionTimer)
    }
    // NOTE: targetMode and onExit are deliberately NOT dependencies — targetMode
    // changes on every targeting switch, and onExit is a fresh closure on every
    // App render (any lobby update re-renders App, e.g. the roster broadcast at a
    // round end). Recreating the MatchClient on either would wipe the intermission
    // scoreboard (and the whole game) mid-match; both are read via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match, settings, clearMatch])

  if (!match) return null

  const leave = () => {
    // LEAVE mid-match = go AFK: out of the game, still in the lobby, able to
    // return to the game or fully leave the lobby
    useLobby.getState().goAfk()
    clearMatch()
    onExit()
  }

  const opponentsList = match.players.filter((p) => p.id !== selfId).slice(0, MAX_OPPONENTS)
  // "only one opponent remaining" (nobody left the match yet) gets the full
  // 1v1 treatment: big board, hold, next, stats. More than one opponent shows
  // a compact grid: name + board + incoming bar only, no stats, no next. Once
  // the match is ending (finished), keep the 1v1 panel instead of flickering
  // to an empty grid during the exit window.
  const liveOpponents = opponentsList.filter((p) => !opponents[p.id]?.left)
  const oneVsOne = liveOpponents.length === 1 || (finished && opponentsList.length === 1)
  const opponentId = liveOpponents[0]?.id ?? opponentsList[0]?.id
  const aiCell = settings.opponentBoardSize === 'full' ? CELL : AI_CELL_SMALL

  // spectator view: watch every non-spectating player; one or two boards get
  // the full treatment (stats/next/hold), more than two become a compact grid
  const watched = match.players.filter((p) => p.id !== selfId && !opponents[p.id]?.spectating)

  if (spectating) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 font-mono">
        <div className="flex items-center gap-6 text-xs text-neutral-500">
          <span className="tracking-widest text-neutral-400">SPECTATING · ROUND {round}</span>
          <span>
            {Object.entries(wins).map(([id, value]) => `${match.players.find((player) => player.id === id)?.name ?? id}: ${value}`).join(' · ')}
          </span>
          <button disabled={finished} onClick={leave} className="border border-neutral-700 px-3 py-1 text-neutral-400 disabled:opacity-40">
            LEAVE
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {intermission && <IntermissionOverlay intermission={intermission} players={match.players} settings={match.settings} final={finished} />}
        {watched.length <= 2 ? (
          <div className="flex items-start gap-8">
            {watched.map((p) => (
              // keyed by round so each round starts with clean per-board fx
              <SpectatorPanel key={`${p.id}-${round}`} player={p} opp={opponents[p.id]} cell={aiCell} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {watched.map((p) => {
              const opp = opponents[p.id]
              return (
                <div key={`${p.id}-${round}`} className="flex min-w-0 flex-col items-start gap-1 border border-neutral-900 p-2">
                  <p className="w-full truncate text-sm text-neutral-300">
                    {p.name}
                    {statusLabel(opp)}
                  </p>
                  <div className="flex items-start gap-1">
                    <SpectatorBoard board={opp?.board ?? null} cell={OPPONENT_CELL} detail="reduced" />
                    <GarbageMeter amount={opp?.incoming ?? 0} height={160} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center gap-6 font-mono">
      <aside className="flex w-40 flex-col gap-4">
        <div>
          <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">HOLD</h2>
          <canvas ref={holdRef} width={120} height={48} className="border border-neutral-800" />
        </div>
        <div className="font-mono text-sm">
          <HudRow label="SCORE" value={hud.score.toLocaleString()} />
          <HudRow label="LINES" value={String(hud.lines)} />
          <HudRow label="PPS" value={formatNum(hud.pps)} />
          <HudRow label="APM" value={formatNum(hud.apm)} />
          <HudRow label="SENT" value={String(hud.sent)} />
          <HudRow label="INCOMING" value={String(hud.incoming)} />
        </div>
        <StreakBox value={hud.streak} />
        <div className="mt-2 border-t border-neutral-800 pt-2">
          <p className="text-xs text-neutral-400">ROUND {round} · {match.settings.mode === 'firstToX' ? `FIRST TO ${match.settings.goal}` : `WIN BY ${match.settings.winBy}`}</p>
          <p className="text-xs text-neutral-500">{Object.entries(wins).map(([id, value]) => `${match.players.find((player) => player.id === id)?.name ?? id}: ${value}`).join(' · ')}</p>
          {isMatchPoint(wins, match.settings, selfId ?? '') && <p className="mt-1 text-[10px] tracking-widest text-yellow-400">MATCH POINT</p>}
          <p className="text-xs text-neutral-500">{hud.latency}ms · {targetMode.toUpperCase()}</p>
          <div className="mt-2 flex gap-1">
            {(['manual', 'revenge', 'random'] as const).map((mode) => <button key={mode} onClick={() => { targetModeRef.current = mode; setTargetMode(mode); setTargetId(null); net.send({ type: 'target', mode }) }} className={`border px-1 text-[10px] ${targetMode === mode ? 'border-neutral-300 text-neutral-100' : 'border-neutral-800 text-neutral-500'}`}>{mode.slice(0, 3).toUpperCase()}</button>)}
          </div>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {intermission && <IntermissionOverlay intermission={intermission} players={match.players} settings={match.settings} final={finished} />}
        <button disabled={finished} onClick={leave} className="mt-4 border border-neutral-700 px-3 py-2 text-xs text-neutral-400 disabled:opacity-40">LEAVE</button>
      </aside>

      <div className="flex items-start">
        <div className="flex">
          <div className="relative border border-neutral-700">
            <canvas ref={canvasRef} width={300} height={600} className="block" />
            <PopupLayer ref={overlayRef} />
          </div>
          <div className="ml-1">
            <GarbageMeter amount={hud.incoming} />
          </div>
        </div>
        <NextColumn canvasRef={nextRef} />
      </div>

      {oneVsOne ? (
        <div className="flex items-start gap-6">
          <aside className="flex w-40 flex-col gap-4">
            <h2 className="font-mono text-xs tracking-widest text-neutral-500">OPPONENT</h2>
            <p className="text-sm text-neutral-300">
              {match.players.find((p) => p.id === opponentId)?.name ?? '?'}
              {statusLabel(opponents[opponentId])}
            </p>
            <div>
              <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">HOLD</h2>
              <canvas ref={aiHoldRef} width={120} height={48} className="border border-neutral-800" />
            </div>
            <div className="font-mono text-sm">
              <HudRow label="SCORE" value={(opponents[opponentId]?.score ?? 0).toLocaleString()} />
              <HudRow label="LINES" value={String(opponents[opponentId]?.lines ?? 0)} />
              <HudRow label="INCOMING" value={String(opponents[opponentId]?.incoming ?? 0)} />
            </div>
          </aside>

          <div className="flex items-start pt-5">
            <canvas
              ref={(canvas) => {
                if (!canvas) return
                const current = opponentsRef.current[opponentId]?.board
                if (Array.isArray(current) && current.length === 20 && current.every((row) => Array.isArray(row) && row.length === 10))
                  renderBoard(canvas.getContext('2d')!, current, null, null, { cellSize: aiCell, showGhost: false })
              }}
              width={10 * aiCell}
              height={20 * aiCell}
              className="border border-neutral-800"
            />
            <div className="ml-1">
              <GarbageMeter amount={opponents[opponentId]?.incoming ?? 0} height={20 * aiCell} />
            </div>
          </div>

          <div className="ml-2 pt-5">
            <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">NEXT</h2>
            <canvas ref={aiNextRef} width={NEXT_W} height={NEXT_H} className="border border-neutral-800" />
          </div>
        </div>
      ) : (
        <aside className="w-64">
          <h2 className="mb-2 text-xs tracking-widest text-neutral-500">OPPONENTS</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {opponentsList.map((p) => {
              const opponent = opponents[p.id]
              const board = opponent?.board
              const hasBoard = Array.isArray(board) && board.length === 20 && board.every((row) => Array.isArray(row) && row.length === 10)
              return (
                <button
                  key={p.id}
                  disabled={opponent?.left || opponent?.alive === false}
                  onClick={() => { targetModeRef.current = 'manual'; setTargetMode('manual'); setTargetId(p.id); net.send({ type: 'target', mode: 'manual', targetId: p.id }) }}
                  className={`relative flex min-w-0 flex-col items-start gap-1 border p-1 text-left disabled:opacity-40 ${targetId === p.id ? 'border-neutral-300' : 'border-neutral-900'}`}
                >
                  <p className="w-full truncate text-sm text-neutral-300">
                    {p.name}
                    {statusLabel(opponent)}
                  </p>
                  <div className="flex items-start gap-1">
                    {hasBoard && <canvas ref={(canvas) => { if (!canvas) return; const current = opponents[p.id]?.board; if (Array.isArray(current) && current.length === 20 && current.every((row) => Array.isArray(row) && row.length === 10)) renderBoard(canvas.getContext('2d')!, current, null, null, { cellSize: OPPONENT_CELL, showGhost: false }) }} width={80} height={160} className="border border-neutral-800" />}
                    <GarbageMeter amount={opponent?.incoming ?? 0} height={160} />
                  </div>
                  {targetId === p.id && <span aria-label="targeted" className="absolute right-1 top-1 text-xs text-red-400">⌖</span>}
                </button>
              )
            })}
          </div>
        </aside>
      )}
    </main>
  )
}
