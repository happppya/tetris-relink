import { describe, expect, it, vi } from 'vitest'
import { renderBoard } from './canvas'

function context(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: '',
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

describe('renderBoard', () => {
  it.each([
    [],
    Array.from({ length: 24 }, () => undefined),
    Array.from({ length: 24 }, (_, i) => (i === 7 ? undefined : Array(10).fill(null))),
    Array.from({ length: 24 }, () => Array(9).fill(null)),
  ])('does not throw for malformed boards', (board) => {
    expect(() => renderBoard(context(), board as never, null, null, { cellSize: 8, showGhost: false })).not.toThrow()
  })
})
