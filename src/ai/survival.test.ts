import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import init, { Cc2Bot } from './cc2-wasm/cc2_wasm.js'
import { Game } from '../engine/game'
import { buildPlacementScript, type ScriptStep } from './executor'
import { applyPlacementToBoard } from './board'
import { type Cell } from '../engine/types'

const here = dirname(fileURLToPath(import.meta.url))

const HANDLING = { dasFrames: 1, arrFrames: 1, sddFrames: 0 }
const PPS = 2

function cc2Columns(board: Cell[][]): Uint32Array {
  const cols = new Uint32Array(10)
  for (let c = 0; c < 10; c++) {
    let bits = 0
    for (let y = 0; y < board.length; y++) {
      if (board[y][c] !== null) bits |= 1 << (board.length - 1 - y)
    }
    cols[c] = bits >>> 0
  }
  return cols
}

interface Cc2Candidate {
  type: string
  x: number
  rot: number
  spin?: string
  cells?: [number, number][]
}

/**
 * Regression guard for the versus AI brain: cold-clear-2's top-ranked
 * suggestion must actually survive when executed through the real input
 * search. A regression that degrades plan quality (e.g. overriding ranked
 * suggestions with hard-drop-only moves) tops out long before this limit.
 */
describe('cc2-driven survival', () => {
  it('survives 120 pieces through the executor without topping out', async () => {
    await init(readFileSync(join(here, 'cc2-wasm', 'cc2_wasm_bg.wasm')))
    const g = new Game({ seed: 12345, sendsGarbage: false, handling: HANDLING })
    const bot = new Cc2Bot('')
    let seenPlacements = -1
    let pieceFrames = 0
    let script: ScriptStep[] = []

    while (!g.over && g.piecesPlaced < 120) {
      if (g.active && g.piecesPlaced !== seenPlacements) {
        seenPlacements = g.piecesPlaced
        pieceFrames = 0
        script = []
        bot.stop()
        bot.start(cc2Columns(g.board), g.active.type, g.nextQueue, g.combo, g.b2bActive)
        bot.pump(5000)
        const raw = bot.suggest()
        if (!raw) break
        const picked = (JSON.parse(raw) as Cc2Candidate[])[0]
        if (!picked?.cells?.length) break
        // the suggestion must be legal on the board it was planned for;
        // otherwise the worker would have returned an empty chain anyway
        const simulated = applyPlacementToBoard(g.board, picked as never)
        expect(simulated).not.toBeNull()
        script = buildPlacementScript(
          g,
          { pps: PPS, handling: HANDLING },
          { type: picked.type as never, x: picked.x, rot: picked.rot, spin: picked.spin as 'none' | 'mini' | 'full' | undefined, cells: picked.cells },
        )
      }

      pieceFrames++
      const input: Parameters<Game['tick']>[0] =
        pieceFrames >= 600 && script.length === 0
          ? { dir: 0, softDrop: false, actions: ['hardDrop'] }
          : (script.shift() ?? { dir: 0, softDrop: false, actions: [] })
      g.tick(input)
    }

    bot.free()
    expect(g.over).toBe(false)
    expect(g.piecesPlaced).toBe(120)
    // a healthy bot clears steadily while stacking flat
    expect(g.lines).toBeGreaterThanOrEqual(25)
  }, 180000)
})
