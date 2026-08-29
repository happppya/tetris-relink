import { Game, type GameMode, type GameOptions, type GameEvent, type TickInput } from '../engine/game'
import type { InputAction } from '../engine/types'

export const STEP_MS = 1000 / 60

export interface RunResult {
  mode: GameMode
  blitzDuration?: number
  timeMs: number
  score: number
  lines: number
  pps: number
  apm: number
}

export interface RunnerOpts {
  mode: GameMode
  blitzDuration?: number
  sprintTargetLines?: number
  gameOptions: GameOptions
  onEvent?: (events: GameEvent[]) => void
  onEnd: (result: RunResult) => void
}

export class GameRunner {
  readonly game: Game
  readonly mode: GameMode
  readonly blitzDuration?: number
  private sprintTarget: number
  private acc = 0
  private actionQueue: InputAction[] = []
  paused = false
  ended = false
  private opts: RunnerOpts

  constructor(opts: RunnerOpts) {
    this.opts = opts
    this.game = new Game({ ...opts.gameOptions, mode: opts.mode })
    this.mode = opts.mode
    this.blitzDuration = opts.blitzDuration
    this.sprintTarget = opts.sprintTargetLines ?? 40
  }

  get elapsedMs(): number {
    return this.game.frames * STEP_MS
  }

  /**
   * Buffer discrete actions (rotate / hold / hard drop). They are applied on the
   * next simulation tick and are never dropped, even if no tick ran since they
   * were queued (e.g. displays refreshing faster than 60Hz, or a heavy frame).
   * Pause/assist/retry are UI concerns and are ignored by the game sim.
   */
  queueActions(actions: InputAction[]) {
    if (!actions.length) return
    this.actionQueue.push(...actions)
  }

  /** Discard any buffered actions (used when pausing). */
  clearActions() {
    this.actionQueue.length = 0
  }

  /**
   * Prepare for a fresh round in a series-of-games match. A top-out finalizes
   * the run (singleplayer end-of-run semantics set `ended`); multiplayer reuses
   * this same runner across rounds, so a new round must clear that so the
   * freshly-restored board can tick again.
   */
  reset() {
    this.ended = false
    this.acc = 0
    this.actionQueue.length = 0
  }

  /**
   * Run one wall-clock frame. The simulator steps in fixed 60Hz ticks; the
   * buffered action queue is consumed exactly once, on the first tick that runs
   * in this call, so actions survive intermediate non-ticking frames and are
   * never re-applied when a single call spans several ticks.
   */
  advance(dtMs: number, input: Omit<TickInput, 'actions'>) {
    if (this.ended || this.paused || this.game.over) return
    this.acc = Math.min(this.acc + dtMs, 200)
    let firstTick = true
    while (this.acc >= STEP_MS && !this.ended) {
      this.acc -= STEP_MS
      const tickInput: TickInput = {
        dir: input.dir,
        softDrop: input.softDrop,
        actions: firstTick ? this.actionQueue : [],
      }
      if (firstTick) this.actionQueue = []
      firstTick = false
      const events = this.game.tick(tickInput)
      if (events.length && this.opts.onEvent) this.opts.onEvent(events)
      this.checkEnd(events)
    }
  }

  private checkEnd(events: GameEvent[]) {
    if (this.game.over) {
      this.finish()
      void events
      return
    }
    if (this.mode === 'sprint' && this.game.lines >= this.sprintTarget) {
      this.finish()
    } else if (this.mode === 'blitz' && this.game.frames >= (this.blitzDuration ?? 60) * 60) {
      this.finish()
    }
  }

  finish() {
    if (this.ended) return
    this.ended = true
    this.opts.onEnd({
      mode: this.mode,
      blitzDuration: this.blitzDuration,
      timeMs: Math.round(this.elapsedMs),
      score: this.game.score,
      lines: this.game.lines,
      pps: this.game.pps,
      apm: this.game.apm,
    })
  }

  abort() {
    this.ended = true
  }
}
