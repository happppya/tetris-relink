import { describe, expect, it } from 'vitest'
import {
  applyLock,
  createAuthority,
  pendingGarbage,
  queueGarbage,
  serializeAuthority,
} from './authority.ts'

const PLACE = {
  spin: 'none' as const,
  piece: 'O' as const,
  combo: 0,
  b2b: false,
  streak: 0,
}

const almostFull = (holeX: number) =>
  Array.from({ length: 10 }, (_, x) => (x === holeX ? null : 'T'))

describe('authoritative board', () => {
  it('reconstructs a board from reported lock cells', () => {
    const auth = createAuthority()
    applyLock(auth, { cells: [{ x: 3, y: 19 }, { x: 4, y: 19 }], rows: 0, ...PLACE })
    expect(auth.board[19][3]).toBe('O')
    expect(auth.board[19][4]).toBe('O')
    expect(serializeAuthority(auth).split('/')[19]).toBe('...OO.....')
  })

  it('clears completed rows and returns the cleared count', () => {
    const auth = createAuthority()
    auth.board[19] = almostFull(5)
    const out = applyLock(auth, { cells: [{ x: 5, y: 19 }], rows: 1, ...PLACE })
    expect(out.cleared).toBe(1)
    expect(auth.board[19].every((c) => c === null)).toBe(true)
  })

  it('holds incoming garbage until the next non-clearing placement (wait a little)', () => {
    const auth = createAuthority()
    queueGarbage(auth, 2, 0)
    expect(pendingGarbage(auth)).toBe(2)
    expect(auth.board[19].every((c) => c === null)).toBe(true) // not applied yet

    applyLock(auth, { cells: [{ x: 0, y: 19 }, { x: 1, y: 19 }], rows: 0, ...PLACE })

    expect(pendingGarbage(auth)).toBe(0)
    expect(auth.board[19][0]).toBeNull() // hole
    expect(auth.board[19][1]).toBe('G') // garbage landed at the bottom
    expect(auth.board[17][0]).toBe('O') // our placement was pushed up 2 rows
  })

  it('cancels incoming garbage with a clear and forwards zero surplus', () => {
    const auth = createAuthority()
    queueGarbage(auth, 2, 0)
    auth.board[18] = almostFull(7)
    auth.board[19] = almostFull(7)
    auth.board[0][0] = 'L' // a non-clearing sentinel, so this is not a perfect clear
    // a double clears two rows (attack = 1); incoming (2) cancels it all
    const out = applyLock(auth, { cells: [{ x: 7, y: 19 }, { x: 7, y: 18 }], rows: 2, piece: 'I', spin: 'none', combo: 0, b2b: false, streak: 0 })
    expect(out.cleared).toBe(2)
    expect(out.surplus).toBe(0) // zero passthrough
    expect(pendingGarbage(auth)).toBe(1) // the rest still waits for a non-clear lock
  })

  it('forwards only the surplus when an attack exceeds incoming garbage', () => {
    const auth = createAuthority()
    queueGarbage(auth, 1, 0)
    for (let y = 16; y <= 19; y++) auth.board[y] = almostFull(4)
    auth.board[0][0] = 'L' // a non-clearing sentinel, so this is not a perfect clear
    const out = applyLock(auth, { cells: [{ x: 4, y: 19 }, { x: 4, y: 18 }, { x: 4, y: 17 }, { x: 4, y: 16 }], rows: 4, piece: 'I', spin: 'none', combo: 0, b2b: false, streak: 0 })
    expect(out.cleared).toBe(4)
    expect(out.surplus).toBe(3) // tetris (4) minus the 1 row it cancelled
    expect(pendingGarbage(auth)).toBe(0)
  })

  it('rejects a lock whose reported cells overlap existing pieces or leave the board', () => {
    const auth = createAuthority()
    const off = applyLock(auth, { cells: [{ x: 9, y: 0 }, { x: 9, y: -1 }], rows: 0, ...PLACE })
    expect(off.invalid).toBe(true)

    auth.board[19][5] = 'T'
    const overlap = applyLock(auth, { cells: [{ x: 5, y: 19 }], rows: 0, ...PLACE })
    expect(overlap.invalid).toBe(true)
    expect(pendingGarbage(auth)).toBe(0)
  })
})