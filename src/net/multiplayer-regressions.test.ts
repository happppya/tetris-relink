import { describe, expect, it } from 'vitest'
import { Game } from '../engine/game'
import { GameRunner, STEP_MS } from '../game/runner'
import { Match } from '../engine/match.ts'
import { MatchClient } from './match-client'
import { isMatchPoint } from '../../shared/lobby-settings.ts'
import { emptyBoard, serializeBoard } from '../../shared/board.ts'
import { Session } from '../../server/session.ts'
import { applyLock, createAuthority, pendingGarbage, queueGarbage } from '../../server/authority.ts'
import { roundScores } from '../../server/round-scores.ts'
import type { ServerMessage } from '../../shared/protocol.ts'
import type { PieceType } from '../engine/types'

// ---------------------------------------------------------------------------
// Reproductions for the bugs documented in notes/bugs.md.
//
// These tests pin the INTENDED (fixed) behavior and currently FAIL against the
// live code. Fix each bug, then these flip green. Do not delete them — they are
// the regression net for the fixes that notes/bugs.md is driving.
// ---------------------------------------------------------------------------

const ft = (goal: number) => ({ mode: 'firstToX' as const, goal, winBy: 2 })

describe('BUG 01 — scoreboard shows the running match score (not per-round 1/0)', () => {
  it('credits +1 to the running tally for every round a player wins', () => {
    const m = new Match(ft(3), ['a', 'b'])
    m.topOut('b') // a wins round 1
    m.topOut('b') // a wins round 2
    expect(m.wins()).toEqual({ a: 2, b: 0 })
    // the scoreboard must reflect the actual running score, not "winner +1 each
    // round regardless of how many they already have"
    expect(roundScores(m, 'a')).toEqual({ a: 2, b: 0 })
  })

  it('a 1:1 tie after both players won once shows 1 : 1, not 1 : 0', () => {
    const m = new Match(ft(3), ['a', 'b'])
    m.topOut('b') // a
    m.topOut('a') // b
    expect(roundScores(m, 'b')).toEqual({ a: 1, b: 1 })
  })
})

describe('BUG 02 — garbage holes are randomized across columns (never pinned to 0)', () => {
  const members = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
  const settings = { mode: 'firstToX' as const, goal: 3, winBy: 2 }
  const lock = { rows: 4, spin: 'none' as const, piece: 'I' as const, perfectClear: false, combo: 0, b2b: false, streak: 0 }

  it('routes each attack to a varied hole column, not always column 0', () => {
    const session = new Session('m', members, settings)
    const seen = new Set<number>()
    for (let i = 0; i < 20; i++) {
      const garbage = session.move('a', lock).find((event) => event.type === 'garbage')
      expect(garbage).toBeDefined()
      seen!.add(garbage!.hole)
    }
    // reaching column 0 every single time is the bug; a randomized hole must
    // spread across the board's width
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('BUG 03 — APM resets per round (not measured on last round sent lines)', () => {
  function apmClient(fixedQueue: PieceType[]) {
    const game = new Game({ mode: 'versus', sendsGarbage: true, fixedQueue })
    let handler: ((msg: ServerMessage) => void) | null = null
    new MatchClient({
      game,
      matchId: 'm',
      send: () => {},
      onMessage: (h) => {
        handler = h
        return () => {
          handler = null
        }
      },
      selfId: () => 'a',
    })
    return { game, feed: (msg: ServerMessage) => handler!(msg) }
  }

  it('a fresh round starts with 0 sent lines, so APM is not inflated by round 1', () => {
    const { game, feed } = apmClient(['I'])
    // round 1: 8 lines sent ~10s in
    game.sentLines = 8
    game.frames = 600
    expect(game.apm).toBe(48) // sanity: 8 * 3600 / 600

    // round 2 begins (game_start resets the clock but, in the bug, NOT sentLines)
    feed({ type: 'game_start', round: 2, players: [], board: serializeBoard(emptyBoard()) })
    game.tick({ dir: 0, softDrop: false, actions: [] })
    expect(game.frames).toBe(1)
    // intended: nothing has been SENT yet in round 2 -> APM 0, not 8*3600/1
    expect(game.apm).toBe(0)
  })
})

describe('BUG 04 — inputs are blocked while the scoreboard (intermission) is up', () => {
  const base = { dir: 0 as const, softDrop: false }

  it('a key press during the scoreboard must not place a piece when play resumes', () => {
    // The MultiplayerGameScreen drains-and-discards during the intermission
    // (it calls `runner.clearActions()` while the scoreboard is up). This pins
    // the contract that footage from the intermission buffer never survives into
    // the resumed round.
    const runner = new GameRunner({ mode: 'versus', gameOptions: { fixedQueue: ['I'] }, onEnd: () => {} })
    // a round ended and the screen reset the runner for the next round
    runner.reset()
    // while the scoreboard is up the screen still drains input, then discards
    runner.queueActions(['hardDrop'])
    runner.clearActions()
    // the scoreboard clears and play resumes on the next round
    runner.advance(STEP_MS, base)
    // the accidental hard drop during the scoreboard did NOT fire
    expect(runner.game.piecesPlaced).toBe(0)
  })
})

describe('BUG 05 — a winner is not on match point (shows WINNER, not MATCH POINT)', () => {
  it('a player who already reached the goal is a winner, not on match point', () => {
    const settings = ft(3)
    // genuine match point: one win away
    expect(isMatchPoint({ a: 2, b: 1 }, settings, 'a')).toBe(true)
    // already WON (reached the goal): no longer on match point
    expect(isMatchPoint({ a: 3, b: 1 }, settings, 'a')).toBe(false)
  })
})

describe('BUG 06 — garbage is delivered at most 8 lines at a time (rest stays owed)', () => {
  it('engine: a non-clearing placement applies only 8 of a 20-line queue', () => {
    const g = new Game({ fixedQueue: ['I', 'O'] })
    g.receiveGarbage(20)
    expect(g.pendingGarbage).toBe(20)
    // a non-clearing placement lets queued garbage land
    g.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    // 8 land, 12 remain owed (the bug applies ALL 20 at once)
    expect(g.pendingGarbage).toBe(12)
  })

  it('authority: the server board only takes 8 of a 20-line queue per placement', () => {
    const auth = createAuthority()
    queueGarbage(auth, 20, 0)
    expect(pendingGarbage(auth)).toBe(20)
    applyLock(auth, { cells: [{ x: 0, y: 19 }, { x: 1, y: 19 }], rows: 0, spin: 'none', piece: 'O', combo: 0, b2b: false, streak: 0 })
    // the authoritative board must agree with the capped engine delivery
    expect(pendingGarbage(auth)).toBe(12)
  })
})