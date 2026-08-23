import { Game, type TickInput } from '../engine/game'
import type { BotOutMsg, BotStateMsg } from './protocol'
import { buildPlacementScript, type ScriptStep } from './executor'
import type { HandlingConfig } from '../engine/game'

export interface BotDriverOpts {
  pps: number
  profile?: string
  /** must match the driven game's handling so simulated inputs replay true */
  handling?: Partial<HandlingConfig>
  onPlanError?: () => void
}

export class BotDriver {
  private worker: Worker
  private requestSeq = 0
  /** frames elapsed since the current piece appeared */
  private pieceFrames = 0
  /** piecesPlaced count at the time the current piece appeared */
  private seenPlacements = -1
  private script: ScriptStep[] = []
  private unavailable = false
  pps: number
  profile: string
  private opts: BotDriverOpts
  private game: Game

  constructor(game: Game, opts: BotDriverOpts) {
    this.game = game
    this.opts = opts
    this.pps = opts.pps
    this.profile = opts.profile ?? 'optimal'
    this.worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<BotOutMsg>) => {
      if (e.data.type === 'unavailable') {
        // no bot brain: stop requesting plans and rely on the tick() failsafe
        this.unavailable = true
        if (import.meta.env?.DEV) console.warn('[botdriver] bot unavailable:', e.data.reason)
        return
      }
      if (e.data.type !== 'plan') return
      // stale reply for an already-replaced piece must not steer this one
      const seq = e.data.seq ?? -1
      if (seq !== this.requestSeq) return
      this.script = buildPlacementScript(this.game, this.opts, e.data)
    }
    this.requestPlan()
  }

  setPps(pps: number) {
    this.pps = pps
    // buildPlacementScript reads opts.pps, so adaptive changes must land there
    this.opts.pps = pps
  }

  setProfile(profile: string) {
    if (profile === this.profile) return
    this.profile = profile
    this.requestPlan()
  }

  private requestPlan() {
    if (this.unavailable) return
    const g = this.game
    if (!g.active || g.over) return
    const msg: BotStateMsg = {
      type: 'state',
      profile: this.profile,
      board: g.board.map((r) => [...r]),
      current: g.active.type,
      next: g.nextQueue,
      hold: g.holdBlocked ? null : g.hold,
      b2b: g.b2bActive,
      combo: g.combo,
      seq: ++this.requestSeq,
    }
    this.worker.postMessage(msg)
  }

  tick(): TickInput {
    const idle: TickInput = { dir: 0, softDrop: false, actions: [] }
    if (this.game.over) return idle
    const active = this.game.active
    if (!active) return idle

    // a lock increments piecesPlaced and the next piece spawns immediately —
    // keying on piece type alone would miss consecutive same-type pieces
    if (this.game.piecesPlaced !== this.seenPlacements) {
      this.seenPlacements = this.game.piecesPlaced
      this.pieceFrames = 0
      this.script = []
      this.requestPlan()
    }
    this.pieceFrames++

    // failsafe: never freeze completely if the worker keeps failing — drop
    // the piece after a generous grace period instead of idling forever
    if (this.pieceFrames >= 600 && this.script.length === 0) {
      return { dir: 0, softDrop: false, actions: ['hardDrop'] }
    }
    const step = this.script.shift()
    if (!step) return idle
    return { dir: step.dir, softDrop: step.softDrop, actions: step.actions }
  }

  destroy() {
    this.worker.terminate()
  }
}
