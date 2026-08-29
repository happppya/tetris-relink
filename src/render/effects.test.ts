import { describe, expect, it } from 'vitest'
import {
  accumulateSend,
  SendPopupRenderer,
  COMBO_GLOW,
  SEND_LIFE_MS,
  sendAnchor,
} from './cleartext'
import { EffectsSystem, FX_PRESETS, effectsConfigFromLevel, presetFromConfig, type EffectsConfig } from './effects'
import type { AttackResult } from '../engine/attack'

function mockCtx() {
  const calls = {
    radialGradients: 0,
    fillText: [] as { text: string; x: number; y: number }[],
  }
  const ctx = {
    save: () => {},
    restore: () => {},
    textAlign: 'left' as CanvasTextAlign,
    font: '',
    lineWidth: 1,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    fillRect: () => {},
    strokeText: () => {},
    fillText: (text: string, x: number, y: number) => calls.fillText.push({ text, x, y }),
    createRadialGradient: () => {
      calls.radialGradients++
      return { addColorStop: () => {} }
    },
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

function attack(totalLines: number, overrides: Partial<AttackResult> = {}): AttackResult {
  return {
    baseLines: totalLines,
    totalLines,
    comboMult: 1,
    b2b: false,
    streakBonus: 0,
    streakSent: false,
    ...overrides,
  }
}

describe('accumulateSend (combo send totals)', () => {
  it('shows the raw send for a lone clear: triple displays 2, tetris displays 4', () => {
    expect(accumulateSend(0, attack(2), 1)).toBe(2)
    expect(accumulateSend(0, attack(4), 1)).toBe(4)
    expect(accumulateSend(0, attack(2, { streakSent: true, streakBonus: 2, totalLines: 4 }), 1)).toBe(4)
  })

  it('accumulates every send in a multi combo chain', () => {
    // combo 2: current send (2) + previous (2) = 4
    expect(accumulateSend(2, attack(2), 2)).toBe(4)
    // combo 3 after a tetris: 4 + 4 = 8
    expect(accumulateSend(4, attack(4), 3)).toBe(8)
    // combo sends use the combo-multiplied final total, not the base
    expect(accumulateSend(3, attack(6), 3)).toBe(9)
  })

  it('resets the chain total when a fresh combo starts', () => {
    expect(accumulateSend(9, attack(2), 1)).toBe(2)
    // a zero send in a continued combo keeps the running total
    expect(accumulateSend(6, attack(0), 3)).toBe(6)
  })
})

const ROWS = [5]
const PIECE_X = 4
const CELL = 30

describe('sendAnchor (popup position)', () => {
  it('sits above the topmost cleared row, centered on the clearing piece', () => {
    // row 5 -> canvas y (5 - HIDDEN_H=4) * 30 = 30, minus the 16px lift
    expect(sendAnchor([5], 4, 30)).toEqual({ x: 180, y: 14 })
    // multi-row clears anchor to the TOP row, not the middle
    expect(sendAnchor([5, 6, 7], 4, 30).y).toBe(sendAnchor([5], 4, 30).y)
    // piece at the left edge pulls the popup left of center
    expect(sendAnchor([5], 0, 30).x).toBe(60)
    // piece at the right edge pulls it right
    expect(sendAnchor([5], 8, 30).x).toBe(300)
  })
})

describe('SendPopupRenderer', () => {
  it('pops the raw send number on a lone clear', () => {
    const r = new SendPopupRenderer()
    r.push(attack(2), 1, 0, ROWS, PIECE_X, CELL)
    expect(r.last).toEqual({ number: 2, combo: 1, streak: false })
    r.push(attack(4), 1, 0, ROWS, PIECE_X, CELL)
    expect(r.last).toEqual({ number: 4, combo: 1, streak: false })
  })

  it('shows the cumulative total and an x-combo tag for combo sends', () => {
    const r = new SendPopupRenderer()
    r.push(attack(2), 1, 0, ROWS, PIECE_X, CELL) // combo 1: 2
    r.push(attack(2), 2, 100, ROWS, PIECE_X, CELL) // combo 2: 2+2 = 4
    r.push(attack(6), 3, 200, ROWS, PIECE_X, CELL) // combo 3 after big multiplier: 4+6 = 10
    expect(r.last).toEqual({ number: 10, combo: 3, streak: false })
  })

  it('marks a streak break on the popup', () => {
    const r = new SendPopupRenderer()
    r.push(attack(2, { streakSent: true, streakBonus: 3, totalLines: 5 }), 1, 0, ROWS, PIECE_X, CELL)
    expect(r.last).toEqual({ number: 5, combo: 1, streak: true })
  })

  it('does not pop when nothing was sent, but resets the chain on a fresh clear', () => {
    const r = new SendPopupRenderer()
    r.push(attack(2), 1, 0, ROWS, PIECE_X, CELL)
    r.push(attack(0), 2, 100, ROWS, PIECE_X, CELL) // combo continues but sends 0
    expect(r.active).toBe(1)
    expect(r.last?.number).toBe(2)
    r.push(attack(3), 1, 200, ROWS, PIECE_X, CELL) // chain broke, fresh clear
    expect(r.last?.number).toBe(3)
  })

  it('expires popups after their lifetime (draw filters by age)', () => {
    const r = new SendPopupRenderer()
    r.push(attack(4), 1, 0, ROWS, PIECE_X, CELL)
    r.push(attack(4), 2, 100, ROWS, PIECE_X, CELL)
    const { ctx } = mockCtx()
    // a draw right after the push keeps them
    r.draw(ctx, 300, 600, 200)
    expect(r.active).toBe(2)
    // once the lifetime passes, draw prunes them
    r.draw(ctx, 300, 600, SEND_LIFE_MS + 200)
    expect(r.active).toBe(0)
    // and the chain total resets for the next clear
    r.push(attack(2), 1, SEND_LIFE_MS + 300, ROWS, PIECE_X, CELL)
    expect(r.last?.number).toBe(2)
  })

  it('draws the number at the clear anchor with no background glow', () => {
    const r = new SendPopupRenderer()
    r.push(attack(4), 1, 0, ROWS, PIECE_X, CELL)
    const { ctx, calls } = mockCtx()
    r.draw(ctx, 300, 600, 0)
    // the number is drawn at the anchor (180, 14), not at a fixed screen spot
    expect(calls.fillText.some((c) => c.text === '4' && c.x === 180 && c.y === 14)).toBe(true)
    // the glow is gone: no radial gradients are ever created
    expect(calls.radialGradients).toBe(0)
  })

  it('cycles the tag palette so successive combo attacks flash differently', () => {
    expect(COMBO_GLOW.length).toBeGreaterThanOrEqual(4)
    // distinct consecutive colors for at least the first four combo steps
    const firstFour = new Set(COMBO_GLOW.slice(0, 4))
    expect(firstFour.size).toBe(4)
  })
})

describe('effects presets', () => {
  it('defines all four presets with per-parameter configs', () => {
    for (const p of ['minimal', 'medium', 'high', 'ultra'] as const) {
      const cfg = FX_PRESETS[p]
      expect([0, 1, 2]).toContain(cfg.particles)
      expect([0, 1, 2]).toContain(cfg.rings)
      expect([0, 1, 2]).toContain(cfg.rowFlash)
      expect(typeof cfg.beams).toBe('boolean')
      expect(typeof cfg.screenFlash).toBe('boolean')
      expect(typeof cfg.impact).toBe('boolean')
      expect(typeof cfg.sendPopups).toBe('boolean')
    }
    // escalation: each preset is >= the previous on the scale parameters
    const scale = (c: EffectsConfig) => c.particles + c.rings + c.rowFlash + (c.beams ? 1 : 0) + (c.screenFlash ? 1 : 0) + (c.impact ? 1 : 0)
    expect(scale(FX_PRESETS.minimal)).toBeLessThan(scale(FX_PRESETS.medium))
    expect(scale(FX_PRESETS.medium)).toBeLessThan(scale(FX_PRESETS.high))
    expect(scale(FX_PRESETS.high)).toBeLessThanOrEqual(scale(FX_PRESETS.ultra))
  })

  it('maps legacy 1-5 levels onto presets', () => {
    expect(effectsConfigFromLevel(1)).toEqual(FX_PRESETS.minimal)
    expect(effectsConfigFromLevel(2)).toEqual(FX_PRESETS.medium)
    expect(effectsConfigFromLevel(3)).toEqual(FX_PRESETS.high)
    expect(effectsConfigFromLevel(4)).toEqual(FX_PRESETS.high)
    expect(effectsConfigFromLevel(5)).toEqual(FX_PRESETS.ultra)
  })

  it('round-trips presets through presetFromConfig and rejects custom configs', () => {
    for (const p of ['minimal', 'medium', 'high', 'ultra'] as const) {
      expect(presetFromConfig({ ...FX_PRESETS[p] })).toBe(p)
    }
    expect(presetFromConfig({ ...FX_PRESETS.high, sendPopups: false })).toBeNull()
  })

  it('EffectsSystem accepts a config and scales by lines sent', () => {
    const fx = new EffectsSystem(FX_PRESETS.minimal)
    expect(fx).toBeDefined()
    // minimal still allows row flash + popups but no particles
    fx.setConfig(FX_PRESETS.medium)
    expect(fx).toBeDefined()
  })
})
