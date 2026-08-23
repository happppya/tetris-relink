import { PIECE_TYPES, type PieceType } from './types'

export type Rng = () => number

export interface ResettableRng extends Rng {
  snapshot(): number
  restore(state: number): void
}

export function mulberry32(seed: number): ResettableRng {
  let a = seed >>> 0
  const fn = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Object.assign(fn, {
    snapshot: () => a,
    restore: (state: number) => {
      a = state >>> 0
    },
  })
}

export function isResettable(rng: Rng): rng is ResettableRng {
  return typeof (rng as ResettableRng).snapshot === 'function'
}

export class Bag {
  private queue: PieceType[] = []
  private rng: Rng

  constructor(rng: Rng) {
    this.rng = rng
    this.refill()
  }

  private refill() {
    const bag = [...PIECE_TYPES]
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[bag[i], bag[j]] = [bag[j], bag[i]]
    }
    this.queue.push(...bag)
  }

  next(): PieceType {
    if (this.queue.length < 7) this.refill()
    return this.queue.shift()!
  }

  peek(n: number): PieceType[] {
    while (this.queue.length < n) this.refill()
    return this.queue.slice(0, n)
  }

  snapshot(): { queue: PieceType[]; rng: number | null } {
    this.peek(7)
    return {
      queue: [...this.queue],
      rng: isResettable(this.rng) ? this.rng.snapshot() : null,
    }
  }

  restore(snap: { queue: PieceType[]; rng: number | null }) {
    this.queue = [...snap.queue]
    if (snap.rng !== null && isResettable(this.rng)) this.rng.restore(snap.rng)
  }
}
