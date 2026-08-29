import type { ClearInfo, AttackResult } from '../engine/attack'
import { PIECE_COLORS } from './canvas'
import { HIDDEN_H, type ActivePiece } from '../engine/types'
import { cellsFor } from '../engine/pieces'

/**
 * Per-parameter visual effects config. Each parameter can be varied
 * independently; the presets below just set all of them at once.
 */
export interface EffectsConfig {
  /** 0 = off, 1 = normal density, 2 = cranked density + faster bursts */
  particles: number
  /** 0 = off, 1 = base shockwave on major clears, 2 = extra combo pulses */
  rings: number
  /** 0 = off, 1 = majors only, 2 = every cleared row */
  rowFlash: number
  /** tetris light beams + streaking sparks */
  beams: boolean
  /** full-canvas flash on major clears */
  screenFlash: boolean
  /** hard-drop impact dust */
  impact: boolean
  /** send-line number popups (combo totals, x-multiplier tags, streak breaks) */
  sendPopups: boolean
}

export type FxPreset = 'minimal' | 'medium' | 'high' | 'ultra'

export const FX_PRESETS: Record<FxPreset, EffectsConfig> = {
  minimal: { particles: 0, rings: 0, rowFlash: 1, beams: false, screenFlash: false, impact: false, sendPopups: true },
  medium: { particles: 1, rings: 1, rowFlash: 1, beams: true, screenFlash: false, impact: false, sendPopups: true },
  high: { particles: 1, rings: 2, rowFlash: 2, beams: true, screenFlash: true, impact: true, sendPopups: true },
  ultra: { particles: 2, rings: 2, rowFlash: 2, beams: true, screenFlash: true, impact: true, sendPopups: true },
}

export const FX_PRESET_ORDER: FxPreset[] = ['minimal', 'medium', 'high', 'ultra']

export interface FxPresetInfo {
  id: FxPreset
  name: string
  desc: string
}

export const FX_PRESET_INFO: FxPresetInfo[] = [
  { id: 'minimal', name: 'MINIMAL', desc: 'no particles, rings or flashes; just row highlights and send popups' },
  { id: 'medium', name: 'MEDIUM', desc: 'subtle bursts, row flash and tetris beams; quiet on singles/doubles/triples' },
  { id: 'high', name: 'HIGH', desc: 'row flash, shockwaves, screen flashes, beams, impact dust and combo pulses' },
  { id: 'ultra', name: 'ULTRA', desc: 'everything cranked; dense sparks and combo-scaled intensity' },
]

/** Legacy mapping from the old 1-5 effect levels to the preset config. */
export function effectsConfigFromLevel(level: number): EffectsConfig {
  if (level <= 1) return FX_PRESETS.minimal
  if (level === 2) return FX_PRESETS.medium
  if (level <= 4) return FX_PRESETS.high
  return FX_PRESETS.ultra
}

export function presetFromConfig(cfg: EffectsConfig): FxPreset | null {
  for (const p of FX_PRESET_ORDER) {
    if (JSON.stringify(FX_PRESETS[p]) === JSON.stringify(cfg)) return p
  }
  return null
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  /** gravity acceleration px/s^2 */
  g: number
  life: number
  maxLife: number
  color: string
  size: number
  stretch?: boolean
}

interface Ring {
  x: number
  y: number
  r: number
  vr: number
  life: number
  maxLife: number
  color: string
  lineWidth: number
}

interface RowFlash {
  y: number
  h: number
  alpha: number
  life: number
  maxLife: number
}

/** Horizontal light streak along a cleared row (tetris signature). */
interface Beam {
  y: number
  h: number
  life: number
  maxLife: number
  color: string
}

const MAX_SPARKS = 900
const FIRE_COLORS = ['#ffb347', '#ff7043']

export class EffectsSystem {
  private config: EffectsConfig
  private shakeEnabled = true
  private sparks: Spark[] = []
  private rings: Ring[] = []
  private rowFlashes: RowFlash[] = []
  private beams: Beam[] = []
  private shakeStart = 0
  private shakeDur = 0
  private shakeMag = 0
  private flashStart = 0
  private flashDur = 0
  private flashPeak = 0
  private flashColor = '#ffffff'

  constructor(config: EffectsConfig = FX_PRESETS.high) {
    this.config = config
  }

  setConfig(config: EffectsConfig) {
    this.config = config
  }

  setShakeEnabled(v: boolean) {
    this.shakeEnabled = v
  }

  lineClear(rows: number[], cellSize: number, info: ClearInfo, attack: AttackResult, combo = 0) {
    if (rows.length === 0) return
    const now = performance.now()
    const spin = info.spin !== 'none'
    const pc = info.perfectClear
    const tetris = !spin && info.count >= 4
    const major = spin || tetris || pc

    // scale by lines actually sent, not the clear type: a triple after a big
    // combo multiplier (6+ lines) pops harder than a lone tetris
    const sent = Math.max(0, attack.totalLines)
    const boost = 1 + Math.min(Math.max(0, sent - 4) * 0.15, 0.9)
    const comboStep = Math.max(0, combo - 3)

    let minY = Infinity
    let maxY = -Infinity
    for (const row of rows) {
      const vy = (row - HIDDEN_H) * cellSize
      if (vy < 0) continue
      minY = Math.min(minY, vy)
      maxY = Math.max(maxY, vy)
    }
    if (!Number.isFinite(minY)) return
    const cx = 5 * cellSize
    const cy = (minY + maxY) / 2 + cellSize / 2
    const boardBottom = 20 * cellSize

    // cleared-row highlight: bright for majors, faint whisper for minors
    const flashAlpha = major ? 0.5 : 0.18
    if (this.config.rowFlash >= 1 && (major || this.config.rowFlash >= 2)) {
      for (const row of rows) {
        const vy = (row - HIDDEN_H) * cellSize
        if (vy < 0) continue
        this.rowFlashes.push({ y: vy, h: cellSize, alpha: flashAlpha, life: 0.16, maxLife: 0.16 })
      }
    }

    // ---- minor clears (plain single/double/triple): deliberately quiet ----
    if (!major) {
      if (this.config.particles === 0) return
      const count = this.config.particles >= 2 ? 7 : 4
      for (const row of rows) {
        const vy = (row - HIDDEN_H) * cellSize
        if (vy < 0) continue
        for (let x = 1; x < 10; x += 2) {
          this.burst(x * cellSize, vy + cellSize / 2, count, 80, '#8a8a8a', 1, 2.5)
        }
      }
      return
    }

    // ---- major clears: unique signature per event type ----
    let palette: string[]
    if (pc) palette = ['#ffd966', '#fff3c4']
    else if (tetris) palette = ['#8fd7ff', '#ffffff']
    else if (info.piece === 'T') palette = ['#cfa6ff', '#eaddff']
    else if (info.piece === 'S' || info.piece === 'Z') palette = ['#7fbf7f', '#bf7f7f']
    else palette = ['#7f93bf', '#bf9a5f'] // J/L spins

    if (this.config.particles > 0) {
      const count = Math.round((this.config.particles >= 2 ? 24 : 14) * boost)
      const speed = this.config.particles >= 2 ? 190 : 140
      for (const row of rows) {
        const vy = (row - HIDDEN_H) * cellSize
        if (vy < 0) continue
        if (this.config.particles >= 2) {
          for (let x = 0; x < 10; x++) {
            this.burst(x * cellSize + cellSize / 2, vy + cellSize / 2, count, speed, this.pick(palette, comboStep), boost, 3.5)
          }
        } else {
          this.burst(cx, vy + cellSize / 2, count, speed, this.pick(palette, comboStep), boost, 4)
        }
      }
    }

    // tetris: horizontal light beams + fast streaking sparks along the rows
    if (tetris && this.config.beams) {
      for (const row of rows) {
        const vy = (row - HIDDEN_H) * cellSize
        if (vy < 0) continue
        this.beams.push({ y: vy + cellSize / 2, h: cellSize * 0.5, life: 0.28, maxLife: 0.28, color: '#bfeaff' })
        for (let i = 0; i < 8; i++) {
          const dir = Math.random() < 0.5 ? -1 : 1
          this.pushSpark({
            x: cx + (Math.random() - 0.5) * 10 * cellSize,
            y: vy + Math.random() * cellSize,
            vx: dir * (220 + Math.random() * 160),
            vy: (Math.random() - 0.5) * 40,
            g: 40,
            life: 0.35 + Math.random() * 0.2,
            color: '#dff6ff',
            size: 2 + Math.random() * 2,
            stretch: true,
          })
        }
      }
    }

    // t-spin: twin counter-rotating spirals from the clear centre
    if (info.piece === 'T' && spin && this.config.particles >= 1) {
      for (let ringDir = 1; ringDir >= -1; ringDir -= 2) {
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2
          const r0 = cellSize * 1.2
          const vt = 130 * 0.9 * ringDir
          this.pushSpark({
            x: cx + Math.cos(a) * r0,
            y: cy + Math.sin(a) * r0 * 0.6,
            vx: -Math.sin(a) * vt,
            vy: Math.cos(a) * vt * 0.6 - 40,
            g: 120,
            life: 0.45,
            color: i % 2 ? '#cfa6ff' : '#ffffff',
            size: 3,
          })
        }
      }
    }

    // s/z spin: sharp diagonal crossfire
    if ((info.piece === 'S' || info.piece === 'Z') && spin && this.config.particles >= 1) {
      for (let i = 0; i < 16; i++) {
        const band = (Math.PI / 4) * (1 + 2 * (i % 4)) // 45/135/225/315 degrees
        const a = band + (Math.random() - 0.5) * 0.5
        const v = 150 * 1.2
        this.pushSpark({
          x: cx + (Math.random() - 0.5) * 6 * cellSize,
          y: cy + (Math.random() - 0.5) * 2 * cellSize,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          g: 260,
          life: 0.4,
          color: palette[i % 2],
          size: 3,
          stretch: true,
        })
      }
    }

    // j/l spin: bursts out of the four corners of the cleared area
    if ((info.piece === 'J' || info.piece === 'L') && spin && this.config.particles >= 1) {
      const xs = [cx - 4.5 * cellSize, cx + 4.5 * cellSize]
      const ys = [minY + cellSize / 2, maxY + cellSize / 2]
      for (const px of xs) {
        for (const py of ys) {
          const ax = px < cx ? -Math.PI * 0.75 : -Math.PI * 0.25
          for (let i = 0; i < 8; i++) {
            const a = ax + (Math.random() - 0.5) * 0.7
            const v = 130 * (0.8 + Math.random() * 0.5)
            this.pushSpark({
              x: px,
              y: py,
              vx: Math.cos(a) * v,
              vy: Math.sin(a) * v,
              g: 400,
              life: 0.4 + Math.random() * 0.2,
              color: palette[i % 2],
              size: 3,
            })
          }
        }
      }
    }

    // perfect clear: golden ember fountain rising from the board floor
    if (pc && this.config.particles >= 1) {
      for (let i = 0; i < 40; i++) {
        this.pushSpark({
          x: Math.random() * 10 * cellSize,
          y: boardBottom,
          vx: (Math.random() - 0.5) * 60,
          vy: -(140 + Math.random() * 220),
          g: 180,
          life: 0.7 + Math.random() * 0.6,
          color: Math.random() < 0.6 ? '#ffd966' : '#fff3c4',
          size: 2 + Math.random() * 2.5,
        })
      }
    }

    // shockwave rings: base pulse on majors, extra pulses as combos climb
    if (this.config.rings >= 1) {
      const ringColor = pc ? '#ffe9a8' : tetris ? '#bfeaff' : info.piece === 'T' ? '#dcc2ff' : '#cccccc'
      this.rings.push({
        x: cx,
        y: cy,
        r: cellSize,
        vr: pc ? 900 : this.config.rings >= 2 ? 800 : 620,
        life: 0.35,
        maxLife: 0.35,
        color: ringColor,
        lineWidth: this.config.rings >= 2 ? 4 : 2.5,
      })
      if (this.config.rings >= 2) {
        const extraPulses = Math.min(comboStep, 3)
        for (let i = 1; i <= extraPulses; i++) {
          this.rings.push({
            x: cx,
            y: cy,
            r: cellSize * (1 + i * 0.6),
            vr: 500 + i * 120,
            life: 0.3,
            maxLife: 0.3,
            color: FIRE_COLORS[i % 2],
            lineWidth: 2,
          })
        }
      }
    }

    // screen flash on majors
    if (this.config.screenFlash) {
      let color = '#ffffff'
      if (pc) color = '#ffd966'
      else if (tetris) color = '#8fd7ff'
      else if (info.piece === 'T') color = '#cfa6ff'
      const peak = pc ? 0.2 : 0.14
      this.flash(color, peak, 200, now)
    }

    // shake reserved for majors only; strength scales with the config
    const mag = this.config.particles >= 2 ? 8 : this.config.rings >= 2 ? 6 : 5
    this.triggerShake(mag, 170, now)
  }

  hardDropImpact(piece: ActivePiece, cellSize: number) {
    if (!this.config.impact) return
    const now = performance.now()
    const color = PIECE_COLORS[piece.type]
    const cells = cellsFor(piece.type, piece.rot)
    const lowest = new Map<number, number>()
    for (const c of cells) {
      const prev = lowest.get(c.x)
      if (prev === undefined || c.y > prev) lowest.set(c.x, c.y)
    }
    const n = this.config.particles >= 2 ? 4 : 2
    for (const [cx, cy] of lowest) {
      const x = (piece.x + cx) * cellSize + cellSize / 2
      const y = (piece.y + cy - HIDDEN_H) * cellSize + cellSize
      for (let i = 0; i < n; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI * 0.9)
        const v = 60 + Math.random() * 90
        const life = 0.18 + Math.random() * 0.22
        this.sparks.push({
          x,
          y,
          vx: Math.cos(angle) * v,
          vy: Math.sin(angle) * v,
          g: 400,
          life,
          maxLife: life,
          color: Math.random() < 0.5 ? color : '#dddddd',
          size: 2 + Math.random() * 2,
        })
      }
    }
    this.triggerShake(this.config.particles >= 2 ? 3 : 1.5, 90, now)
  }

  update(dt: number) {
    for (const p of this.sparks) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += p.g * dt
      p.life -= dt
    }
    this.sparks = this.sparks.filter((p) => p.life > 0)
    if (this.sparks.length > MAX_SPARKS) this.sparks.splice(0, this.sparks.length - MAX_SPARKS)

    for (const r of this.rings) {
      r.r += r.vr * dt
      r.life -= dt
    }
    this.rings = this.rings.filter((r) => r.life > 0)

    for (const f of this.rowFlashes) f.life -= dt
    this.rowFlashes = this.rowFlashes.filter((f) => f.life > 0)

    for (const b of this.beams) b.life -= dt
    this.beams = this.beams.filter((b) => b.life > 0)
  }

  draw(ctx: CanvasRenderingContext2D) {
    const additive = this.config.particles >= 2 || this.config.screenFlash

    for (const f of this.rowFlashes) {
      ctx.globalAlpha = (f.life / f.maxLife) * f.alpha
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, f.y, ctx.canvas.width, f.h)
    }

    for (const b of this.beams) {
      const age = 1 - b.life / b.maxLife
      ctx.globalAlpha = (b.life / b.maxLife) * 0.85
      ctx.fillStyle = b.color
      const h = b.h * (0.4 + age * 1.6)
      ctx.fillRect(0, b.y - h / 2, ctx.canvas.width, h)
    }

    if (additive) ctx.globalCompositeOperation = 'lighter'
    for (const p of this.sparks) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife)
      ctx.fillStyle = p.color
      if (p.stretch) {
        const dirX = Math.abs(p.vx) > Math.abs(p.vy) ? 1 : 0
        const w = dirX ? p.size * 3.5 : p.size * 0.8
        const h = dirX ? p.size * 0.8 : p.size * 3.5
        ctx.fillRect(p.x - w / 2, p.y - h / 2, w, h)
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
      }
    }
    for (const r of this.rings) {
      ctx.globalAlpha = Math.max(0, r.life / r.maxLife) * 0.7
      ctx.strokeStyle = r.color
      ctx.lineWidth = r.lineWidth
      ctx.beginPath()
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  /** Full-canvas flash overlay for big moments; call after drawing the board. */
  drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, now: number) {
    if (this.flashDur <= 0 || now >= this.flashStart + this.flashDur) {
      this.flashDur = 0
      return
    }
    const age = (now - this.flashStart) / this.flashDur
    ctx.globalAlpha = this.flashPeak * (1 - age) * (1 - age)
    ctx.fillStyle = this.flashColor
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 1
  }

  /** Applies decay-based shake to the canvas element; call every frame. */
  applyShake(canvas: HTMLElement, now: number) {
    if (!this.shakeEnabled || this.shakeDur <= 0 || now >= this.shakeStart + this.shakeDur) {
      this.shakeDur = 0
      if (canvas.style.transform) canvas.style.transform = ''
      return
    }
    const m = ((this.shakeStart + this.shakeDur - now) / this.shakeDur) * this.shakeMag
    canvas.style.transform = `translate(${(Math.random() - 0.5) * m}px, ${(Math.random() - 0.5) * m}px)`
  }

  clear() {
    this.sparks = []
    this.rings = []
    this.rowFlashes = []
    this.beams = []
    this.shakeDur = 0
    this.flashDur = 0
  }

  private pushSpark(s: Omit<Spark, 'maxLife'>) {
    this.sparks.push({ ...s, maxLife: s.life })
  }

  private pick(palette: string[], comboStep: number): string {
    const fireChance = Math.min(comboStep * 0.15, 0.5)
    if (fireChance > 0 && Math.random() < fireChance) return FIRE_COLORS[(Math.random() * 2) | 0]
    return palette[(Math.random() * palette.length) | 0]
  }

  private burst(
    x: number,
    y: number,
    count: number,
    speed: number,
    color: string | null,
    boost: number,
    size: number,
  ) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const v = speed * boost * (0.3 + Math.random() * 0.7)
      const life = (0.3 + Math.random() * 0.5) * (this.config.particles >= 2 ? 1.3 : 1)
      const useWhite = this.config.particles >= 1 && Math.random() < 0.35
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v - (this.config.particles >= 2 ? 80 : 60),
        g: 400,
        life,
        maxLife: life,
        color: useWhite ? '#ffffff' : (color ?? '#aaaaaa'),
        size: this.config.particles >= 2 ? size + Math.random() * 2.5 : size,
      })
    }
  }

  private flash(color: string, peak: number, durMs: number, now: number) {
    if (peak <= this.flashPeakRemaining(now)) return
    this.flashColor = color
    this.flashPeak = peak
    this.flashStart = now
    this.flashDur = durMs
  }

  private flashPeakRemaining(now: number): number {
    if (this.flashDur <= 0 || now >= this.flashStart + this.flashDur) return 0
    const age = (now - this.flashStart) / this.flashDur
    return this.flashPeak * (1 - age) * (1 - age)
  }

  private triggerShake(mag: number, durMs: number, now: number) {
    if (!this.shakeEnabled) return
    if (durMs < this.shakeDur && now < this.shakeStart + this.shakeDur) return
    this.shakeMag = mag
    this.shakeDur = durMs
    this.shakeStart = now
  }
}
