import { computeAttack, DEFAULT_ATTACK, type AttackConfig, type ClearInfo, type SpinKind } from '../src/engine/attack.ts'
import type { PieceType } from '../src/engine/types.ts'
import { serializeBoard, type BoardCell } from '../shared/board.ts'

export const AUTH_W = 10
export const AUTH_H = 20

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

export function createAuthority(): BoardAuthority {
  return { board: emptyRows(), queue: [] }
}

export function resetAuthority(a: BoardAuthority): void {
  a.board = emptyRows()
  a.queue = []
}

export function serializeAuthority(a: BoardAuthority): string {
  return serializeBoard(a.board)
}

export function pendingGarbage(a: BoardAuthority): number {
  return a.queue.reduce((sum, g) => sum + g.rows, 0)
}

export function queueGarbage(a: BoardAuthority, rows: number, hole: number): void {
  if (rows <= 0) return
  a.queue.push({ rows, hole: clampHole(hole) })
}

const emptyRows = (): BoardCell[][] => Array.from({ length: AUTH_H }, () => Array<BoardCell>(AUTH_W).fill(null))
const clampHole = (h: number): number => Math.max(0, Math.min(AUTH_W - 1, Math.round(h)))

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
  while (a.board.length < AUTH_H) a.board.unshift(emptyRows()[0])
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

function applyQueued(a: BoardAuthority): number {
  let total = 0
  for (const g of a.queue) {
    total += g.rows
    for (let i = 0; i < g.rows; i++) {
      const row = Array<BoardCell>(AUTH_W).fill('G')
      row[clampHole(g.hole)] = null
      a.board.shift()
      a.board.push(row)
    }
  }
  a.queue = []
  return total
}