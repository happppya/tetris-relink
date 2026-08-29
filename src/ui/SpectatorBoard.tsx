import { useEffect, useRef } from 'react'
import { useSettings } from '../state/settings'
import { renderBoard } from '../render/canvas'
import { EffectsSystem, type EffectsConfig } from '../render/effects'
import { ClearPopupRenderer, clearLabels } from '../render/cleartext'
import { PopupLayer } from '../render/PopupLayer'
import { detectClearedRows } from '../render/spectator-fx'
import { HIDDEN_H, type Cell } from '../engine/types'
import type { ClearInfo, AttackResult } from '../engine/attack'

export type SpectatorDetail = 'full' | 'reduced'

/**
 * Board watched by a spectator (or a player watching opponents): the relayed
 * snapshot is drawn statically, and clears are inferred by diffing consecutive
 * snapshots, which drives a per-board EffectsSystem on top. 'full' detail (1v1
 * panels) uses the spectator's own effects config plus clear labels; 'reduced'
 * (compact grids) keeps just the row flash so tiny boards stay readable.
 */
const REDUCED_FX: EffectsConfig = { particles: 0, rings: 0, rowFlash: 1, beams: false, screenFlash: false, impact: false, sendPopups: false }

export function SpectatorBoard({ board, cell, detail }: { board: Cell[][] | null; cell: number; detail: SpectatorDetail }) {
  const settings = useSettings()
  const fxConfig = detail === 'full' ? settings.fx : REDUCED_FX
  const showLabels = detail === 'full' && settings.clearPopups
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const prevBoardRef = useRef<Cell[][] | null>(null)
  const lastBoardRef = useRef<Cell[][] | null>(null)
  const fxRef = useRef<EffectsSystem | null>(null)
  const popupsRef = useRef<ClearPopupRenderer | null>(null)

  // relay diff: a row that was full and isn't anymore = a clear. Also keeps
  // the freshest board in a ref for the draw loop (no render-time ref reads).
  useEffect(() => {
    const prev = prevBoardRef.current
    prevBoardRef.current = board
    lastBoardRef.current = board
    if (!prev || !board || prev === board) return
    const cleared = detectClearedRows(prev, board)
    if (!cleared.length || !fxRef.current) return
    const now = performance.now()
    const info: ClearInfo = { count: cleared.length, spin: 'none', piece: null, perfectClear: false }
    const attack: AttackResult = { baseLines: cleared.length, totalLines: cleared.length, comboMult: 1, b2b: false, streakBonus: 0, streakSent: false }
    // relays are the visible rows; the fx engine works in engine rows with the
    // hidden stack above, so shift the relayed index back into engine space
    fxRef.current.lineClear(cleared.map((y) => y + HIDDEN_H), cell, info, attack, 0)
    if (showLabels) popupsRef.current?.push(clearLabels(info), now)
  }, [board, cell, detail, showLabels])

  // per-board animation loop: board + fx overlay
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    // popup VFX draws on a dedicated overlay above the board
    const overlay = overlayRef.current!
    overlay.width = canvas.width
    overlay.height = canvas.height
    const overlayCtx = overlay.getContext('2d')!
    const fx = new EffectsSystem(fxConfig)
    fx.setShakeEnabled(false)
    fxRef.current = fx
    const popups = new ClearPopupRenderer()
    popupsRef.current = popups
    let raf = 0
    let last = performance.now()
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      const current = lastBoardRef.current
      if (Array.isArray(current) && current.length === 20 && current.every((row) => Array.isArray(row) && row.length === 10))
        renderBoard(ctx, current, null, null, { cellSize: cell, showGhost: false })
      fx.update(dt)
      fx.draw(ctx)
      fx.drawOverlay(ctx, canvas.width, canvas.height, t)
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height)
      if (showLabels) popups.draw(overlayCtx, overlay.width, overlay.height, t)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      fxRef.current = null
    }
  }, [cell, detail, fxConfig, showLabels])

  return (
    <div className="relative border border-neutral-800">
      <canvas ref={canvasRef} width={10 * cell} height={20 * cell} className="block" />
      <PopupLayer ref={overlayRef} />
    </div>
  )
}
