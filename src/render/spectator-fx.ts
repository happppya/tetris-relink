import type { Cell } from '../engine/types'

/**
 * Detect line clears by diffing two consecutive relayed board snapshots.
 *
 * Spectators only receive boards (~10 Hz relays), never the clear events a
 * playing client sees, so clears are inferred: a row that was completely filled
 * in the previous snapshot and is no longer full in the same index of the next
 * one was cleared (garbage only ever adds cells, so an emptying row is a clear).
 * Rows above a cleared row drop into the gap, which can shift the reported
 * index by at most the number of cleared rows below it — close enough for VFX.
 */
export function detectClearedRows(prev: Cell[][], next: Cell[][]): number[] {
  const cleared: number[] = []
  const n = Math.min(prev.length, next.length)
  for (let y = 0; y < n; y++) {
    const wasFull = prev[y].every((c) => c !== null)
    const stillFull = next[y].every((c) => c !== null)
    if (wasFull && !stillFull) cleared.push(y)
  }
  return cleared
}
