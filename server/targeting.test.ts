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
})
