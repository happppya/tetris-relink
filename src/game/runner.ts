import { Game, type GameMode, type GameOptions, type GameEvent, type TickInput } from '../engine/game'

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

  advance(dtMs: number, input: TickInput) {
    if (this.ended || this.paused || this.game.over) return
    this.acc = Math.min(this.acc + dtMs, 200)
    while (this.acc >= STEP_MS && !this.ended) {
      this.acc -= STEP_MS
      const events = this.game.tick(input)
      if (events.length && this.opts.onEvent) this.opts.onEvent(events)
      this.checkEnd(events)
      input.actions = []
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
