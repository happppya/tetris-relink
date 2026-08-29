import { detectSpin, Game, type GameSnapshot, type HandlingConfig, LOCK_DELAY_FRAMES } from '../engine/game'
import { cellsFor } from '../engine/pieces'
import { tryMove } from '../engine/srs'
import { gravitySecondsPerRow } from '../engine/scoring'
import { TOTAL_H, type InputAction } from '../engine/types'
import type { BotPlanMsg } from './protocol'

export interface ScriptStep {
  dir: -1 | 0 | 1
  softDrop: boolean
  actions: InputAction[]
}

interface SearchNode {
  snap: GameSnapshot
  step: ScriptStep | null
  prev: SearchNode | null
}

const MAX_SEARCH_DEPTH = 40
const MAX_SEARCH_NODES = 5000

const CANDIDATE_STEPS: ScriptStep[] = [
  { dir: 0, softDrop: false, actions: [] },
  { dir: -1, softDrop: false, actions: [] },
  { dir: 1, softDrop: false, actions: [] },
  { dir: 0, softDrop: true, actions: [] },
  { dir: 0, softDrop: false, actions: ['rotateCW'] },
  { dir: 0, softDrop: false, actions: ['rotateCCW'] },
]

function stepKey(snap: GameSnapshot): string {
  const a = snap.active!
  return `${a.x},${a.y},${a.rot},${Math.min(snap.lockTimer, 31)},${Math.min(snap.resets, 15)}`
}

function occupiedCells(game: Game): Set<string> {
  const active = game.active!
  const out = new Set<string>()
  for (const c of cellsFor(active.type, active.rot)) out.add(`${active.x + c.x},${active.y + c.y}`)
  return out
}

function sameCells(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const s of a) if (!b.has(s)) return false
  return true
}

/** rows between the active piece and its landing spot */
function ghostRows(g: Game): number {
  if (!g.active) return 0
  let dist = 0
  let cur = g.active
  while (dist < 24) {
    const moved = tryMove(g.board, cur, 0, 1)
    if (!moved) break
    cur = moved
    dist++
  }
  return dist
}

/** align-and-drop steering toward plan.x/rot — best-effort fallback */
function legacyScript(game: Game, plan: BotPlanMsg, target: number): ScriptStep[] {
  if (!game.active) return []
  const steps: ScriptStep[] = []
  let rotDelta = (((plan.rot - game.active.rot) % 4) + 4) % 4
  if (rotDelta === 3) rotDelta = -1
  for (; rotDelta > 0; rotDelta--) steps.push({ dir: 0, softDrop: false, actions: ['rotateCW'] })
  for (; rotDelta < 0; rotDelta++) steps.push({ dir: 0, softDrop: false, actions: ['rotateCCW'] })
  const startX = game.active.x
  const dir: -1 | 0 | 1 = plan.x > startX ? 1 : plan.x < startX ? -1 : 0
  if (dir !== 0) {
    for (let x = startX; x !== plan.x; x += dir) steps.push({ dir, softDrop: false, actions: [] })
  }
  while (steps.length < target) steps.push({ dir: 0, softDrop: false, actions: [] })
  steps.push({ dir: 0, softDrop: false, actions: ['hardDrop'] })
  return steps
}

/**
 * Search real per-frame inputs on a scratch copy of the game for a sequence
 * that locks the piece exactly on cold-clear-2's planned cells — including
 * the final rotation maneuver for spin placements.
 */
export function buildPlacementScript(
  game: Game,
  opts: { pps: number; handling?: Partial<HandlingConfig> },
  plan: BotPlanMsg,
): ScriptStep[] {
  const scratch = new Game({ seed: 0, startLevel: game.level, gravityLevel: game.gravityLevel, handling: opts.handling })
  if (!game.active || game.over) return []
  const target = Math.max(3, Math.round(60 / Math.min(20, Math.max(0.05, opts.pps))))

  // pacing prefix: idle long enough that the whole maneuver lands on the
  // target frame budget, but never past the point where gravity + lock delay
  // would natural-lock the piece before the script's own hard drop fires.
  // The idle frames are simulated in the scratch game so the search plans
  // from wherever the piece will actually be once execution starts.
  const estLen = Math.abs(plan.x - game.active.x) + 5
  const airFrames = Math.round(ghostRows(game) * gravitySecondsPerRow(game.gravityLevel) * 60)
  let pad = Math.max(
    0,
    Math.min(target - estLen - 1, airFrames + LOCK_DELAY_FRAMES - estLen - 4),
  )
  const rootSnap = game.snapshot()
  if (pad > 0) {
    scratch.restore(rootSnap)
    let groundedFrames = 0
    for (let i = 0; i < pad; i++) {
      scratch.tick({ dir: 0, softDrop: false, actions: [] })
      if (scratch.over || !scratch.active) {
        pad = i
        break
      }
      if (!tryMove(scratch.board, scratch.active, 0, 1)) {
        // riding the lock delay: stop just before a natural lock fires
        groundedFrames++
        if (groundedFrames >= LOCK_DELAY_FRAMES - 3) {
          pad = i + 1
          break
        }
      } else {
        groundedFrames = 0
      }
    }
  }
  const paddedSnap = pad > 0 ? scratch.snapshot() : rootSnap
  const prefix: ScriptStep[] = []
  for (let i = 0; i < pad; i++) prefix.push({ dir: 0, softDrop: false, actions: [] })

  if (!plan.cells || !plan.cells.length) {
    return legacyScript(game, plan, target)
  }

  const needSpin = plan.spin !== undefined && plan.spin !== 'none'
  // plan cells arrive as [col, rowFromBottom]; convert to engine rows
  const goalCells = new Set(plan.cells.map(([cx, cy]) => `${cx},${TOTAL_H - 1 - cy}`))
  let root: SearchNode = { snap: paddedSnap, step: null, prev: null }
  if (plan.hold) {
    // perform the swap first; the BFS then steers the held piece onto the plan
    const scratchHold = new Game({ seed: 0, startLevel: game.level, gravityLevel: game.gravityLevel, handling: opts.handling })
    scratchHold.restore(root.snap)
    scratchHold.tick({ dir: 0, softDrop: false, actions: ['hold'] })
    if (scratchHold.active && !scratchHold.over) {
      root = { snap: scratchHold.snapshot(), step: { dir: 0, softDrop: false, actions: ['hold'] }, prev: null }
    }
  }
  let frontier: SearchNode[] = [root]
  const visited = new Set<string>()
  let goal: SearchNode | null = null

  expansion: for (let depth = 0; depth < MAX_SEARCH_DEPTH && frontier.length; depth++) {
    const next: SearchNode[] = []
    for (const node of frontier) {
      if (visited.size >= MAX_SEARCH_NODES) break expansion
      for (const step of CANDIDATE_STEPS) {
        scratch.restore(node.snap)
        if (!scratch.active) continue
        scratch.tick(step)
        if (scratch.over || !scratch.active) continue
        const snap = scratch.snapshot()
        const key = stepKey(snap)
        if (visited.has(key)) continue
        visited.add(key)
        const child: SearchNode = { snap, step, prev: node }
        if (sameCells(occupiedCells(scratch), goalCells)) {
          if (
            !needSpin ||
            detectSpin(scratch.board, scratch.active, snap.lastRotateKick).spin === plan.spin
          ) {
            goal = child
            break expansion
          }
          continue
        }
        next.push(child)
      }
    }
    frontier = next
  }

  if (!goal) {
    // unreachable plan: degrade to plain steering rather than freezing
    if (import.meta.env?.DEV) {
      console.warn('[executor] no input path found; using direct steering', { visited: visited.size })
    }
    return legacyScript(game, plan, target)
  }

  const steps: ScriptStep[] = []
  for (let n: SearchNode | null = goal; n && n.step; n = n.prev) steps.push(n.step)
  steps.reverse()

  const padded: ScriptStep[] = [...prefix, ...steps]
  padded.push({ dir: 0, softDrop: false, actions: ['hardDrop'] })
  return padded
}
