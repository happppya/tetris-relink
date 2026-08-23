import type { ActivePiece, PieceType, Pos } from './types'

const BASE: Record<PieceType, string[]> = {
  I: ['....', 'XXXX', '....', '....'],
  O: ['XX', 'XX'],
  T: ['.X.', 'XXX', '...'],
  S: ['.XX', 'XX.', '...'],
  Z: ['XX.', '.XX', '...'],
  J: ['X..', 'XXX', '...'],
  L: ['..X', 'XXX', '...'],
}

function rotateCW(m: string[]): string[] {
  const h = m.length
  const w = m[0].length
  const out: string[] = []
  for (let y = 0; y < h; y++) {
    let row = ''
    for (let x = 0; x < w; x++) row += m[h - 1 - x][y]
    out.push(row)
  }
  return out
}

const STATES = new Map<PieceType, Pos[][]>()
for (const type of Object.keys(BASE) as PieceType[]) {
  let m = BASE[type]
  const states: Pos[][] = []
  for (let r = 0; r < 4; r++) {
    const cells: Pos[] = []
    m.forEach((row, y) =>
      row.split('').forEach((c, x) => {
        if (c === 'X') cells.push({ x, y })
      }),
    )
    states.push(cells)
    m = rotateCW(m)
  }
  STATES.set(type, states)
}

export function cellsFor(type: PieceType, rot: number): readonly Pos[] {
  return STATES.get(type)![rot % 4]
}

// Spawn straddles the hidden/visible boundary so the piece is immediately
// visible while its top cells still sit above the playfield.
export function spawnPiece(type: PieceType): ActivePiece {
  switch (type) {
    case 'I':
      return { type, rot: 0, x: 3, y: 3 }
    case 'O':
      return { type, rot: 0, x: 4, y: 3 }
    default:
      return { type, rot: 0, x: 3, y: 3 }
  }
}
