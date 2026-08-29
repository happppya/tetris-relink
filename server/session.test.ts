import { describe, expect, it } from 'vitest'
import { Session } from './session.ts'
import { emptyBoard, serializeBoard } from '../shared/board.ts'
import type { LockEvent } from '../shared/protocol.ts'

const settings = { mode: 'firstToX' as const, goal: 7, winBy: 2 }

const tetris: LockEvent = { rows: 4, spin: 'none', piece: 'I', perfectClear: false, combo: 0, b2b: false, streak: 0 }
const noAttack: LockEvent = { rows: 1, spin: 'none', piece: 'T', perfectClear: false, combo: 0, b2b: false, streak: 0 }

function makeSession() {
  return new Session('m1', [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ], settings)
}

describe('Session', () => {
  it('starts every player present and accepts an empty snapshot', () => {
    const s = makeSession()
    expect(s.summary.players).toHaveLength(3)
    for (const p of s.summary.players) {
      expect(s.checkSnapshot(p.id, serializeBoard(emptyBoard()), 0)).toEqual({ status: 'ok' })
    }
  })

  it('computes the attack from the room table and routes it to a target', () => {
    const s = makeSession()
    const events = s.move('a', tetris)
    expect(events).toContainEqual({ type: 'garbage', to: 'b', lines: 4, hole: 0, from: 'a' })
    expect(events[0]).toMatchObject({ type: 'garbage' })
  })

  it('sends nothing for a non-attacking placement', () => {
    const s = makeSession()
    expect(s.move('a', noAttack)).toEqual([])
  })

  it('is authoritative: a snapshot matching the reconstructed board is acked, drift resyncs', () => {
    const s = makeSession()
    const placement = { rows: 0, spin: 'none', piece: 'O', perfectClear: false, combo: 0, b2b: false, streak: 0, cells: [{ x: 3, y: 19 }, { x: 4, y: 19 }] }
    s.move('a', placement)
    // server reconstructed the two O cells at the bottom of row 19
    const correct = emptyBoard().map((row, i) => {
      if (i !== 19) return row
      const r = [...row]
      r[3] = 'O'
      r[4] = 'O'
      return r
    })
    expect(s.checkSnapshot('a', serializeBoard(correct), 0)).toEqual({ status: 'ok' })
    // a diverged snapshot (empty board) is resynced to the authoritative board
    const res = s.checkSnapshot('a', serializeBoard(emptyBoard()), 0)
    expect(res.status).toBe('resync')
    if (res.status === 'resync') expect(res.board).toBe(serializeBoard(correct))
  })

  it('ignores a bogus lock and resyncs the client back to the trusted board', () => {
    const s = makeSession()
    const bogus = { rows: 4, spin: 'none', piece: 'I', perfectClear: false, combo: 0, b2b: false, streak: 0, cells: [{ x: 9, y: 0 }, { x: 9, y: -1 }] }
    expect(s.move('a', bogus)).toEqual([]) // no attack rewarded
    const res = s.checkSnapshot('a', serializeBoard(emptyBoard().map((row, i) => (i === 19 ? ['T', ...row.slice(1)] : row))), 0)
    expect(res.status).toBe('resync')
    if (res.status === 'resync') expect(res.board).toBe(serializeBoard(emptyBoard()))
  })

  it('drops a player cleanly', () => {
    const s = makeSession()
    s.move('a', tetris)
    s.dropPlayer('b')
    expect(s.checkSnapshot('b', serializeBoard(emptyBoard()), 0)).toEqual({ status: 'ok' })
    s.dropPlayer('b')
    expect(s.checkSnapshot('b', serializeBoard(emptyBoard()), 0)).toEqual({ status: 'ok' })
  })

  it('ignores moves and snapshots from unknown players', () => {
    const s = makeSession()
    expect(s.move('nope', tetris)).toEqual([])
    expect(s.checkSnapshot('nope', serializeBoard(emptyBoard()), 0)).toEqual({ status: 'ok' })
  })
})