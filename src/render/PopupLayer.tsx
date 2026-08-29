import { forwardRef } from 'react'

/**
 * Transparent overlay canvas for popup VFX (clear labels, send numbers).
 *
 * Sits above the board and the side panels (z-10) and never intercepts input,
 * so popups are no longer clipped by the board canvas edge or hidden behind
 * other elements when a clear happens at the edge of the board. Screens wrap
 * their board canvas in a `relative` container, place this inside, size it to
 * the board canvas (same width/height attrs), and draw their popup renderers
 * here each frame (clearing first, since nothing else repaints the layer).
 */
export const PopupLayer = forwardRef<HTMLCanvasElement>(function PopupLayer(_props, ref) {
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 z-10" />
})
