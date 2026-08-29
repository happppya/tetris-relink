import { describe, expect, it } from 'vitest'
import { GameRunner, STEP_MS } from './runner'
import { BOARD_W } from '../engine/types'

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

  it('a topped-out run blocks a restored round until reset unblocks it', () => {
    const runner = new GameRunner({ mode: 'versus', gameOptions: { seed: 1 }, onEnd: () => {} })
    // cram the playfield so incoming pieces pile up to a top-out
    for (const y of [3, 4])
      for (let x = 0; x < BOARD_W; x += 2) runner.game.board[y][x] = 'J'
    for (let i = 0; i < 90; i++) runner.advance(STEP_MS, base)
    expect(runner.game.over).toBe(true)

    // a new round's game_start restores a fresh, playable board (as MatchClient does)
    const snap = runner.game.snapshot()
    const fresh = snap.board.map(() => Array(BOARD_W).fill(null))
    runner.game.restore({ ...snap, board: fresh, over: false, score: 0, frames: 0, active: null })
    const framesBefore = runner.game.frames
    const placedBefore = runner.game.piecesPlaced
    runner.queueActions(['hardDrop'])
    runner.advance(STEP_MS * 2, base)
    // the finalized runner swallows the whole round (the top-out finalized it): no frames run
    expect(runner.game.frames).toBe(framesBefore)
    expect(runner.game.piecesPlaced).toBe(placedBefore)

    // reset un-finalizes the runner for the next round and play resumes
    runner.reset()
    runner.advance(STEP_MS, base) // spawn the round's first piece
    runner.queueActions(['hardDrop'])
    runner.advance(STEP_MS, base)
    expect(runner.game.frames).toBeGreaterThan(framesBefore)
    expect(runner.game.piecesPlaced).toBeGreaterThan(placedBefore)
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