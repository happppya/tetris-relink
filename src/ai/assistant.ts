import type { BotHintPlacement, BotOutMsg, BotStateMsg } from './protocol'
import type { PieceType, Cell } from '../engine/types'

export interface HintRequest {
  board: Cell[][]
  current: PieceType
  next: PieceType[]
  /** usable hold piece, or null when empty/blocked */
  hold: PieceType | null
  b2b: boolean
  combo: number
  profile: string
  count: number
}

export interface HintReply {
  seq: number
  placements: BotHintPlacement[]
  /** placements[0] should be played after swapping the current piece into hold */
  hold?: boolean
}

/**
 * Thin client for the assist-mode hint overlay. Spawns its own bot worker and
 * returns chained suggested placements for the upcoming pieces.
 */
export class HintProvider {
  private worker: Worker
  private requestSeq = 0
  private pending: { seq: number; resolve: (r: HintReply) => void } | null = null

  constructor() {
    this.worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<BotOutMsg>) => {
      if (!this.pending) return
      const data = e.data
      if ((data.seq ?? -1) !== this.pending.seq) return // stale reply
      const { seq, resolve } = this.pending
      this.pending = null
      if (data.type === 'hints') {
        resolve({ seq, placements: data.placements, hold: data.hold })
      } else if (data.type === 'unavailable') {
        resolve({ seq, placements: [] })
      }
    }
  }

  request(req: HintRequest): Promise<HintReply> {
    return new Promise((resolve) => {
      // supersede any in-flight request; the void seq (0) can never match a
      // caller's captured seq, so the stale reply is discarded by design
      this.pending?.resolve({ seq: 0, placements: [] })
      const seq = ++this.requestSeq
      this.pending = { seq, resolve }
      const msg: BotStateMsg = {
        type: 'state',
        profile: req.profile,
        board: req.board.map((r) => [...r]),
        current: req.current,
        next: req.next,
        hold: req.hold,
        b2b: req.b2b,
        combo: req.combo,
        hintCount: req.count,
        seq,
      }
      this.worker.postMessage(msg)
    })
  }

  destroy() {
    this.worker.terminate()
  }
}
