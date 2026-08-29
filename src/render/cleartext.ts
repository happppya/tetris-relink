import type { ClearInfo, AttackResult } from '../engine/attack'
import { HIDDEN_H } from '../engine/types'

const CLEAR_NAMES = ['SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS']

export function clearLabels(info: ClearInfo): string[] {
  const labels: string[] = []
  if (info.spin !== 'none' && info.piece) {
    const prefix = info.spin === 'mini' ? 'MINI ' : ''
    labels.push(`${prefix}${info.piece}-SPIN ${CLEAR_NAMES[info.count - 1] ?? ''}`.trim())
  } else if (info.count >= 1 && info.count <= 4) {
    labels.push(CLEAR_NAMES[info.count - 1])
  }
  if (info.perfectClear) labels.push('PERFECT CLEAR')
  return labels
}

interface Popup {
  text: string
  bornAt: number
}

const LIFE_MS = 1100
const BIG = new Set(['TETRIS', 'PERFECT CLEAR'])

export class ClearPopupRenderer {
  private popups: Popup[] = []

  push(labels: string[], now: number) {
    for (const text of labels) this.popups.push({ text, bornAt: now })
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, now: number) {
    if (!this.popups.length) return
    this.popups = this.popups.filter((p) => now - p.bornAt < LIFE_MS)
    ctx.save()
    ctx.textAlign = 'center'
    for (let i = 0; i < this.popups.length; i++) {
      const { text, bornAt } = this.popups[i]
      const age = (now - bornAt) / LIFE_MS
      const alpha = age < 0.65 ? 1 : 1 - (age - 0.65) / 0.35
      const pop = Math.max(0, 1 - age * 8)
      const size = (BIG.has(text) || text.includes('SPIN') ? 30 : 22) + pop * 6
      const x = w / 2
      const y = h * 0.32 + i * 34 - age * 24
      ctx.globalAlpha = alpha
      ctx.font = `bold ${size}px ui-monospace, monospace`
      ctx.lineWidth = 4
      ctx.strokeStyle = '#000000'
      ctx.strokeText(text, x, y)
      ctx.fillStyle = text === 'PERFECT CLEAR' ? '#ffffff' : '#e5e5e5'
      ctx.fillText(text, x, y)
    }
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// Send-line number popups
//
// The big number is the TOTAL LINES SENT by the current combo chain: a lone
// triple pops "2", a tetris pops "4", and a combo continuation shows the sum
// of every send in the chain (the current combo-multiplied send plus all the
// ones before it). Its size/color/life scale with the number so a triple sent
// after a big combo multiplier pops harder than a plain tetris; the glow color
// cycles between successive combo attacks so long chains flash differently.
// ---------------------------------------------------------------------------

export interface SendPopup {
  number: number
  combo: number
  streak: boolean
  bornAt: number
  /** canvas position (popup rises from here as it ages) */
  x: number
  y: number
}

export const SEND_LIFE_MS = 1150

/** Tag palette cycled per combo step so each successive combo attack flashes a new color. */
export const COMBO_GLOW = ['#8fd7ff', '#ffd966', '#7dffa8', '#cfa6ff', '#ff9a9a', '#ffb347']

/**
 * Running send total for the current combo chain. `combo` is the post-clear
 * combo count (1 = first clear of the chain, 2+ = continuation).
 */
export function accumulateSend(prev: number, attack: AttackResult, combo: number): number {
  if (combo <= 1) return attack.totalLines
  return prev + attack.totalLines
}

/**
 * Canvas anchor for a send popup: just above the topmost cleared row, centered
 * on the column span of the piece that cleared it. Shared by every game mode so
 * single-player and multiplayer pop exactly the same way.
 */
export function sendAnchor(rows: number[], pieceX: number, cellSize: number): { x: number; y: number } {
  let minRow = Infinity
  for (const r of rows) if (r < minRow) minRow = r
  return { x: (pieceX + 2) * cellSize, y: (minRow - HIDDEN_H) * cellSize - 16 }
}

export class SendPopupRenderer {
  private popups: SendPopup[] = []
  private comboTotal = 0

  push(attack: AttackResult, combo: number, now: number, rows: number[], pieceX: number, cellSize: number) {
    if (attack.totalLines <= 0) {
      // nothing was sent by this clear; still reset the chain total if it broke
      if (combo <= 1) this.comboTotal = 0
      return
    }
    this.comboTotal = accumulateSend(this.comboTotal, attack, combo)
    const { x, y } = sendAnchor(rows, pieceX, cellSize)
    this.popups.push({ number: this.comboTotal, combo, streak: attack.streakSent, bornAt: now, x, y })
  }

  /** Most recently pushed popup (tests / debugging). */
  get last(): { number: number; combo: number; streak: boolean } | null {
    const p = this.popups[this.popups.length - 1]
    return p ? { number: p.number, combo: p.combo, streak: p.streak } : null
  }

  get active(): number {
    return this.popups.length
  }

  clear() {
    this.popups = []
    this.comboTotal = 0
  }

  draw(ctx: CanvasRenderingContext2D, _w: number, _h: number, now: number) {
    if (!this.popups.length) return
    this.popups = this.popups.filter((p) => now - p.bornAt < SEND_LIFE_MS)
    if (!this.popups.length) return
    ctx.save()
    ctx.textAlign = 'center'
    // newest popup on top
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]
      const age = (now - p.bornAt) / SEND_LIFE_MS
      if (age >= 1) continue
      const alpha = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3
      const pop = Math.max(0, 1 - age * 10)
      const n = p.number
      const size = (46 + Math.min(n, 24) * 1.6) * (1 + pop * 0.55)
      const x = p.x
      const y = p.y - age * 34

      // magnitude-scaled text color: bigger sends burn hotter
      const textColor = n >= 16 ? '#ff8a5c' : n >= 10 ? '#ffd966' : n >= 6 ? '#fff3c4' : '#ffffff'
      // tag color cycles per combo step so long combo chains flash differently
      const glow = COMBO_GLOW[Math.max(0, p.combo - 1) % COMBO_GLOW.length]

      ctx.globalAlpha = alpha
      ctx.font = `bold ${Math.round(size)}px ui-monospace, monospace`
      ctx.lineWidth = Math.max(4, size * 0.12)
      ctx.strokeStyle = '#000000'
      ctx.strokeText(String(n), x, y)
      ctx.fillStyle = textColor
      ctx.fillText(String(n), x, y)

      // small x[combo] tag on combo sends (x2, x3, ...)
      if (p.combo >= 2) {
        const tagSize = Math.max(13, size * 0.34)
        ctx.font = `bold ${Math.round(tagSize)}px ui-monospace, monospace`
        ctx.lineWidth = 3
        ctx.strokeText(`x${p.combo}`, x, y + size * 0.42)
        ctx.fillStyle = glow
        ctx.fillText(`x${p.combo}`, x, y + size * 0.42)
      }
      if (p.streak) {
        const tagSize = Math.max(12, size * 0.3)
        ctx.font = `bold ${Math.round(tagSize)}px ui-monospace, monospace`
        const ty = y + size * 0.42 + (p.combo >= 2 ? tagSize * 1.15 : 0)
        ctx.lineWidth = 3
        ctx.strokeText('STREAK BROKEN', x, ty)
        ctx.fillStyle = '#ff9a8a'
        ctx.fillText('STREAK BROKEN', x, ty)
      }
    }
    ctx.restore()
  }
}
