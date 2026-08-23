import type { ClearInfo } from '../engine/attack'

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
