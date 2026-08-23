import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import init, { Cc2Bot } from './cc2-wasm/cc2_wasm.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('cc2 wasm binding', () => {
  it('boots and suggests a plan on an empty board', async () => {
    const emptyCols = () => Uint32Array.from(new Array(10).fill(0))
    await init(readFileSync(join(here, 'cc2-wasm', 'cc2_wasm_bg.wasm')))
    const bot = new Cc2Bot('')
    bot.start(emptyCols(), 'T', ['I', 'L', 'J', 'Z', 'S'], 0, false)
    const nodes = bot.pump(200)
    expect(nodes).toBeGreaterThan(0)
    const raw = bot.suggest()
    expect(raw).toBeTruthy()
    const plan = JSON.parse(raw!)
    expect(Array.isArray(plan)).toBe(true)
    expect(plan.length).toBeGreaterThan(0)
    expect(plan[0].type).toBe('T')
    expect(plan[0].x).toBeGreaterThanOrEqual(0)
    expect(plan[0].rot).toBeGreaterThanOrEqual(0)
    // execution contract: exact cells + intended spin maneuver
    expect(plan[0].cells).toHaveLength(4)
    for (const [cx, cy] of plan[0].cells) {
      expect(cx).toBeGreaterThanOrEqual(0)
      expect(cx).toBeLessThan(10)
      expect(cy).toBeGreaterThanOrEqual(0)
    }
    expect(['none', 'mini', 'full']).toContain(plan[0].spin)
    // advancing with the suggested placement must not trap; next piece plans too
    bot.play(plan[0].type, plan[0].rot, plan[0].x)
    bot.pump(200)
    expect(bot.suggest()).toBeTruthy()
    // profile config path
    const configured = new Cc2Bot(
      JSON.stringify({
        freestyle_weights: {
          cell_coveredness: -0.2,
          max_cell_covered_height: 6,
          holes: -1.5,
          row_transitions: -0.2,
          height: -0.4,
          height_upper_half: -1.5,
          height_upper_quarter: -5.0,
          tetris_well_depth: 0.3,
          tslot: [0.1, 1.5, 2.0, 4.0],
          has_back_to_back: 0.5,
          wasted_t: -1.5,
          softdrop: -0.2,
          normal_clears: [0.0, -2.0, -1.5, -1.0, 3.5],
          mini_spin_clears: [0.0, -1.5, -1.0],
          spin_clears: [0.0, 1.0, 4.0, 6.0],
          back_to_back_clear: 1.0,
          combo_attack: 1.5,
          perfect_clear: 15.0,
          perfect_clear_override: true,
        },
        freestyle_exploitation: 0.6931471805599453,
      }),
    )
    configured.start(emptyCols(), 'I', [], 0, false)
    configured.pump(100)
    expect(configured.suggest()).toBeTruthy()
    configured.stop()
    bot.stop()
  })
})
