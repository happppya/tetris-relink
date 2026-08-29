import { describe, expect, it } from 'vitest'
import { Session } from './session.ts'

const members = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]
const settings = { mode: 'firstToX' as const, goal: 3, winBy: 2 }
const lock = { rows: 4, spin: 'none' as const, piece: 'I' as const, perfectClear: false, combo: 0, b2b: false, streak: 0 }

const garbageTo = (events: ReturnType<Session['move']>) => events.find((event) => event.type === 'garbage')

describe('session targeting', () => {
  it.each([
    ['manual', 'c', 'c'],
    ['revenge', undefined, 'b'],
    ['random', undefined, 'b'],
  ] as const)('%s chooses its target', (mode, selected, target) => {
    const session = new Session('m', members, settings)
    if (mode === 'revenge') session.move('b', lock)
    session.setTarget('a', mode, selected)
    expect(garbageTo(session.move('a', lock))).toMatchObject({ to: target, lines: 4 })
  })

  it('keeps revenge ordering by most recent attacker', () => {
    const session = new Session('m', members, settings)
    session.move('b', lock)
    session.move('c', lock)
    session.setTarget('a', 'revenge')
    expect(garbageTo(session.move('a', lock))).toMatchObject({ to: 'c' })
  })

  it('rejects a self or unknown manual target and falls back', () => {
    const session = new Session('m', members, settings)
    expect(session.setTarget('a', 'manual', 'a')[0]).toMatchObject({ targetId: 'b' })
    expect(session.setTarget('a', 'manual', 'missing')[0]).toMatchObject({ targetId: 'b' })
  })

  it('never targets an eliminated/out-of-game player', () => {
    const session = new Session('m', members, settings)
    session.eliminate('b')
    // random mode routes only among living opponents
    expect(garbageTo(session.move('a', lock))).toMatchObject({ to: 'c' })
  })

  it('reassigns a manual target that was eliminated instead of hitting them', () => {
    const session = new Session('m', members, settings)
    session.eliminate('c')
    expect(session.setTarget('a', 'manual', 'c')[0]).toMatchObject({ targetId: 'b' })
    expect(garbageTo(session.move('a', lock))).toMatchObject({ to: 'b' })
  })

  it('falls back away from an eliminated revenge attacker to a living opponent', () => {
    const session = new Session('m', members, settings)
    session.move('b', lock) // b attacks a -> a's most recent attacker is b
    session.eliminate('b')
    session.setTarget('a', 'revenge')
    // b is out of the game, so revenge must not route back to it
    expect(garbageTo(session.move('a', lock))).toMatchObject({ to: 'c' })
  })

  it('routes to no one when every potential target is eliminated', () => {
    const session = new Session('m', members, settings)
    session.eliminate('b')
    session.eliminate('c')
    expect(garbageTo(session.move('a', lock))).toBeUndefined()
  })

  it('newGame re-enables everyone and resets targeting state', () => {
    const session = new Session('m', members, settings)
    session.move('c', lock) // a's most recent attacker is c
    session.setTarget('a', 'revenge')
    expect(garbageTo(session.move('a', lock))).toMatchObject({ to: 'c' }) // revenge -> c
    session.eliminate('b')
    session.eliminate('c')
    expect(garbageTo(session.move('a', lock))).toBeUndefined() // no living opponents

    session.newGame() // a fresh game starts

    // everyone is eligible again and the mode fell back to random (first living)
    expect(garbageTo(session.move('a', lock))).toMatchObject({ to: 'b' })
  })
})
