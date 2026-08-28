import { describe, expect, it } from 'vitest'
import { Match, type MatchEvent, type MatchSettings } from './match'

const ft = (goal: number): MatchSettings => ({ mode: 'firstToX', goal, winBy: 2 })
const wb = (winBy: number): MatchSettings => ({ mode: 'winByX', goal: 99, winBy })

const ofType = <T extends MatchEvent['type']>(evs: MatchEvent[], type: T) =>
  evs.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type)

describe('Match — initial state', () => {
  it('starts round 1 with everyone alive at zero wins', () => {
    const m = new Match(ft(7), ['a', 'b', 'c'])
    expect(m.round).toBe(1)
    expect(m.status).toBe('active')
    expect(m.winnerId).toBeNull()
    expect(m.lastGameWinnerId).toBeNull()
    expect(m.lastGameDraw).toBe(false)
    expect(m.aliveCount).toBe(3)
    expect(m.alivePlayerIds()).toEqual(['a', 'b', 'c'])
    expect(m.wins()).toEqual({ a: 0, b: 0, c: 0 })
    expect(m.playerList).toEqual([
      { id: 'a', wins: 0, alive: true },
      { id: 'b', wins: 0, alive: true },
      { id: 'c', wins: 0, alive: true },
    ])
  })

  it('clamps invalid settings', () => {
    const m = new Match({ mode: 'bogus', goal: 0, winBy: 0 } as unknown as MatchSettings, ['a', 'b'])
    expect(m.settings).toEqual({ mode: 'firstToX', goal: 1, winBy: 1 })
  })
})

describe('last-man-standing elimination', () => {
  it('a single top-out eliminates the player and the game continues', () => {
    const m = new Match(ft(7), ['a', 'b', 'c'])
    expect(m.topOut('a')).toEqual([{ type: 'eliminated', playerId: 'a', reason: 'topout', alive: 2 }])
    expect(m.aliveCount).toBe(2)
    expect(m.status).toBe('active')
    expect(m.round).toBe(1)
  })

  it('the last survivor wins the game and a fresh game starts', () => {
    const m = new Match(ft(7), ['a', 'b', 'c'])
    m.topOut('a')
    const evs = m.topOut('b')
    expect(ofType(evs, 'eliminated')).toEqual([{ type: 'eliminated', playerId: 'b', reason: 'topout', alive: 1 }])
    expect(ofType(evs, 'game_won')).toEqual([
      { type: 'game_won', round: 1, winnerId: 'c', wins: { a: 0, b: 0, c: 1 } },
    ])
    expect(m.lastGameWinnerId).toBe('c')
    expect(m.lastGameDraw).toBe(false)
    expect(m.round).toBe(2)
    expect(m.aliveCount).toBe(3)
    expect(m.status).toBe('active')
  })

  it('eliminating an already-eliminated player is a no-op', () => {
    const m = new Match(ft(7), ['a', 'b', 'c'])
    m.topOut('a')
    expect(m.topOut('a')).toEqual([])
    expect(m.aliveCount).toBe(2)
  })

  it('unknown player ids are ignored', () => {
    const m = new Match(ft(7), ['a', 'b'])
    expect(m.topOut('nope')).toEqual([])
    expect(m.aliveCount).toBe(2)
  })
})

describe('first-to-X', () => {
  it('ends the match when a player reaches the goal, even while trailing opponents', () => {
    const m = new Match(ft(3), ['a', 'b'])
    m.topOut('b')
    m.topOut('b')
    m.topOut('b')
    expect(m.status).toBe('finished')
    expect(m.winnerId).toBe('a')
    expect(m.wins()).toEqual({ a: 3, b: 0 })
  })

  it('keeps going until the goal is reached', () => {
    const m = new Match(ft(3), ['a', 'b'])
    const winA = () => m.topOut('b')
    const winB = () => m.topOut('a')
    winA()
    winB()
    winA()
    winB()
    expect(m.status).toBe('active')
    expect(m.wins()).toEqual({ a: 2, b: 2 })
    const evs = winA()
    expect(ofType(evs, 'game_won')).toHaveLength(1)
    expect(ofType(evs, 'match_won')).toEqual([
      { type: 'match_won', round: 5, winnerId: 'a', wins: { a: 3, b: 2 } },
    ])
    expect(m.status).toBe('finished')
    expect(m.winnerId).toBe('a')
  })

  it('does not end on lead alone (win-by semantics do not leak in)', () => {
    const m = new Match(ft(5), ['a', 'b'])
    m.topOut('b')
    m.topOut('b')
    expect(m.status).toBe('active')
    expect(m.wins()).toEqual({ a: 2, b: 0 })
  })
})

describe('win-by-X', () => {
  it('only ends when a player leads by at least X games', () => {
    const m = new Match(wb(2), ['a', 'b'])
    const winA = () => m.topOut('b')
    const winB = () => m.topOut('a')
    winA()
    expect(m.status).toBe('active') // 1-0, lead 1
    winB()
    expect(m.status).toBe('active') // 1-1, tie
    winA()
    expect(m.status).toBe('active') // 2-1, lead 1
    const evs = winA() // 3-1, lead 2
    expect(ofType(evs, 'match_won')).toHaveLength(1)
    expect(m.status).toBe('finished')
    expect(m.winnerId).toBe('a')
    expect(m.wins()).toEqual({ a: 3, b: 1 })
  })

  it('a tie never ends the match', () => {
    const m = new Match(wb(2), ['a', 'b'])
    m.topOut('b')
    m.topOut('a')
    m.topOut('b')
    m.topOut('a')
    expect(m.status).toBe('active')
    expect(m.wins()).toEqual({ a: 2, b: 2 })
  })

  it('measures the lead against the second-best player with 3+ players', () => {
    const m = new Match(wb(2), ['a', 'b', 'c'])
    const aWins = () => m.topOutSimultaneous(['b', 'c'])
    const bWins = () => m.topOutSimultaneous(['a', 'c'])
    aWins()
    bWins()
    aWins()
    expect(m.status).toBe('active') // 2-1-0, lead 1
    const evs = aWins() // 3-1-0, lead 2
    expect(ofType(evs, 'match_won')).toHaveLength(1)
    expect(m.status).toBe('finished')
    expect(m.winnerId).toBe('a')
  })

  it('win-by-1 ends the match on any lead', () => {
    const m = new Match(wb(1), ['a', 'b'])
    m.topOut('b')
    expect(m.status).toBe('finished')
    expect(m.winnerId).toBe('a')
  })
})

describe('draws', () => {
  it('a simultaneous top-out of the final players is a draw: no win, game replayed', () => {
    const m = new Match(ft(7), ['a', 'b'])
    const evs = m.topOutSimultaneous(['a', 'b'])
    expect(ofType(evs, 'game_draw')).toEqual([{ type: 'game_draw', round: 1 }])
    expect(m.lastGameDraw).toBe(true)
    expect(m.lastGameWinnerId).toBeNull()
    expect(m.wins()).toEqual({ a: 0, b: 0 })
    expect(m.round).toBe(2)
    expect(m.aliveCount).toBe(2)
    expect(m.status).toBe('active')
  })

  it('the replayed game resolves normally', () => {
    const m = new Match(ft(7), ['a', 'b'])
    m.topOutSimultaneous(['a', 'b'])
    const evs = m.topOut('b')
    expect(ofType(evs, 'game_won')).toEqual([
      { type: 'game_won', round: 2, winnerId: 'a', wins: { a: 1, b: 0 } },
    ])
    expect(m.lastGameWinnerId).toBe('a')
  })

  it('a simultaneous top-out that leaves a survivor is a win, not a draw', () => {
    const m = new Match(ft(7), ['a', 'b', 'c'])
    const evs = m.topOutSimultaneous(['a', 'b'])
    expect(ofType(evs, 'eliminated')).toHaveLength(2)
    expect(ofType(evs, 'game_draw')).toHaveLength(0)
    expect(ofType(evs, 'game_won')[0]).toMatchObject({ round: 1, winnerId: 'c' })
    expect(m.wins()).toEqual({ a: 0, b: 0, c: 1 })
  })

  it('duplicate ids in a batch only eliminate once', () => {
    const m = new Match(ft(7), ['a', 'b', 'c'])
    const evs = m.topOutSimultaneous(['a', 'a', 'b'])
    expect(ofType(evs, 'eliminated')).toHaveLength(2)
    // c survives, so the game ends and a fresh game starts
    expect(ofType(evs, 'game_won')[0]).toMatchObject({ winnerId: 'c' })
    expect(m.round).toBe(2)
    expect(m.aliveCount).toBe(3)
  })
})

describe('forfeits', () => {
  it('a forfeit ends the game like a top-out, with the reason recorded', () => {
    const m = new Match(ft(7), ['a', 'b'])
    const evs = m.forfeit('b')
    expect(ofType(evs, 'eliminated')).toEqual([{ type: 'eliminated', playerId: 'b', reason: 'forfeit', alive: 1 }])
    expect(ofType(evs, 'game_won')).toEqual([
      { type: 'game_won', round: 1, winnerId: 'a', wins: { a: 1, b: 0 } },
    ])
    expect(m.round).toBe(2)
  })

  it('forfeiting an already-eliminated player is a no-op', () => {
    const m = new Match(ft(7), ['a', 'b', 'c'])
    m.topOut('a')
    expect(m.forfeit('a')).toEqual([])
  })
})

describe('match end state', () => {
  it('freezes the match after it is finished', () => {
    const m = new Match(ft(1), ['a', 'b'])
    m.topOut('b')
    expect(m.status).toBe('finished')
    expect(m.winnerId).toBe('a')
    expect(m.topOut('a')).toEqual([])
    expect(m.forfeit('a')).toEqual([])
    expect(m.topOutSimultaneous(['a', 'b'])).toEqual([])
    expect(m.winnerId).toBe('a')
  })
})