import { describe, expect, it, vi } from 'vitest'
import { renderBoard, drawMiniPiece } from './canvas'

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

  it('renders a 20-row visible board (opponent relay) by padding hidden rows', () => {
    const ctx = context()
    const visible = Array.from({ length: 20 }, (_, i) => Array(10).fill(i === 19 ? 'T' : null))
    renderBoard(ctx, visible, null, null, { cellSize: 8, showGhost: false })
    // a valid board draws the background and cells instead of bailing out early
    expect(ctx.fillRect).toHaveBeenCalled()
  })

  it('drawMiniPiece renders a held piece without throwing', () => {
    const ctx = context()
    expect(() => drawMiniPiece(ctx, 'T', 60, 24, 12)).not.toThrow()
    expect(ctx.fillRect).toHaveBeenCalled()
  })
})
