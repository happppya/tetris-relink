import { describe, expect, it } from 'vitest'
import { Game, type GameSnapshot } from '../engine/game'
import type { InputAction } from '../engine/types'
import type { TickInput } from '../engine/game'

describe('scratch sim debug', () => {
  it('expands one level', () => {
    const HANDLING = { dasFrames: 1, arrFrames: 1, sddFrames: 0 }
    const game = new Game({ handling: HANDLING })
    game.active = { type: 'T', rot: 0, x: 3, y: 3 }
    const scratch = new Game({ seed: 0, handling: HANDLING })
    const snap: GameSnapshot = game.snapshot()
    scratch.restore(snap)
    expect(scratch.active!.type).toBe('T')
    const steps: TickInput[] = [
      { dir: 0, softDrop: false, actions: [] as InputAction[] },
      { dir: 0, softDrop: true, actions: [] as InputAction[] },
      { dir: -1, softDrop: false, actions: [] as InputAction[] },
    ]
    for (const s of steps) {
      scratch.restore(snap)
      scratch.tick(s)
      console.log('after', JSON.stringify(s), '->', JSON.stringify(scratch.active))
    }
    expect(true).toBe(true)
  })
})
