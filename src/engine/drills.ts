import { BOARD_W, TOTAL_H, VISIBLE_H, type Cell, type PieceType } from './types.ts'

export type DrillCategory = 'tspin' | 'pc' | 'opener' | 'stacking'

export type DrillGoal =
  | { kind: 'spinClears'; count: number }
  | { kind: 'perfectClear'; count: number }
  | { kind: 'lines'; count: number }
  | { kind: 'tetrises'; count: number }
  | { kind: 'flatPieces'; count: number }

export interface Drill {
  id: string
  name: string
  category: DrillCategory
  blurb: string
  tips: string[]
  /** pre-stacked rows, bottom row first; '.' empty, piece letters / 'G' filled */
  board?: string[]
  /** pieces drawn in this order before bag randomness resumes */
  queue?: PieceType[]
  /** drill fails when more than this many pieces are placed without meeting the goal */
  maxPieces?: number
  /** drill fails as soon as a new hole is created */
  failOnHole?: boolean
  goal: DrillGoal
}

export function parseDrillBoard(rows: string[]): Cell[][] {
  if (rows.length > VISIBLE_H) throw new Error('drill board too tall')
  const board: Cell[][] = Array.from({ length: TOTAL_H }, () => Array<Cell>(BOARD_W).fill(null))
  rows.forEach((row, j) => {
    if (row.length !== BOARD_W) throw new Error(`drill row ${j} must be ${BOARD_W} wide`)
    row.split('').forEach((c, x) => {
      if (c === '.') return
      // 'X' is a neutral wall cell; stored/rendered as garbage grey
      if (!'ITSZOJLGX'.includes(c)) throw new Error(`bad drill cell '${c}'`)
      board[TOTAL_H - 1 - j][x] = c === 'X' ? 'G' : (c as Cell)
    })
  })
  return board
}

export function describeGoal(drill: Drill): string {
  const g = drill.goal
  switch (g.kind) {
    case 'spinClears':
      return `${g.count}+ SPIN CLEAR${g.count > 1 ? 'S' : ''}`
    case 'perfectClear':
      return `${g.count} PERFECT CLEAR${g.count > 1 ? 'S' : ''}`
    case 'lines':
      return `${g.count}+ LINES CLEARED`
    case 'tetrises':
      return `${g.count} TETRISES`
    case 'flatPieces':
      return `${g.count} PLACEMENTS, NO HOLES`
  }
}

const BAG_REST: PieceType[] = ['I', 'O', 'S', 'Z', 'J', 'L']

// T-spin pockets never contain a complete row: a full row would clear on the
// first placement instead of waiting for the spin.
export const DRILLS: Drill[] = [
  {
    id: 'tsd-classic',
    name: 'TSD: CLASSIC NOTCH',
    category: 'tspin',
    blurb: 'The textbook freestyle T-spin double pocket: open channel, one-cell overhang, 3-wide notch.',
    tips: [
      'Rotate the T once mid-air so it points toward the notch, then soft-drop it down the channel.',
      'It rests in the slot with its nub in the notch; tap rotate once more and lock for the spin.',
      'Rotating after landing is what counts: a piece that merely falls into place locks without the spin.',
    ],
    board: ['XXXX.XXXXX', 'XXX...XXXX', 'XXXX..XXXX'],
    queue: ['T', ...BAG_REST],
    goal: { kind: 'spinClears', count: 1 },
  },
  {
    id: 'tsd-mirror',
    name: 'TSD: MIRROR NOTCH',
    category: 'tspin',
    blurb: 'The mirrored pocket: enter pointing the other way and spin counter-clockwise.',
    tips: [
      'Same shape mirrored: point the T left, drop down the channel on the right side.',
      'Finish with a counter-clockwise tap and lock for the spin double.',
      'Alternating between this and the classic notch trains both spin directions.',
    ],
    board: ['XXXXX.XXXX', 'XXXX...XXX', 'XXXX..XXXX'],
    queue: ['T', ...BAG_REST],
    goal: { kind: 'spinClears', count: 1 },
  },
  {
    id: 'pco-first-bag',
    name: 'PCO: FIRST PC',
    category: 'pc',
    blurb: 'Empty board. The Perfect Clear Opener guarantees a PC within roughly the first two bags regardless of order.',
    tips: [
      'Core pattern: O in a corner, S/Z stacked against the wall, J/L beside them, then I/T to finish 4 clean rows.',
      'Keep BOTH sides of your stack even early; a PC needs every column to end at exactly the same height.',
      'Turn on assist with the PERFECT CLEAR profile to watch the intended line before replaying it yourself.',
      'If the first bag leaves no PC path, keep the stack flat and look for the PC in the second bag.',
    ],
    maxPieces: 12,
    goal: { kind: 'perfectClear', count: 1 },
  },
  {
    id: 'tki-3stack',
    name: 'OPENER: TKI 3-STACK',
    category: 'opener',
    blurb: 'Fixed first bag. Build the famous TKI 3-stack: I flat, T on top, L/J capping; an instant T-spin chance.',
    tips: [
      'Place I flat on the floor left-of-centre, T pointing left directly on top of it.',
      'Cap the T with L (or J) to complete the 3-stack shape; hold whatever does not fit.',
      'The finished shape has a built-in TSD slot; look for the overhang you just created.',
      'Replaying the exact same queue every retry builds placement muscle memory.',
    ],
    queue: ['I', 'T', 'L', 'J', 'O', 'S', 'Z'],
    maxPieces: 10,
    goal: { kind: 'spinClears', count: 1 },
  },
  {
    id: 'dt-cannon',
    name: 'OPENER: DT CANNON',
    category: 'opener',
    blurb: 'Fixed first bag. Build the DT cannon start: twin J/L wells, S/Z fill, T loaded for big early attack.',
    tips: [
      'J and L stand upright forming two adjacent wells on one side; S and Z slot around them.',
      'The T drops last into the notch between the wells for a spin double or triple.',
      'Count heights as you place: the cannon shape stays symmetric about its centre columns.',
    ],
    queue: ['J', 'L', 'S', 'Z', 'T', 'O', 'I'],
    maxPieces: 10,
    goal: { kind: 'lines', count: 2 },
  },
  {
    id: 'flat-stack',
    name: 'STACKING: FLAT STACK',
    category: 'stacking',
    blurb: 'Place 20 pieces creating zero holes. The live HOLE/BUMP readouts show how clean your stacking is.',
    tips: [
      'Drop pieces onto the LOWEST columns first; never bury a gap deeper than one row.',
      'Keep bumpiness low by flattening peaks into valleys; flat stacks give every future piece a home.',
      'Use hold to postpone pieces that would create a hole instead of forcing them.',
    ],
    failOnHole: true,
    goal: { kind: 'flatPieces', count: 20 },
  },
  {
    id: 'well-tetrises',
    name: 'STACKING: WELL DISCIPLINE',
    category: 'stacking',
    blurb: 'Build 3 tetrises. Commit to one well column and keep everything else flat while you wait for the I.',
    tips: [
      'Pick one side column as the well and never fill it until the I-piece arrives.',
      'Shape the rest of the stack into a flat 4-row ramp leading into the well.',
      'Watch the NEXT queue: start shaping the well only when the I is visible within two pieces.',
    ],
    maxPieces: 30,
    goal: { kind: 'tetrises', count: 3 },
  },
]

export const DRILL_BY_ID = new Map(DRILLS.map((d) => [d.id, d]))
