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

const garbageRows = (board: string) => board.split('/').filter((row) => row.includes('G')).length

describe('Session', () => {
  it('starts every player on an empty board at score 0', () => {
    const s = makeSession()
    expect(s.summary.players).toHaveLength(3)
    for (const p of s.summary.players) {
      expect(s.checkSnapshot(p.id, serializeBoard(emptyBoard()), 0)).toEqual({ status: 'ok' })
    }
  })

  it('computes the attack from the room table and routes it to a target', () => {
    const s = makeSession()
    const events = s.move('a', tetris)
    expect(events).toEqual([{ type: 'garbage', to: 'b', lines: 4, hole: 0, from: 'a' }])
    // the sender's score accrues the attack
    expect(s.checkSnapshot('a', serializeBoard(emptyBoard()), 4)).toEqual({ status: 'ok' })
    // the target's board gained 4 deterministic garbage rows
    const res = s.checkSnapshot('b', serializeBoard(emptyBoard()), 0)
    expect(res.status).toBe('resync')
    if (res.status === 'resync') expect(garbageRows(res.board)).toBe(4)
  })

  it('sends nothing for a non-attacking placement', () => {
    const s = makeSession()
    expect(s.move('a', noAttack)).toEqual([])
    expect(s.checkSnapshot('a', serializeBoard(emptyBoard()), 0)).toEqual({ status: 'ok' })
  })

  it('detects score drift and board drift', () => {
    const s = makeSession()
    s.move('a', tetris)
    expect(s.checkSnapshot('a', serializeBoard(emptyBoard()), 0).status).toBe('resync')
    expect(s.checkSnapshot('a', serializeBoard(emptyBoard()), 4).status).toBe('ok')
    const drifted = serializeBoard(emptyBoard().map((row, i) => (i === 19 ? ['T', ...row.slice(1)] : row)))
    expect(s.checkSnapshot('a', drifted, 4).status).toBe('resync')
  })

  it('drops a player: board resets, garbage cleared', () => {
    const s = makeSession()
    s.move('a', tetris) // b takes 4 garbage
    s.dropPlayer('b')
    expect(s.checkSnapshot('b', serializeBoard(emptyBoard()), 0)).toEqual({ status: 'ok' })
  })

  it('ignores moves and snapshots from unknown players', () => {
    const s = makeSession()
    expect(s.move('nope', tetris)).toEqual([])
    expect(s.checkSnapshot('nope', serializeBoard(emptyBoard()), 0)).toEqual({ status: 'ok' })
  })
})