import { describe, expect, it } from 'vitest'
import { Match, type MatchEvent, type MatchSettings } from './match'
import { isMatchPoint } from '../../shared/lobby-settings.ts'

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

describe('spectating', () => {
  it('a spectator sits out the current game without resolving it', () => {
    const m = new Match(ft(7), ['a', 'b', 'c'])
    // switching to spectate marks the player dead but fires NO events: the
    // game continues among the remaining players
    expect(m.spectate('b')).toEqual([])
    expect(m.aliveCount).toBe(2)
    expect(m.status).toBe('active')
    expect(m.round).toBe(1)
    // the spectator can never be the accidental last-man-standing winner:
    // eliminating a leaves c as the sole survivor
    const evs = m.topOut('a')
    expect(ofType(evs, 'game_won')).toEqual([
      { type: 'game_won', round: 1, winnerId: 'c', wins: { a: 0, b: 0, c: 1 } },
    ])
    // the round reset revives everyone, spectator included (the server re-marks
    // them at game start)
    expect(m.round).toBe(2)
    expect(m.aliveCount).toBe(3)
  })

  it('spectating an already-dead player is a no-op', () => {
    const m = new Match(ft(7), ['a', 'b'])
    m.topOut('a')
    expect(m.spectate('a')).toEqual([])
    expect(m.aliveCount).toBe(1)
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

describe('player removal (disconnect)', () => {
  it('a removed 1v1 opponent forfeits the game and the survivor wins the match', () => {
    const m = new Match(ft(3), ['a', 'b'])
    const evs = m.removePlayer('b')
    expect(ofType(evs, 'eliminated')).toEqual([{ type: 'eliminated', playerId: 'b', reason: 'forfeit', alive: 1 }])
    expect(ofType(evs, 'game_won')).toHaveLength(1)
    expect(ofType(evs, 'match_won')[0]).toMatchObject({ winnerId: 'a' })
    expect(m.status).toBe('finished')
    expect(m.winnerId).toBe('a')
  })

  it('a player removed to AFK can rejoin the active match as a live player', () => {
    const m = new Match(ft(7), ['a', 'b', 'c'])
    m.removePlayer('b') // AFK: game continues between a and c
    expect(m.status).toBe('active')
    expect(m.playerList.map((p) => p.id)).toEqual(['a', 'c'])
    // return to the game: back in the roster, alive, no events fired
    expect(m.addPlayer('b')).toEqual([])
    expect(m.aliveCount).toBe(3)
    expect(m.playerList.find((p) => p.id === 'b')).toMatchObject({ id: 'b', alive: true })
    // re-adding someone still present or after finish is a no-op
    expect(m.addPlayer('a')).toEqual([])
    m.removePlayer('a')
    m.removePlayer('b')
    m.removePlayer('c')
    expect(m.status).toBe('finished')
    expect(m.addPlayer('a')).toEqual([])
  })

  it('a removed player is gone permanently and is not revived in later rounds', () => {
    const m = new Match(ft(5), ['a', 'b', 'c'])
    m.removePlayer('c')
    expect(m.status).toBe('active')
    expect(m.playerList.map((p) => p.id)).toEqual(['a', 'b'])
    // a top-outs, so b wins game 1; round 2 must not re-add c
    m.topOut('a')
    expect(m.round).toBe(2)
    expect(m.playerList.map((p) => p.id)).toEqual(['a', 'b'])
    expect(m.wins()).toEqual({ a: 0, b: 1 })
  })

  it('removing the only player ends the match with no winner', () => {
    const m = new Match(ft(3), ['a'])
    m.removePlayer('a')
    expect(m.status).toBe('finished')
    expect(m.winnerId).toBeNull()
  })

  it('a sole remaining player who tops out ends the match instead of replaying forever', () => {
    // when the last player standing is dead (everyone else left or died before
    // them), resolve sees alive=[] with a single player left; that must be
    // match_won for them, never an endless draw-replay against an empty roster
    const m = new Match(ft(3), ['a'])
    const evs = m.topOut('a')
    expect(m.status).toBe('finished')
    expect(m.winnerId).toBe('a')
    expect(ofType(evs, 'match_won')[0]).toMatchObject({ winnerId: 'a' })
    expect(ofType(evs, 'game_draw')).toHaveLength(0)
  })

  it('removing after finish or for an unknown player is a no-op', () => {
    const m = new Match(ft(1), ['a', 'b'])
    m.removePlayer('b')
    expect(m.status).toBe('finished')
    expect(m.removePlayer('a')).toEqual([])
    expect(m.removePlayer('nope')).toEqual([])
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
describe('isMatchPoint', () => {
  it('flags a player one round win away from taking the match', () => {
    // first-to-X: goal 3 -> 2 wins is match point
    expect(isMatchPoint({ a: 2, b: 1 }, { mode: 'firstToX', goal: 3, winBy: 2 }, 'a')).toBe(true)
    expect(isMatchPoint({ a: 1, b: 1 }, { mode: 'firstToX', goal: 3, winBy: 2 }, 'a')).toBe(false)
    // win-by-X: a single win must close the required lead
    expect(isMatchPoint({ a: 3, b: 2 }, { mode: 'winByX', goal: 3, winBy: 2 }, 'a')).toBe(true)
    expect(isMatchPoint({ a: 2, b: 2 }, { mode: 'winByX', goal: 3, winBy: 2 }, 'a')).toBe(false)
    // nobody is on match point at 0 wins
    expect(isMatchPoint({ a: 0, b: 0 }, { mode: 'firstToX', goal: 3, winBy: 2 }, 'a')).toBe(false)
  })
})

describe('Match — reconnect revive', () => {
  it('revive returns a spectated (disconnected) player to the running game', () => {
    const m = new Match(ft(3), ['a', 'b', 'c'])
    m.spectate('a') // sat out when their socket dropped
    expect(m.aliveCount).toBe(2)
    m.revive('a') // rejoin mid-round
    expect(m.aliveCount).toBe(3)
    expect(m.revive('a')).toEqual([]) // idempotent
    expect(m.revive('ghost')).toEqual([]) // unknown id
  })

  it('revive cannot resurrect a player in a finished match', () => {
    const m = new Match(ft(1), ['a', 'b'])
    m.topOut('b')
    expect(m.status).toBe('finished')
    expect(m.aliveCount).toBe(1) // the winner is still marked alive
    expect(m.revive('b')).toEqual([])
    expect(m.aliveCount).toBe(1)
  })
})
