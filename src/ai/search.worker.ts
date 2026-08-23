import type { BotInMsg, BotOutMsg, BotHintPlacement } from './protocol'
import { cc2ConfigJson } from './profiles'
import init, { Cc2Bot } from './cc2-wasm/cc2_wasm.js'
import { applyPlacementToBoard } from './board'
import { TOTAL_H, type Cell } from '../engine/types'

const PUMP_ITERATIONS = 5000
/** hint chains are latency-tolerant; spend more search per placement */
const HINT_PUMP_ITERATIONS = 20000

let cc2Ready: Promise<boolean> | null = null
let cc2: Cc2Bot | null = null
let cc2Profile: string | null = null
/** newest request seen; older queued messages are skipped entirely */
let latestSeq = -1

async function ensureCc2(): Promise<boolean> {
  if (!cc2Ready) {
    cc2Ready = init()
      .then(() => true)
      .catch(() => false)
  }
  return cc2Ready
}

function dropCc2() {
  // wasm traps poison the instance permanently; discard so the next request
  // gets a fresh one instead of failing forever
  if (cc2) {
    try {
      cc2.free()
    } catch {
      /* already dead */
    }
    cc2 = null
    cc2Profile = null
  }
  clearCont()
}

function cc2Columns(board: Cell[][]): Uint32Array {
  // bit y (from the bottom) set = filled cell at column c, row TOTAL_H-1-y
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

function boardKey(board: Cell[][]): string {
  let key = ''
  for (const row of board) for (const c of row) key += c ?? '.'
  return key
}

/** board/piece/hold state left by the last chain; a matching request continues
 *  the existing search from its DAG cursor instead of restarting */
let contKey: string | null = null
let contPiece: string | null = null
let contHold: string | null = null
/** known pieces remaining under the cursor (current + seeded queue);
 *  cc2 hedges blindly past this, so continuations must not run it dry */
let contQueueDepth = 0

function clearCont() {
  contKey = null
  contPiece = null
  contHold = null
  contQueueDepth = 0
}

interface Cc2Candidate {
  type: string
  x: number
  rot: number
  spin: 'none' | 'mini' | 'full'
  cells?: [number, number][]
  /** search score; comparable across searches with equal config and budget */
  eval?: number
}

interface SearchResult {
  chain: BotHintPlacement[]
  board: Cell[][]
  eval: number
}

function cellsLegal(
  cells: { x: number; y: number }[],
  board: Cell[][],
): boolean {
  return cells.every(
    (c) => c.x >= 0 && c.x < 10 && c.y >= 0 && c.y < TOTAL_H && board[c.y][c.x] === null,
  )
}

function searchWith(
  bot: Cc2Bot,
  board: Cell[][],
  steps: number,
  iterations: number,
  mySeq: number,
): SearchResult {
  const chain: BotHintPlacement[] = []
  let b = board
  let best = -Infinity
  for (let i = 0; i < steps; i++) {
    if (mySeq !== -1 && mySeq !== latestSeq) break
    bot.pump(iterations)
    const raw = bot.suggest()
    if (!raw) break
    const candidates = JSON.parse(raw) as Cc2Candidate[]
    // suggest() ranks candidates best-first; take the top placement that is
    // legal on the simulated board (spins and tucks included — never skip a
    // higher-ranked move just because it needs more than a hard drop)
    const picked = candidates.find(
      (cand) =>
        cand.cells?.length === 4 &&
        cellsLegal(cand.cells.map(([cx, cy]) => ({ x: cx, y: TOTAL_H - 1 - cy })), b),
    )
    if (!picked) break
    if (chain.length === 0 && typeof picked.eval === 'number') best = picked.eval
    chain.push({ type: picked.type as BotHintPlacement['type'], x: picked.x, rot: picked.rot, spin: picked.spin, cells: picked.cells })
    bot.play(picked.type, picked.rot, picked.x)
    const next = applyPlacementToBoard(b, picked as unknown as BotHintPlacement)
    if (!next) break
    b = next
  }
  return { chain, board: b, eval: best }
}

async function cc2Plan(
  msg: Extract<BotInMsg, { type: 'state' }>,
): Promise<{ result: SearchResult; usedHold: boolean } | null> {
  try {
    const mySeq = msg.seq ?? -1
    // a newer request arrived while this one sat in the queue — searching for
    // it would waste up to seconds of pump work on an answer nobody wants
    if (mySeq !== -1 && mySeq !== latestSeq) return null
    if (!cc2 || cc2Profile !== msg.profile) {
      dropCc2()
      cc2 = new Cc2Bot(cc2ConfigJson(msg.profile))
      cc2Profile = msg.profile
    }
    const steps = Math.max(1, msg.hintCount ?? 1)
    const iterations = steps > 1 ? HINT_PUMP_ITERATIONS : PUMP_ITERATIONS
    const hold = msg.hold ?? null
    // swapping the same piece back and forth achieves nothing
    const holdUsable = hold !== null && hold !== msg.current
    let result: SearchResult
    let usedHold = false

    if (!holdUsable) {
      const key = boardKey(msg.board)
      // continuing requires exactly the state the previous chain ended on:
      // same stack, the next queued piece under the cursor, same hold piece,
      // and enough known queue left that suggestions stay grounded
      const canContinue =
        !!cc2 &&
        contKey === key &&
        contPiece === msg.current &&
        contHold === hold &&
        contQueueDepth > steps
      if (!canContinue) {
        cc2.stop()
        cc2.start(cc2Columns(msg.board), msg.current, msg.next, msg.combo, msg.b2b, hold)
        clearCont()
        contQueueDepth = 1 + msg.next.length
      }
      result = searchWith(cc2, msg.board, steps, iterations, mySeq)
      // whatever was played, the cursor now sits after `chain.length` pieces;
      // remember that state so a matching follow-up request extends the search
      contKey = boardKey(result.board)
      const queueTypes = [msg.current, ...msg.next]
      contPiece = queueTypes[result.chain.length] ?? null
      contHold = hold
      contQueueDepth -= result.chain.length
    } else {
      // cc2's search cannot generate hold swaps itself, so plan both options
      // in fresh, equally-budgeted searches and keep the better line:
      //   A: play the falling piece            (hold slot stays)
      //   B: swap, then play the held piece    (falling piece moves into hold)
      const cfg = cc2ConfigJson(msg.profile)
      const botA = new Cc2Bot(cfg)
      botA.start(cc2Columns(msg.board), msg.current, msg.next, msg.combo, msg.b2b, hold)
      const resA = searchWith(botA, msg.board, steps, iterations, mySeq)
      const botB = new Cc2Bot(cfg)
      // branch B's root is the post-swap state: held piece falling, the old
      // falling piece sitting in the hold slot
      botB.start(cc2Columns(msg.board), hold, msg.next, msg.combo, msg.b2b, msg.current)
      const resB = searchWith(botB, msg.board, steps, iterations, mySeq)

      const preferA =
        resB.chain.length === 0 || (resA.chain.length > 0 && resA.eval >= resB.eval)
      const winner = preferA ? botA : botB
      const loser = preferA ? botB : botA
      try {
        loser.free()
      } catch {
        /* already dead */
      }
      dropCc2()
      cc2 = winner
      cc2Profile = msg.profile
      result = preferA ? resA : resB
      usedHold = !preferA
      // continuation state for the adopted line, expressed in real-game terms
      contKey = boardKey(result.board)
      const queueTypes = preferA
        ? [msg.current, ...msg.next]
        // after swap + placing the held piece, the old piece sits in hold
        : [msg.hold!, ...msg.next]
      contPiece = queueTypes[result.chain.length] ?? null
      contHold = preferA ? hold : msg.current!
      contQueueDepth = 1 + msg.next.length - result.chain.length
    }
    if (!result.chain.length) return null
    return { result, usedHold }
  } catch (err) {
    console.warn('cc2 search failed:', err)
    dropCc2()
    return null
  }
}

self.onmessage = async (e: MessageEvent<BotInMsg>) => {
  const msg = e.data
  if (msg.type !== 'state') return
  if (typeof msg.seq === 'number') latestSeq = msg.seq

  if (!(await ensureCc2())) {
    self.postMessage({ type: 'unavailable', reason: 'wasm init failed', seq: msg.seq } satisfies BotOutMsg)
    return
  }

  const planned = await cc2Plan(msg)
  // hint requests must always be answered (even empty) or the requester's
  // await flag sticks and its retry logic never fires
  if ((msg.hintCount ?? 0) > 0) {
    self.postMessage({
      type: 'hints',
      placements: planned?.result.chain.slice(0, msg.hintCount!) ?? [],
      hold: planned?.usedHold,
      seq: msg.seq,
    } satisfies BotOutMsg)
    if (!planned) return
  } else if (!planned) return

  const [first] = planned.result.chain
  if (first)
    self.postMessage({
      type: 'plan',
      x: first.x,
      rot: first.rot,
      spin: first.spin,
      cells: first.cells,
      hold: planned.usedHold,
      seq: msg.seq,
    } satisfies BotOutMsg)
}
