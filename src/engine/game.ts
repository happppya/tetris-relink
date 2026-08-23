import { Bag, mulberry32 } from './bag'
import {
  computeAttack,
  DEFAULT_ATTACK,
  type AttackConfig,
  type AttackResult,
  type ClearInfo,
  type SpinKind,
} from './attack'
import { cellsFor, spawnPiece } from './pieces'
import { DEFAULT_SCORING, clearScore, comboScore, gravitySecondsPerRow, type ScoringConfig } from './scoring'
import { ghostY, pieceCollides, tryMove, tryRotate } from './srs'
import { BOARD_W, TOTAL_H, type ActivePiece, type Cell, type InputAction, type PieceType } from './types'

export const LOCK_DELAY_FRAMES = 30
export const MAX_RESETS = 15

export interface HandlingConfig {
  dasFrames: number
  arrFrames: number
  sddFrames: number
}

export const DEFAULT_HANDLING: HandlingConfig = {
  dasFrames: 8,
  arrFrames: 2,
  sddFrames: 2,
}

export interface TickInput {
  dir: -1 | 0 | 1
  softDrop: boolean
  actions: InputAction[]
}

export type GameEvent =
  | { type: 'move' }
  | { type: 'rotate'; kickIndex: number }
  | { type: 'lock'; piece: ActivePiece; row: number }
  | { type: 'clear'; info: ClearInfo; attack: AttackResult; scoreGained: number; rows: number[] }
  | { type: 'hold'; piece: PieceType | null }
  | { type: 'garbage'; rows: number }
  | { type: 'attack'; lines: number }
  | { type: 'gameover' }

export type GameMode = 'marathon' | 'sprint' | 'blitz' | 'versus' | 'zen'

export interface GameSnapshot {
  board: Cell[][]
  active: ActivePiece | null
  hold: PieceType | null
  holdBlocked: boolean
  score: number
  lines: number
  level: number
  combo: number
  streak: number
  b2bActive: boolean
  piecesPlaced: number
  frames: number
  sentLines: number
  over: boolean
  dasTimer: number
  arrTimer: number
  prevDir: -1 | 0 | 1
  gravAcc: number
  sddAcc: number
  lockTimer: number
  resets: number
  lowestY: number
  lastRotateKick: number
  garbageQueue: { rows: number; hole: number; bypass: boolean }[]
  cheeseRows: number
  bag: ReturnType<Bag['snapshot']>
}

export interface GameOptions {
  seed?: number
  handling?: Partial<HandlingConfig>
  attack?: Partial<AttackConfig>
  scoring?: Partial<ScoringConfig>
  startLevel?: number
  sendsGarbage?: boolean
  mode?: GameMode
  cheeseRows?: number
}

interface SpinCheck {
  spin: SpinKind
  kickIndex: number
}

export function detectSpin(board: Cell[][], piece: ActivePiece, lastRotateKick: number): SpinCheck {
  if (!['T', 'S', 'Z', 'J', 'L'].includes(piece.type)) return { spin: 'none', kickIndex: lastRotateKick }
  let occupied = 0
  const cx = piece.x + 1
  const cy = piece.y + 1
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const x = cx + dx
    const y = cy + dy
    if (x < 0 || x >= BOARD_W || y >= TOTAL_H || (y >= 0 && board[y][x] !== null)) occupied++
  }
  if (lastRotateKick < 0) return { spin: 'none', kickIndex: lastRotateKick }
  if (piece.type === 'T') {
    if (occupied < 3) return { spin: 'none', kickIndex: lastRotateKick }
    if (lastRotateKick === 4) return { spin: 'full', kickIndex: lastRotateKick }
    const front: [number, number][] =
      piece.rot === 0
        ? [
            [-1, -1],
            [1, -1],
          ]
        : piece.rot === 1
          ? [
              [1, -1],
              [1, 1],
            ]
          : piece.rot === 2
            ? [
                [-1, 1],
                [1, 1],
              ]
            : [
                [-1, -1],
                [-1, 1],
              ]
    const filledFront = front.every(([dx, dy]) => {
      const x = cx + dx
      const y = cy + dy
      return x < 0 || x >= BOARD_W || y >= TOTAL_H || (y >= 0 && board[y][x] !== null)
    })
    return { spin: filledFront ? 'full' : 'mini', kickIndex: lastRotateKick }
  }
  // S/Z/L/J: guideline-style immobile rule alongside the corner check — if the
  // final rotation wedged the piece so it can no longer move left, right or up,
  // it counts as a spin even when the 3-corner heuristic misses (e.g. an S
  // slotted flat into a 2-line notch)
  const cornerSpin = occupied >= 3
  const immobile =
    pieceCollides(board, { ...piece, x: piece.x - 1 }) &&
    pieceCollides(board, { ...piece, x: piece.x + 1 }) &&
    pieceCollides(board, { ...piece, y: piece.y - 1 })
  return { spin: cornerSpin || immobile ? 'full' : 'none', kickIndex: lastRotateKick }
}

export class Game {
  board: Cell[][]
  active: ActivePiece | null
  hold: PieceType | null = null
  holdBlocked = false
  score = 0
  lines = 0
  level: number
  combo = 0
  streak = 0
  b2bActive = false
  piecesPlaced = 0
  frames = 0
  sentLines = 0
  over = false

  private bag: Bag
  private handling: HandlingConfig
  private attackCfg: AttackConfig
  private scoringCfg: ScoringConfig
  private sendsGarbage: boolean
  readonly mode: GameMode

  private dasTimer = 0
  private arrTimer = 0
  private prevDir: -1 | 0 | 1 = 0
  private gravAcc = 0
  private sddAcc = 0
  private lockTimer = 0
  private resets = 0
  private lowestY = Number.POSITIVE_INFINITY
  private lastRotateKick = -1
  private garbageQueue: { rows: number; hole: number; bypass: boolean }[] = []
  private cheeseRows = 0
  private cheeseHoles: number[] = []

  constructor(opts: GameOptions = {}) {
    this.board = Array.from({ length: TOTAL_H }, () => Array<Cell>(BOARD_W).fill(null))
    this.bag = new Bag(mulberry32(opts.seed ?? ((Math.random() * 2 ** 31) | 0)))
    this.handling = { ...DEFAULT_HANDLING, ...opts.handling }
    this.attackCfg = { ...DEFAULT_ATTACK, ...opts.attack }
    this.scoringCfg = { ...DEFAULT_SCORING, ...opts.scoring }
    this.level = opts.startLevel ?? 1
    this.sendsGarbage = opts.sendsGarbage ?? false
    this.mode = opts.mode ?? 'marathon'
    this.active = this.spawnNext()
    if (this.active && pieceCollides(this.board, this.active)) this.setOver()
    if (opts.cheeseRows && opts.cheeseRows > 0) this.setCheese(opts.cheeseRows)
  }

  get nextQueue(): PieceType[] {
    return this.bag.peek(5)
  }

  get ghostPiece(): ActivePiece | null {
    if (!this.active) return null
    return { ...this.active, y: ghostY(this.board, this.active) }
  }

  get pps(): number {
    return this.frames > 0 ? this.piecesPlaced / (this.frames / 60) : 0
  }

  get apm(): number {
    return this.frames > 0 ? (this.sentLines * 3600) / this.frames : 0
  }

  receiveGarbage(rows: number, bypassCancel = false) {
    if (rows <= 0 || this.over) return
    this.garbageQueue.push({ rows, hole: (Math.random() * BOARD_W) | 0, bypass: bypassCancel })
  }

  get pendingGarbage(): number {
    return this.garbageQueue.reduce((sum, g) => sum + g.rows, 0)
  }

  snapshot(): GameSnapshot {
    return {
      board: this.board.map((row) => [...row]),
      active: this.active ? { ...this.active } : null,
      hold: this.hold,
      holdBlocked: this.holdBlocked,
      score: this.score,
      lines: this.lines,
      level: this.level,
      combo: this.combo,
      streak: this.streak,
      b2bActive: this.b2bActive,
      piecesPlaced: this.piecesPlaced,
      frames: this.frames,
      sentLines: this.sentLines,
      over: this.over,
      dasTimer: this.dasTimer,
      arrTimer: this.arrTimer,
      prevDir: this.prevDir,
      gravAcc: this.gravAcc,
      sddAcc: this.sddAcc,
      lockTimer: this.lockTimer,
      resets: this.resets,
      lowestY: this.lowestY,
      lastRotateKick: this.lastRotateKick,
      garbageQueue: this.garbageQueue.map((g) => ({ ...g })),
      cheeseRows: this.cheeseRows,
      bag: this.bag.snapshot(),
    }
  }

  restore(snap: GameSnapshot) {
    this.board = snap.board.map((row) => [...row])
    this.active = snap.active ? { ...snap.active } : null
    this.hold = snap.hold
    this.holdBlocked = snap.holdBlocked
    this.score = snap.score
    this.lines = snap.lines
    this.level = snap.level
    this.combo = snap.combo
    this.streak = snap.streak
    this.b2bActive = snap.b2bActive
    this.piecesPlaced = snap.piecesPlaced
    this.frames = snap.frames
    this.sentLines = snap.sentLines
    this.over = snap.over
    if (this.over) this.active = null
    this.dasTimer = snap.dasTimer
    this.arrTimer = snap.arrTimer
    this.prevDir = snap.prevDir
    this.gravAcc = snap.gravAcc
    this.sddAcc = snap.sddAcc
    this.lockTimer = snap.lockTimer
    this.resets = snap.resets
    this.lowestY = snap.lowestY
    this.lastRotateKick = snap.lastRotateKick
    this.garbageQueue = snap.garbageQueue.map((g) => ({ ...g }))
    this.cheeseRows = snap.cheeseRows
    this.bag.restore(snap.bag)
    this.maintainCheese()
  }

  tick(input: TickInput): GameEvent[] {
    const events: GameEvent[] = []
    if (this.over) return events
    this.frames++

    if (!this.active) {
      this.active = this.spawnNext()
      if (pieceCollides(this.board, this.active)) this.setOver(events)
      return events
    }

    for (const action of input.actions) this.handleAction(action, events)

    // a hold/hard drop can end the game (or leave no active piece); bailing
    // out here keeps the rest of the tick from dereferencing a dead piece
    if (!this.active || this.over) return events

    this.moveHorizontally(input.dir)

    const grounded = !tryMove(this.board, this.active, 0, 1)

    if (grounded) {
      this.gravAcc = 0
      this.lockTimer++
      if (this.lockTimer >= LOCK_DELAY_FRAMES) this.lockPiece(events)
    } else {
      this.lockTimer = 0
      if (input.softDrop && this.handling.sddFrames === 0) {
        this.gravAcc = 0
        for (;;) {
          const moved = tryMove(this.board, this.active, 0, 1)
          if (!moved) break
          this.active = moved
          this.lastRotateKick = -1
          this.onDescend(moved.y)
        }
      } else {
        const rate = 1 / 60 / gravitySecondsPerRow(this.level)
        this.gravAcc += rate
        while (this.gravAcc >= 1 && this.active) {
          this.gravAcc--
          const moved = tryMove(this.board, this.active, 0, 1)
          if (!moved) {
            this.gravAcc = 0
            break
          }
          this.active = moved
          this.lastRotateKick = -1
          this.onDescend(moved.y)
        }
        if (input.softDrop) {
          this.sddAcc++
          while (this.sddAcc >= this.handling.sddFrames && this.active) {
            this.sddAcc -= this.handling.sddFrames
            const moved = tryMove(this.board, this.active, 0, 1)
            if (!moved) {
              this.sddAcc = 0
              break
            }
            this.active = moved
            this.lastRotateKick = -1
            this.onDescend(moved.y)
          }
        } else {
          this.sddAcc = 0
        }
      }
    }

    return events
  }

  private handleAction(action: InputAction, events: GameEvent[]) {
    if (!this.active || this.over) return
    switch (action) {
      case 'rotateCW':
      case 'rotateCCW':
      case 'rotate180': {
        const dir = action === 'rotateCW' ? 1 : action === 'rotateCCW' ? -1 : 2
        const result = tryRotate(this.board, this.active, dir as 1 | -1 | 2)
        if (result) {
          this.active = result.piece
          this.lastRotateKick = result.kickIndex
          this.onPlayerShift(events, { type: 'rotate', kickIndex: result.kickIndex })
        }
        break
      }
      case 'hardDrop': {
        const dist = ghostY(this.board, this.active) - this.active.y
        this.score += dist * 2
        this.active = { ...this.active, y: this.active.y + dist }
        if (dist > 0) this.lastRotateKick = -1
        this.lockPiece(events)
        break
      }
      case 'hold': {
        if (this.holdBlocked) return
        const current = this.active.type
        const swap = this.hold
        this.hold = current
        this.holdBlocked = true
        this.active = this.spawn(swap ?? this.bag.next())
        this.resetPieceState()
        if (pieceCollides(this.board, this.active)) this.setOver(events)
        events.push({ type: 'hold', piece: this.hold })
        break
      }
    }
  }

  private moveHorizontally(dir: -1 | 0 | 1) {
    if (dir !== this.prevDir) {
      this.dasTimer = 0
      this.arrTimer = 0
      this.prevDir = dir
      if (dir !== 0) this.shift(dir)
      return
    }
    if (dir === 0) return
    this.dasTimer++
    if (this.dasTimer < this.handling.dasFrames) return
    if (this.handling.arrFrames === 0) {
      while (this.shift(dir)) {}
      return
    }
    this.arrTimer++
    while (this.arrTimer >= this.handling.arrFrames) {
      this.arrTimer -= this.handling.arrFrames
      if (!this.shift(dir)) break
    }
  }

  private shift(dir: -1 | 1): boolean {
    if (!this.active) return false
    const moved = tryMove(this.board, this.active, dir, 0)
    if (!moved) return false
    this.active = moved
    this.lastRotateKick = -1
    this.onPlayerShift()
    return true
  }

  private onPlayerShift(events?: GameEvent[], event?: GameEvent) {
    if (event && events) events.push(event)
    const grounded = !tryMove(this.board, this.active!, 0, 1)
    if (grounded && this.resets < MAX_RESETS) {
      this.lockTimer = 0
      this.resets++
    }
  }

  private onDescend(y: number) {
    if (y <= this.lowestY) return
    this.lowestY = y
    this.lockTimer = 0
    this.resets = 0
  }

  private lockPiece(events: GameEvent[]) {
    const piece = this.active!
    const cells = cellsFor(piece.type, piece.rot)
    for (const c of cells) {
      const y = piece.y + c.y
      const x = piece.x + c.x
      if (y < 0) {
        this.setOver(events)
        return
      }
      this.board[y][x] = piece.type
    }
    events.push({ type: 'lock', piece, row: piece.y })

    const spin = detectSpin(this.board, piece, this.lastRotateKick)
    const fullRows: number[] = []
    for (let y = 0; y < TOTAL_H; y++) {
      if (this.board[y].every((c) => c !== null)) fullRows.push(y)
    }
    const count = fullRows.length

    let scoreGained = 0
    let attack: AttackResult | null = null

    if (count > 0) {
      for (const y of fullRows) {
        this.board.splice(y, 1)
        this.board.unshift(Array<Cell>(BOARD_W).fill(null))
      }
      const pc = this.board.every((row) => row.every((c) => c === null))
      this.lines += count
      this.combo++

      const info: ClearInfo = { count, spin: spin.spin, piece: piece.type, perfectClear: pc }
      const isPower = spin.spin !== 'none' || count >= 4 || pc
      const brokenStreak = isPower ? 0 : this.streak
      if (isPower) this.streak++
      else this.streak = 0
      const wasB2B = this.b2bActive
      this.b2bActive = isPower ? true : false

      attack = computeAttack(info, this.attackCfg, this.combo - 1, wasB2B, brokenStreak)
      const remainder = this.cancelIncoming(attack.totalLines)
      if (remainder > 0) {
        this.sentLines += remainder
        if (this.sendsGarbage) events.push({ type: 'attack', lines: remainder })
      }

      scoreGained +=
        clearScore(count, spin.spin !== 'none', spin.spin === 'mini', pc, this.level) +
        comboScore(this.combo - 1, this.level)
      if (isPower && wasB2B) scoreGained += Math.round(clearScore(count, spin.spin !== 'none', spin.spin === 'mini', pc, this.level) * 0.5)
      if (this.mode === 'blitz') {
        const base = clearScore(count, spin.spin !== 'none', spin.spin === 'mini', pc, this.level)
        if (spin.spin === 'full') scoreGained += base * (this.scoringCfg.blitzSpinMult - 1)
        else if (spin.spin === 'none' && count >= 4) scoreGained += Math.round(base * (this.scoringCfg.blitzTetrisMult - 1))
        if (pc) scoreGained += this.scoringCfg.blitzPcBonus
      }
      scoreGained = Math.round(scoreGained)
      this.score += scoreGained

      events.push({ type: 'clear', info, attack, scoreGained, rows: fullRows })
    } else {
      this.combo = 0
      // non-clearing placements do not break the streak
    }

    // queued garbage only ever arrives after a placement without a clear;
    // bypass garbage (zen backfire) merely ignores cancelling
    if (count === 0) this.applyGarbage(events)
    this.maintainCheese()
    this.piecesPlaced++
    this.holdBlocked = false
    this.resetPieceState()

    if (!this.over) {
      this.active = this.spawnNext()
      if (pieceCollides(this.board, this.active)) this.setOver(events)
    }
  }

  private applyGarbage(events: GameEvent[]) {
    let total = 0
    for (const g of this.garbageQueue) {
      this.pushGarbageRows(g.rows, g.hole)
      total += g.rows
    }
    this.garbageQueue = []
    if (total > 0) {
      this.maintainCheese()
      events.push({ type: 'garbage', rows: total })
    }
  }

  /** Cancels up to `pool` lines of cancellable incoming garbage; returns the leftover attack. */
  private cancelIncoming(pool: number): number {
    for (const g of this.garbageQueue) {
      if (g.bypass || pool <= 0) continue
      const take = Math.min(g.rows, pool)
      g.rows -= take
      pool -= take
    }
    this.garbageQueue = this.garbageQueue.filter((g) => g.rows > 0)
    return pool
  }

  private pushGarbageRows(rows: number, hole: number) {
    for (let i = 0; i < rows; i++) {
      const row = Array<Cell>(BOARD_W).fill('G')
      row[hole] = null
      this.board.shift()
      this.board.push(row)
    }
  }

  receiveGarbageNow(rows: number) {
    if (rows <= 0 || this.over) return
    const hole = (Math.random() * BOARD_W) | 0
    this.pushGarbageRows(rows, hole)
    this.maintainCheese()
  }

  setCheese(rows: number) {
    this.cheeseRows = Math.max(0, Math.round(rows))
    while (this.cheeseHoles.length < this.cheeseRows) {
      this.cheeseHoles.push((Math.random() * BOARD_W) | 0)
    }
    this.maintainCheese(true)
  }

  private maintainCheese(force = false) {
    if (this.cheeseRows <= 0) return
    for (let i = 0; i < this.cheeseRows; i++) {
      const y = TOTAL_H - this.cheeseRows + i
      if (!force && this.board[y].some((c) => c === 'G')) continue
      const row = Array<Cell>(BOARD_W).fill('G')
      row[this.cheeseHoles[i] ?? ((Math.random() * BOARD_W) | 0)] = null
      this.board[y] = row
    }
  }

  private spawn(type: PieceType): ActivePiece {
    const p = spawnPiece(type)
    this.lowestY = p.y
    return p
  }

  private spawnNext(): ActivePiece {
    return this.spawn(this.bag.next())
  }

  private resetPieceState() {
    this.lockTimer = 0
    this.resets = 0
    this.gravAcc = 0
    this.sddAcc = 0
    this.lastRotateKick = -1
    this.lowestY = Number.POSITIVE_INFINITY
  }

  private setOver(events: GameEvent[] = []) {
    this.over = true
    this.active = null
    events?.push({ type: 'gameover' })
  }
}
