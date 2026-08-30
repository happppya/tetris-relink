import { describe, expect, it } from 'vitest'
import { Session } from './session.ts'
import { emptyBoard, fourWideBoard, serializeBoard } from '../shared/board.ts'
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

describe('four-wide sessions', () => {
  const wideSettings = { mode: 'firstToX' as const, goal: 3, winBy: 2, fourWide: true }

  it('walls the authoritative boards: an empty four-wide snapshot matches, a plain one does not', () => {
    const s = new Session('m1', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], wideSettings)
    expect(s.checkSnapshot('a', serializeBoard(fourWideBoard()))).toEqual({ status: 'ok' })
    expect(s.checkSnapshot('a', serializeBoard(emptyBoard())).status).toBe('resync')
  })

  it('rejects a placement that reports cells inside the wall', () => {
    const s = new Session('m1', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], wideSettings)
    // placing into the grey side wall (column 0) is invalid: no attack, no mutation
    expect(s.move('a', { ...tetris, cells: [{ x: 0, y: 19 }] })).toEqual([])
    expect(s.checkSnapshot('a', serializeBoard(fourWideBoard()))).toEqual({ status: 'ok' })
  })

  it('clamps garbage holes into the centre 4 columns and tells the client the clamped hole', () => {
    const s = new Session('m1', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], wideSettings)
    const events = s.move('a', tetris)
    const g = events.find((e) => e.type === 'garbage')
    expect(g).toMatchObject({ to: 'b', lines: 4 })
    if (g && g.type === 'garbage') {
      expect(g.hole).toBeGreaterThanOrEqual(3)
      expect(g.hole).toBeLessThanOrEqual(6)
    }
    // a fresh game keeps the walls too
    s.newGame()
    expect(s.checkSnapshot('b', serializeBoard(fourWideBoard()))).toEqual({ status: 'ok' })
  })
})

describe('Session', () => {
  it('starts every player present and accepts an empty snapshot', () => {
    const s = makeSession()
    expect(s.summary.players).toHaveLength(3)
    for (const p of s.summary.players) {
      expect(s.checkSnapshot(p.id, serializeBoard(emptyBoard()))).toEqual({ status: 'ok' })
    }
  })

  it('computes the attack from the room table and routes it to a target', () => {
    const s = makeSession()
    const events = s.move('a', tetris)
    expect(events[0]).toMatchObject({ type: 'garbage', to: 'b', lines: 4, from: 'a' })
    const g = events.find((e) => e.type === 'garbage')
    if (g && g.type === 'garbage') {
      // the hole is randomized across the board width, never pinned to 0
      expect(g.hole).toBeGreaterThanOrEqual(0)
      expect(g.hole).toBeLessThanOrEqual(9)
    }
  })

  it('sends nothing for a non-attacking placement', () => {
    const s = makeSession()
    expect(s.move('a', noAttack)).toEqual([])
  })

  it('is authoritative: a snapshot matching the reconstructed board is acked, drift resyncs', () => {
    const s = makeSession()
    const placement: LockEvent = { rows: 0, spin: 'none', piece: 'O', perfectClear: false, combo: 0, b2b: false, streak: 0, cells: [{ x: 3, y: 19 }, { x: 4, y: 19 }] }
    s.move('a', placement)
    // server reconstructed the two O cells at the bottom of row 19
    const correct = emptyBoard().map((row, i) => {
      if (i !== 19) return row
      const r = [...row]
      r[3] = 'O'
      r[4] = 'O'
      return r
    })
    expect(s.checkSnapshot('a', serializeBoard(correct))).toEqual({ status: 'ok' })
    // a diverged snapshot (empty board) is resynced to the authoritative board
    const res = s.checkSnapshot('a', serializeBoard(emptyBoard()))
    expect(res.status).toBe('resync')
    if (res.status === 'resync') expect(res.board).toBe(serializeBoard(correct))
  })

  it('ignores a bogus lock and resyncs the client back to the trusted board', () => {
    const s = makeSession()
    const bogus: LockEvent = { rows: 4, spin: 'none', piece: 'I', perfectClear: false, combo: 0, b2b: false, streak: 0, cells: [{ x: 9, y: 0 }, { x: 9, y: -1 }] }
    expect(s.move('a', bogus)).toEqual([]) // no attack rewarded
    const res = s.checkSnapshot('a', serializeBoard(emptyBoard().map((row, i) => (i === 19 ? ['T', ...row.slice(1)] : row))))
    expect(res.status).toBe('resync')
    if (res.status === 'resync') expect(res.board).toBe(serializeBoard(emptyBoard()))
  })

  it('drops a player cleanly', () => {
    const s = makeSession()
    s.move('a', tetris)
    s.dropPlayer('b')
    expect(s.checkSnapshot('b', serializeBoard(emptyBoard()))).toEqual({ status: 'ok' })
    s.dropPlayer('b')
    expect(s.checkSnapshot('b', serializeBoard(emptyBoard()))).toEqual({ status: 'ok' })
  })

  it('ignores moves and snapshots from unknown players', () => {
    const s = makeSession()
    expect(s.move('nope', tetris)).toEqual([])
    expect(s.checkSnapshot('nope', serializeBoard(emptyBoard()))).toEqual({ status: 'ok' })
  })

  it('a removed player can rejoin with a fresh authority', () => {
    const s = makeSession()
    const placement: LockEvent = { rows: 0, spin: 'none', piece: 'O', perfectClear: false, combo: 0, b2b: false, streak: 0, cells: [{ x: 3, y: 19 }, { x: 4, y: 19 }] }
    s.move('a', placement)
    // a's authority board now differs from an empty board
    expect(s.checkSnapshot('a', serializeBoard(emptyBoard())).status).toBe('resync')
    s.remove('a')
    expect(s.has('a')).toBe(false)
    expect(s.checkSnapshot('a', serializeBoard(emptyBoard()))).toEqual({ status: 'ok' })
    s.add({ id: 'a', name: 'A' })
    expect(s.has('a')).toBe(true)
    // fresh authority: an empty snapshot matches, no stale board or garbage
    expect(s.checkSnapshot('a', serializeBoard(emptyBoard()))).toEqual({ status: 'ok' })
    expect(s.pendingGarbageOf('a')).toBe(0)
    expect(s.move('a', tetris)).toHaveLength(2)
  })

  it('never targets a spectator and keeps spectating out of the active count', () => {
    const s = makeSession()
    s.setSpectating('c', true)
    expect(s.isSpectating('c')).toBe(true)
    expect(s.activePlayerCount()).toBe(2)
    expect(s.spectatorIds()).toEqual(['c'])
    // a's attack must route to b (the only non-spectating opponent)
    const route = s.move('a', tetris)
    expect(route[0]).toMatchObject({ type: 'garbage', to: 'b', lines: 4, from: 'a' })
    const hole = route.find((e) => e.type === 'garbage')
    if (hole && hole.type === 'garbage') {
      expect(hole.hole).toBeGreaterThanOrEqual(0)
      expect(hole.hole).toBeLessThanOrEqual(9)
    }
    // a spectator's own attack is not routed anywhere
    expect(s.move('c', tetris)).toEqual([])
    // toggling back restores eligibility
    s.setSpectating('c', false)
    expect(s.isSpectating('c')).toBe(false)
    expect(s.activePlayerCount()).toBe(3)
  })
})