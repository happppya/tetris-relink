import { describe, expect, it } from 'vitest'
import { Game, detectSpin, type GameEvent } from './game'
import { TOTAL_H, BOARD_W, type Cell } from './types'

const IDLE = { dir: 0 as const, softDrop: false, actions: [] }

function hardDropPiece(game: Game, action: 'rotateCW' | 'rotateCCW' | null = null): void {
  game.tick({ dir: 0, softDrop: false, actions: action ? [action] : [] })
  game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
}

describe('Game basics', () => {
  it('hard drop locks the piece at the floor and spawns the next piece immediately', () => {
    const game = new Game({ seed: 1 })
    hardDropPiece(game)
    expect(game.board[TOTAL_H - 1].some((c) => c !== null)).toBe(true)
    expect(game.active).not.toBeNull()
    expect(game.piecesPlaced).toBe(1)
  })

  it('clears a full row with zero delay', () => {
    const game = new Game({ seed: 1 })
    const bottom = TOTAL_H - 1
    for (let x = 0; x < BOARD_W; x++) game.board[bottom][x] = 'J'
    game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    expect(game.lines).toBe(1)
    expect(game.board[0].every((c) => c === null)).toBe(true)
    expect(game.active).not.toBeNull()
  })

  it('scores points on line clears', () => {
    const game = new Game({ seed: 1 })
    const bottom = TOTAL_H - 1
    for (let x = 0; x < BOARD_W; x++) game.board[bottom][x] = 'J'
    const before = game.score
    game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    expect(game.score).toBeGreaterThanOrEqual(before + 100)
  })

  it('game overs when the spawn is blocked', () => {
    const game = new Game({ seed: 1 })
    for (const y of [3, 4]) {
      for (let x = 0; x < BOARD_W; x += 2) game.board[y][x] = 'J'
    }
    for (let i = 0; i < 40; i++) game.tick(IDLE)
    expect(game.over).toBe(true)
  })

  it('tracks pieces placed and frames', () => {
    const game = new Game({ seed: 1 })
    hardDropPiece(game)
    hardDropPiece(game)
    expect(game.piecesPlaced).toBe(2)
    expect(game.frames).toBe(4)
  })

  it('hold swaps pieces and blocks until next lock', () => {
    const game = new Game({ seed: 5 })
    const first = game.active!.type
    game.tick({ dir: 0, softDrop: false, actions: ['hold'] })
    expect(game.hold).toBe(first)
    expect(game.active!.type).not.toBe(first)
    expect(() => game.tick({ dir: 0, softDrop: false, actions: ['hold'] })).not.toThrow()
  })
})

describe('Handling timings', () => {
  it('DAS delays autoshift then ARR repeats', () => {
    const game = new Game({ seed: 3, handling: { dasFrames: 5, arrFrames: 2, sddFrames: 2 } })
    const startX = game.active!.x
    const input = { ...IDLE, dir: 1 as const }
    game.tick(input)
    expect(game.active!.x).toBe(startX + 1)
    for (let i = 0; i < 5; i++) game.tick(input)
    expect(game.active!.x).toBe(startX + 1)
    game.tick(input)
    expect(game.active!.x).toBe(startX + 2)
  })

  it('ARR 0 moves to the wall instantly after DAS', () => {
    const game = new Game({ seed: 3, handling: { dasFrames: 3, arrFrames: 0, sddFrames: 2 } })
    const input = { ...IDLE, dir: -1 as const }
    for (let i = 0; i < 6; i++) game.tick(input)
    expect(game.active!.x).toBeLessThanOrEqual(1)
  })

  it('soft drop delay steps the piece down and reaches the ghost', () => {
    const game = new Game({ seed: 3, handling: { dasFrames: 8, arrFrames: 2, sddFrames: 2 } })
    const startY = game.active!.y
    for (let i = 0; i < 40; i++) game.tick({ dir: 0, softDrop: true, actions: [] })
    expect(game.active!.y).toBeGreaterThan(startY + 10)
    expect(game.active!.y).toBe(game.ghostPiece!.y)
  })

  it('zero soft drop delay drops instantly to the ghost on the first frame', () => {
    const game = new Game({ seed: 3, handling: { dasFrames: 8, arrFrames: 2, sddFrames: 0 } })
    const startY = game.active!.y
    game.tick({ dir: 0, softDrop: true, actions: [] })
    expect(game.active!.y).toBe(game.ghostPiece!.y)
    expect(game.active!.y).toBeGreaterThan(startY)
  })

  it('slow soft drop delay falls at the configured interval', () => {
    const game = new Game({ seed: 3, handling: { dasFrames: 8, arrFrames: 2, sddFrames: 10 } })
    const startY = game.active!.y
    for (let i = 0; i < 20; i++) game.tick({ dir: 0, softDrop: true, actions: [] })
    // ~1 row per 10 frames from SDD alone (level 1 gravity is slower than that)
    expect(game.active!.y - startY).toBeGreaterThanOrEqual(2)
    expect(game.active!.y - startY).toBeLessThanOrEqual(4)
  })
})

describe('APM tracking', () => {
  const fillRow = (game: Game) => {
    for (let x = 0; x < BOARD_W; x++) game.board[TOTAL_H - 1][x] = 'J'
  }
  const clearOnce = (game: Game) => game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })

  it('is zero before any attacks', () => {
    const game = new Game({ seed: 1 })
    hardDropPiece(game)
    expect(game.sentLines).toBe(0)
    expect(game.apm).toBe(0)
  })

  it('tracks attack lines and APM even when not sending garbage (sprint/blitz)', () => {
    const game = new Game({ seed: 11, attack: { single: 2 } })
    fillRow(game)
    clearOnce(game)
    expect(game.sentLines).toBe(2)
    expect(game.apm).toBeCloseTo((2 * 3600) / game.frames)
  })

  it('still emits attack events in versus mode', () => {
    const game = new Game({ seed: 11, attack: { single: 2 }, sendsGarbage: true })
    fillRow(game)
    const events = clearOnce(game)
    expect(events).toContainEqual({ type: 'attack', lines: 2 })
    expect(game.sentLines).toBe(2)
    expect(game.apm).toBeGreaterThan(0)
  })

  it('suppresses attack events outside versus but keeps the counter', () => {
    const game = new Game({ seed: 11, attack: { single: 2 } })
    fillRow(game)
    const events = clearOnce(game)
    expect(events.some((e) => e.type === 'attack')).toBe(false)
    expect(game.sentLines).toBe(2)
  })
})

describe('Streak mechanic', () => {
  const ISOLATE = { comboStep: 0, b2bBonus: 0 }

  function setupTetrisGap(game: Game) {
    for (let y = TOTAL_H - 4; y < TOTAL_H; y++)
      for (let x = 0; x < BOARD_W; x++) if (x !== 7) game.board[y][x] = 'J'
  }

  function dropTetris(game: Game): GameEvent[] {
    setupTetrisGap(game)
    game.active = { type: 'I', rot: 1, x: 5, y: 3 }
    return game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
  }

  it('builds streak over consecutive tetris clears', () => {
    const game = new Game({ seed: 1, attack: ISOLATE })
    expect(game.streak).toBe(0)
    for (let i = 1; i <= 4; i++) {
      dropTetris(game)
      expect(game.streak).toBe(i)
      expect(game.lines).toBe(4 * i)
    }
  })

  it('maintains streak across non-clearing placements without sending', () => {
    const game = new Game({ seed: 1, attack: ISOLATE, sendsGarbage: true })
    for (let i = 0; i < 4; i++) dropTetris(game)
    expect(game.streak).toBe(4)
    const sentBefore = game.sentLines

    const events = game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    expect(game.streak).toBe(4)
    expect(events.some((e) => e.type === 'attack')).toBe(false)
    expect(game.sentLines).toBe(sentBefore)
  })

  it('sends nothing when a plain clear breaks the streak at or below the threshold', () => {
    const game = new Game({ seed: 1, attack: { ...ISOLATE, streakThreshold: 3 }, sendsGarbage: true })
    for (let i = 0; i < 3; i++) dropTetris(game)
    expect(game.streak).toBe(3)
    const sentBefore = game.sentLines

    for (let x = 0; x < BOARD_W; x++) if (x !== 7) game.board[TOTAL_H - 1][x] = 'J'
    game.active = { type: 'I', rot: 1, x: 5, y: 3 }
    game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    expect(game.streak).toBe(0)
    expect(game.sentLines).toBe(sentBefore)
  })

  it('sends streak length when broken by a plain clear above threshold', () => {
    const game = new Game({ seed: 1, attack: ISOLATE, sendsGarbage: true })
    for (let i = 0; i < 4; i++) dropTetris(game)
    expect(game.streak).toBe(4)
    const sentBefore = game.sentLines

    for (let x = 0; x < BOARD_W; x++) if (x !== 7) game.board[TOTAL_H - 1][x] = 'J'
    game.active = { type: 'I', rot: 1, x: 5, y: 3 }
    const events = game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    expect(game.lines).toBe(17)
    expect(game.streak).toBe(0)
    expect(events).toContainEqual({ type: 'attack', lines: 4 })
    expect(game.sentLines).toBe(sentBefore + 4)
  })

  it('counts streak break lines toward sentLines even outside versus', () => {
    const game = new Game({ seed: 1, attack: ISOLATE })
    for (let i = 0; i < 4; i++) dropTetris(game)
    const sentBefore = game.sentLines
    for (let x = 0; x < BOARD_W; x++) if (x !== 7) game.board[TOTAL_H - 1][x] = 'J'
    game.active = { type: 'I', rot: 1, x: 5, y: 3 }
    game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    expect(game.sentLines).toBe(sentBefore + 4)
    expect(game.apm).toBeGreaterThan(0)
  })

  it('perfect clears build the streak', () => {
    const game = new Game({ seed: 1, attack: ISOLATE })
    for (const y of [TOTAL_H - 2, TOTAL_H - 1])
      for (let x = 0; x < BOARD_W; x++) if (x !== 4 && x !== 5) game.board[y][x] = 'J'
    game.active = { type: 'O', rot: 0, x: 4, y: 3 }
    const events = game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    const clear = events.find((e): e is Extract<GameEvent, { type: 'clear' }> => e.type === 'clear')
    expect(clear?.info.perfectClear).toBe(true)
    expect(game.streak).toBe(1)
  })

  it('detects a t-spin double performed with hard drop', () => {
    const game = new Game({ seed: 1, attack: { ...ISOLATE, streakThreshold: 99 } })
    const FILL = [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [0, 1, 1, 0, 0, 1, 1, 1, 0, 1],
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 0, 0, 0, 0, 0, 1, 1],
    ]
    FILL.forEach((row, i) =>
      row.forEach((v, x) => {
        if (v) game.board[TOTAL_H - 4 + i][x] = 'J'
      }),
    )
    game.active = { type: 'T', rot: 0, x: 0, y: 20 }
    const events = game.tick({ dir: 0, softDrop: false, actions: ['rotate180', 'hardDrop'] })
    const clear = events.find((e): e is Extract<GameEvent, { type: 'clear' }> => e.type === 'clear')
    expect(clear?.info.spin).toBe('full')
    expect(clear?.info.count).toBe(2)
    expect(game.streak).toBe(1)
    expect(game.sentLines).toBe(4)
  })

  it('detects an l-spin double performed with hard drop and builds streak', () => {
    const game = new Game({ seed: 1, attack: { ...ISOLATE, streakThreshold: 99 } })
    const FILL = [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 0, 0, 0, 1],
      [1, 0, 0, 1, 1, 0, 0, 1, 1, 1],
      [1, 1, 0, 1, 1, 0, 0, 1, 1, 1],
    ]
    FILL.forEach((row, i) =>
      row.forEach((v, x) => {
        if (v) game.board[TOTAL_H - 4 + i][x] = 'J'
      }),
    )
    game.active = { type: 'L', rot: 0, x: 5, y: 20 }
    const events = game.tick({ dir: 0, softDrop: false, actions: ['rotate180', 'hardDrop'] })
    const clear = events.find((e): e is Extract<GameEvent, { type: 'clear' }> => e.type === 'clear')
    expect(clear?.info.spin).toBe('full')
    expect(clear?.info.piece).toBe('L')
    expect(clear?.info.count).toBe(2)
    expect(game.streak).toBe(1)
    expect(game.sentLines).toBe(4)
  })
})

describe('Zen mechanics', () => {
describe('Garbage timing & cancellation', () => {
  function forceSingleClear(game: Game): GameEvent[] {
    for (let x = 0; x < BOARD_W; x++) if (x !== 7) game.board[TOTAL_H - 1][x] = 'J'
    game.active = { type: 'I', rot: 1, x: 5, y: 3 }
    return game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
  }

  function countGarbageRows(game: Game): number {
    return game.board.filter((row) => row.filter((c) => c === 'G').length >= BOARD_W - 1).length
  }

  it('queued garbage does not arrive on a clearing placement', () => {
    const game = new Game({ seed: 9, sendsGarbage: true, attack: { single: 2 } })
    game.receiveGarbage(3)
    forceSingleClear(game)
    expect(countGarbageRows(game)).toBe(0)
    expect(game.pendingGarbage).toBe(1)
  })

  it('clears cancel incoming garbage', () => {
    const game = new Game({ seed: 9, sendsGarbage: true, attack: { single: 2 } })
    game.receiveGarbage(4)
    const events = forceSingleClear(game)
    // single clear worth 2 cancels 2 of the incoming 4; nothing left to send
    expect(events.some((e) => e.type === 'attack')).toBe(false)
    expect(game.pendingGarbage).toBe(2)

    game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    expect(countGarbageRows(game)).toBe(2)
  })

  it('surplus attack beyond pending garbage is forwarded', () => {
    const game = new Game({ seed: 9, sendsGarbage: true, attack: { single: 5 } })
    game.receiveGarbage(2)
    const events = forceSingleClear(game)
    // 5 lines of attack cancel all 2 incoming and forward 3
    expect(events.find((e) => e.type === 'attack')).toEqual({ type: 'attack', lines: 3 })
    expect(game.pendingGarbage).toBe(0)
  })

  it('bypass garbage ignores cancelling but still waits for a non-clearing placement', () => {
    const game = new Game({ seed: 9, sendsGarbage: true, attack: { single: 9 } })
    game.receiveGarbage(3, true)
    forceSingleClear(game)
    expect(countGarbageRows(game)).toBe(0)
    expect(game.pendingGarbage).toBe(3)
    game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    expect(countGarbageRows(game)).toBe(3)
  })

  it('garbage still applies on a placement without a clear', () => {
    const game = new Game({ seed: 9, sendsGarbage: true })
    game.receiveGarbage(3)
    game.receiveGarbage(2)
    hardDropPiece(game)
    expect(countGarbageRows(game)).toBe(5)
  })
})


  function countCheeseRows(game: Game): number {
    return game.board.filter((row) => row.every((c) => c === 'G' || c === null)).length
  }

  it('fills the bottom rows with cheese and maintains them after locks', () => {
    const game = new Game({ seed: 2, cheeseRows: 6 })
    for (let y = TOTAL_H - 6; y < TOTAL_H; y++) {
      expect(game.board[y].filter((c) => c === 'G').length).toBe(BOARD_W - 1)
    }
    hardDropPiece(game)
    for (let y = TOTAL_H - 6; y < TOTAL_H; y++) {
      expect(game.board[y].filter((c) => c === 'G').length).toBe(BOARD_W - 1)
    }
    expect(countCheeseRows(game)).toBeGreaterThanOrEqual(6)
  })

  it('receiveGarbageNow pushes rows in immediately', () => {
    const game = new Game({ seed: 2 })
    game.receiveGarbageNow(3)
    const garbageRows = game.board.filter((row) => row.filter((c) => c === 'G').length >= BOARD_W - 1)
    expect(garbageRows.length).toBe(3)
    expect(game.pendingGarbage).toBe(0)
  })

  it('restores snapshots exactly and replays identically', () => {
    const a = new Game({ seed: 9 })
    hardDropPiece(a)
    const snap = a.snapshot()

    const b = new Game({ seed: 123 })
    b.restore(snap)
    expect(b.score).toBe(a.score)
    expect(b.lines).toBe(a.lines)
    expect(b.piecesPlaced).toBe(a.piecesPlaced)
    expect(b.nextQueue).toEqual(a.nextQueue)
    expect(b.active!.type).toBe(a.active!.type)

    hardDropPiece(a)
    hardDropPiece(b)
    expect(b.score).toBe(a.score)
    expect(b.lines).toBe(a.lines)
    expect(b.active!.type).toBe(a.active!.type)
    expect(b.nextQueue).toEqual(a.nextQueue)
  })

  it('undoing a placement returns to the prior snapshot state', () => {
    const game = new Game({ seed: 9 })
    const initial = game.snapshot()
    hardDropPiece(game)
    expect(game.piecesPlaced).toBe(1)
    game.restore(initial)
    expect(game.piecesPlaced).toBe(0)
    expect(game.score).toBe(0)
    expect(game.lines).toBe(0)
  })

  it('cheese regenerates after a line clear removes rows', () => {
    const game = new Game({ seed: 2, cheeseRows: 3 })
    // fill the cheese holes so the next placement clears whole rows
    for (let y = TOTAL_H - 3; y < TOTAL_H; y++) {
      const hole = game.board[y].findIndex((c) => c === null)
      game.board[y][hole] = 'J'
    }
    game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    for (let y = TOTAL_H - 3; y < TOTAL_H; y++) {
      expect(game.board[y].filter((c) => c === 'G').length).toBe(BOARD_W - 1)
    }
  })
})

describe('Garbage & competitive mechanics', () => {
  it('applies pending garbage rows with holes on next lock', () => {
    const game = new Game({ seed: 9, sendsGarbage: true })
    game.receiveGarbage(3)
    game.receiveGarbage(2)
    hardDropPiece(game)
    const garbageRows = game.board.filter(
      (row) => row.filter((c) => c === 'G').length >= BOARD_W - 1,
    )
    expect(garbageRows.length).toBe(5)
  })

  it('emits attack events when clearing in competitive mode', () => {
    const game = new Game({ seed: 11, sendsGarbage: true, attack: { single: 2 } })
    const bottom = TOTAL_H - 1
    for (let x = 0; x < BOARD_W; x++) game.board[bottom][x] = 'J'
    const events = game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    const attackEvent = events.find((e) => e.type === 'attack')
    expect(attackEvent).toEqual({ type: 'attack', lines: 2 })
    expect(game.sentLines).toBe(2)
  })

  it('combo increments over consecutive clears and resets on a non-clearing lock', () => {
    const game = new Game({ seed: 13 })
    const b = TOTAL_H - 1
    const fillFullRow = () => {
      for (let x = 0; x < BOARD_W; x++) game.board[b][x] = 'J'
    }
    fillFullRow()
    game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    expect(game.combo).toBe(1)
    fillFullRow()
    game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    expect(game.combo).toBe(2)

    for (let x = 1; x < BOARD_W; x++) game.board[b][x] = 'J'
    game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    expect(game.combo).toBe(0)
  })

  it('detects T/S/Z spins via corner rule and kick index', () => {
    const mkBoard = (filled: [number, number][]) => {
      const board: Cell[][] = Array.from({ length: TOTAL_H }, () => Array<Cell>(BOARD_W).fill(null))
      for (const [x, y] of filled) board[y][x] = 'J'
      return board
    }
    const t = { type: 'T' as const, rot: 2 as const, x: 3, y: TOTAL_H - 2 }
    expect(detectSpin(mkBoard([[3, TOTAL_H - 2], [5, TOTAL_H - 2]]), t, 0).spin).toBe('full')
    expect(detectSpin(mkBoard([]), t, -1).spin).toBe('none')
    const tFloating = { type: 'T' as const, rot: 0 as const, x: 3, y: 5 }
    expect(detectSpin(mkBoard([]), tFloating, 0).spin).toBe('none')
    const s = { type: 'S' as const, rot: 0 as const, x: 3, y: TOTAL_H - 2 }
    expect(
      detectSpin(
        mkBoard([
          [3, TOTAL_H - 2],
          [5, TOTAL_H - 2],
        ]),
        s,
        0,
      ).spin,
    ).toBe('full')
    const z = { type: 'Z' as const, rot: 0 as const, x: 4, y: 5 }
    const zBoard = mkBoard([
      [4, 5],
      [6, 5],
      [4, 7],
    ])
    expect(detectSpin(zBoard, z, 1).spin).toBe('full')
    const j = { type: 'J' as const, rot: 0 as const, x: 3, y: TOTAL_H - 2 }
    expect(detectSpin(mkBoard([[3, TOTAL_H - 2], [5, TOTAL_H - 2]]), j, 0).spin).toBe('full')
    expect(detectSpin(mkBoard([[3, TOTAL_H - 2], [5, TOTAL_H - 2]]), j, -1).spin).toBe('none')
    expect(detectSpin(mkBoard([]), j, 0).spin).toBe('none')
    const l = { type: 'L' as const, rot: 0 as const, x: 3, y: TOTAL_H - 2 }
    expect(detectSpin(mkBoard([[3, TOTAL_H - 2], [5, TOTAL_H - 2]]), l, 1).spin).toBe('full')
    expect(detectSpin(mkBoard([]), l, 1).spin).toBe('none')
  })
})
