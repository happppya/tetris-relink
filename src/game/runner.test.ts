import { describe, expect, it } from 'vitest'
import { GameRunner, STEP_MS } from './runner'

const base = { dir: 0 as const, softDrop: false }

describe('GameRunner buffered input', () => {
  it('applies a hard drop on the first real simulation step', () => {
    const runner = new GameRunner({ mode: 'versus', gameOptions: { fixedQueue: ['I'] }, onEnd: () => {} })
    runner.queueActions(['hardDrop'])
    runner.advance(STEP_MS, base)
    expect(runner.game.piecesPlaced).toBe(1)
    expect(runner.game.active).not.toBeNull()
    expect(runner.game.board.flat().some((cell) => cell === 'I')).toBe(true)
  })

  it('reports a lock without delaying the local board update', () => {
    const events: string[] = []
    const runner = new GameRunner({
      mode: 'versus',
      gameOptions: { fixedQueue: ['I'] },
      onEvent: (batch) => events.push(...batch.map((event) => event.type)),
      onEnd: () => {},
    })
    runner.queueActions(['hardDrop'])
    runner.advance(STEP_MS, base)
    expect(events).toContain('lock')
    expect(runner.game.piecesPlaced).toBe(1)
  })

  it('never drops an action queued on frames where no tick runs', () => {
    const runner = new GameRunner({ mode: 'versus', gameOptions: { fixedQueue: ['I'] }, onEnd: () => {} })
    // The action is queued exactly once, like a single keypress. On a 144Hz display
    // only ~1 in 2.4 frames crosses a 60Hz step, so lower-refresh-between frames
    // ran here would previously splice the action out and throw it away.
    runner.queueActions(['hardDrop'])

    runner.advance(STEP_MS / 3, base) // acc ~5.6ms, no tick
    expect(runner.game.piecesPlaced).toBe(0) // buffered, not applied
    runner.advance(STEP_MS / 3, base) // acc ~11.1ms, no tick
    expect(runner.game.piecesPlaced).toBe(0)
    runner.advance(STEP_MS / 3, base) // crosses the step -> first tick consumes it
    expect(runner.game.piecesPlaced).toBe(1)
  })

  it('applies queued actions exactly once when one frame spans several ticks', () => {
    const runner = new GameRunner({ mode: 'versus', gameOptions: { fixedQueue: ['I'] }, onEnd: () => {} })
    const before = runner.game.active!.rot
    runner.queueActions(['rotateCW'])
    runner.advance(STEP_MS * 2 + 5, base) // two ticks in a single call
    expect(runner.game.frames).toBe(2)
    expect(runner.game.active!.rot).toBe((before + 1) % 4)
  })

  it('buffers multiple taps and applies each one', () => {
    const runner = new GameRunner({ mode: 'versus', gameOptions: { fixedQueue: ['I'] }, onEnd: () => {} })
    const before = runner.game.active!.rot
    runner.queueActions(['rotateCW', 'rotateCW'])
    runner.advance(STEP_MS, base)
    expect(runner.game.active!.rot).toBe((before + 2) % 4)
  })

  it('applies continuous direction on every tick independent of the action queue', () => {
    const runner = new GameRunner({ mode: 'versus', gameOptions: { fixedQueue: ['O'] }, onEnd: () => {} })
    const start = runner.game.active!.x
    // Hold a direction across several ticking frames with an empty action queue.
    for (let i = 0; i < 5; i++) runner.advance(STEP_MS, { dir: 1 as const, softDrop: false })
    expect(runner.game.active!.x).toBeGreaterThan(start)
  })

  it('drops buffered actions when clearActions is called (pause)', () => {
    const runner = new GameRunner({ mode: 'versus', gameOptions: { fixedQueue: ['I'] }, onEnd: () => {} })
    runner.queueActions(['hardDrop'])
    runner.clearActions()
    runner.advance(STEP_MS * 2, base)
    expect(runner.game.piecesPlaced).toBe(0)
  })

  it('keeps directional input responsive when only direction (not taps) is held', () => {
    const runner = new GameRunner({ mode: 'versus', gameOptions: { fixedQueue: ['I'] }, onEnd: () => {} })
    // Steady tick stream, like a 60Hz display; no taps, all held-move handled by dir.
    for (let i = 0; i < 3; i++) runner.advance(STEP_MS, { dir: -1 as const, softDrop: false })
    expect(runner.game.frames).toBe(3)
  })
})