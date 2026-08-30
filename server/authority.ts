import { GARBAGE_PER_PLACEMENT, computeAttack, DEFAULT_ATTACK, type AttackConfig, type ClearInfo, type SpinKind } from '../src/engine/attack.ts'
import type { PieceType } from '../src/engine/types.ts'
import { serializeBoard, type BoardCell } from '../shared/board.ts'

export const AUTH_W = 10
export const AUTH_H = 20

// profiling: cumulative full-board serializations (the snapshot cross-check path)
let serializations = 0
export function authoritySerializations(): number {
  return serializations
}

export interface QueuedGarbage {
  rows: number
  hole: number
}

/**
 * A server-authoritative copy of one player's visible board, plus the incoming
 * garbage it has received but not yet taken. Mirrors the engine's own rules so
 * the server can reconcile a diverged client with a real resync.
 */
export interface BoardAuthority {
  board: BoardCell[][]
  queue: QueuedGarbage[]
  /** four-wide mode: side columns walled, garbage holes clamped to the centre 4 */
  fourWide: boolean
  /** cached serialized board (null = dirty, rebuilt on next serialize); the
   * snapshot cross-check serializes every snapshot, so caching turns it into
   * a string compare between mutations */
  serialized: string | null
}

export interface LockPlacement {
  cells: { x: number; y: number }[]
  rows: number
  spin: SpinKind
  piece: PieceType | null
  combo: number
  b2b: boolean
  streak: number
}

export interface ApplyOutcome {
  /** the lock was bogus (out-of-bounds / overlapping) — board untouched, no attack */
  invalid: boolean
  /** rows the server cleared from its authoritative board */
  cleared: number
  /** the placement's attack, in lines */
  total: number
  /** attack left after cancelling the player's own incoming garbage (0 = zero passthrough) */
  surplus: number
}

export function createAuthority(fourWide = false): BoardAuthority {
  return { board: fourWide ? walledRows() : emptyRows(), queue: [], fourWide, serialized: null }
}

export function resetAuthority(a: BoardAuthority): void {
  a.board = a.fourWide ? walledRows() : emptyRows()
  a.queue = []
  a.serialized = null
}

export function serializeAuthority(a: BoardAuthority): string {
  if (a.serialized === null) {
    serializations++
    a.serialized = serializeBoard(a.board)
  }
  return a.serialized
}

export function pendingGarbage(a: BoardAuthority): number {
  return a.queue.reduce((sum, g) => sum + g.rows, 0)
}

export function queueGarbage(a: BoardAuthority, rows: number, hole: number): number {
  if (rows <= 0) return 0
  const h = clampHole(a, hole)
  a.queue.push({ rows, hole: h })
  return h
}

const emptyRows = (): BoardCell[][] => Array.from({ length: AUTH_H }, () => Array<BoardCell>(AUTH_W).fill(null))
const walledRows = (): BoardCell[][] =>
  Array.from({ length: AUTH_H }, () => Array.from({ length: AUTH_W }, (_, x) => (x < 3 || x >= AUTH_W - 3 ? 'W' : null)))

/** Clamp a hole column into the playable region (centre 4 columns 3..6 in four-wide). */
const clampHole = (a: BoardAuthority, h: number): number => {
  const clamped = Math.max(0, Math.min(AUTH_W - 1, Math.round(h)))
  return a.fourWide ? Math.min(AUTH_W - 4, Math.max(3, clamped)) : clamped
}

/**
 * Apply a lock to the authoritative board. The server reconstructs the board
 * from the reported cells, detects/clears rows independently (and flags bogus
 * locks), then reconciles garbage: a clearing lock first cancels the player's
 * queued incoming garbage ("wait a little" — garbage is held until the next
 * non-clearing placement so a clear is given a chance); only the surplus is
 * forwarded (zero passthrough).
 */
export function applyLock(a: BoardAuthority, lock: LockPlacement, cfg: AttackConfig = DEFAULT_ATTACK): ApplyOutcome {
  if (!place(a, lock.cells, lock.piece)) return { invalid: true, cleared: 0, total: 0, surplus: 0 }

  const cleared = clearFullRows(a)
  const pc = a.board.every((row) => row.every((c) => c === null))
  const total = computeAttack(
    { count: lock.rows, spin: lock.spin, piece: lock.piece, perfectClear: pc } as ClearInfo,
    cfg,
    lock.combo,
    lock.b2b,
    lock.streak,
  ).totalLines

  let surplus = 0
  if (cleared > 0) {
    surplus = cancelToSurplus(a, total)
  } else {
    applyQueued(a) // garbage lands on this non-clearing placement
  }
  return { invalid: false, cleared, total, surplus }
}

function place(a: BoardAuthority, cells: LockPlacement['cells'], type: PieceType | null): boolean {
  for (const c of cells) {
    if (!Number.isInteger(c.x) || !Number.isInteger(c.y) || c.x < 0 || c.x >= AUTH_W || c.y < 0 || c.y >= AUTH_H) return false
  }
  for (const c of cells) if (a.board[c.y][c.x] !== null) return false
  for (const c of cells) a.board[c.y][c.x] = type ?? 'G'
  a.serialized = null
  return true
}

function clearFullRows(a: BoardAuthority): number {
  let count = 0
  for (let y = AUTH_H - 1; y >= 0; y--) {
    if (a.board[y].every((c) => c !== null)) {
      a.board.splice(y, 1)
      count++
    }
  }
  while (a.board.length < AUTH_H) a.board.unshift(a.fourWide ? walledRows()[0] : emptyRows()[0])
  if (count > 0) a.serialized = null
  return count
}

/** Cancel up to `pool` rows of cancellable incoming; returns the surplus. */
function cancelToSurplus(a: BoardAuthority, pool: number): number {
  for (const g of a.queue) {
    if (pool <= 0) break
    const take = Math.min(g.rows, pool)
    g.rows -= take
    pool -= take
  }
  a.queue = a.queue.filter((g) => g.rows > 0)
  return pool
}

// The authoritative mirror of the engine's delivery rule: at most
// GARBAGE_PER_PLACEMENT rows land on one non-clearing placement, so the server
// board and the client agree on how many remaining rows are still owed.
function applyQueued(a: BoardAuthority): number {
  let total = 0
  for (const g of a.queue) {
    const take = Math.min(g.rows, GARBAGE_PER_PLACEMENT - total)
    if (take <= 0) break
    for (let i = 0; i < take; i++) {
      const row = Array<BoardCell>(AUTH_W).fill('G')
      row[clampHole(a, g.hole)] = null
      a.board.shift()
      a.board.push(row)
    }
    g.rows -= take
    total += take
  }
  a.queue = a.queue.filter((g) => g.rows > 0)
  if (total > 0) a.serialized = null
  return total
}