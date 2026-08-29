import { describe, expect, it } from 'vitest'
import { InputManager, bindInput, codeMapFrom, drainFrame } from './input'
import type { InputAction } from '../engine/types'
import { handlingFromSettings, msToFrames } from '../state/settings'

const keybinds: Record<InputAction, string> = {
  moveLeft: 'ArrowLeft',
  moveRight: 'ArrowRight',
  softDrop: 'ArrowDown',
  hardDrop: 'Space',
  rotateCW: 'KeyX',
  rotateCCW: 'KeyZ',
  rotate180: 'KeyA',
  hold: 'KeyC',
  retry: 'KeyR',
  pause: 'Escape',
  assist: 'KeyG',
}

describe('codeMapFrom', () => {
  it('maps key codes to actions and skips unbound codes', () => {
    const map = codeMapFrom({ ...keybinds, rotate180: '' })
    expect(map.ArrowLeft).toBe('moveLeft')
    expect(map.Space).toBe('hardDrop')
    expect(map.KeyA).toBeUndefined() // unbound action omitted
  })
})

describe('bindInput', () => {
  it('returns an InputManager already attached to the given keybinds', () => {
    const windowRef = (globalThis as { window?: unknown }).window
    // attach() only registers window listeners; stub them so the test runs headless.
    ;(globalThis as { window?: unknown }).window = {
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    try {
      const input = bindInput(keybinds)
      expect(input).toBeInstanceOf(InputManager)
      expect(input.drainActions()).toEqual([])
    } finally {
      if (windowRef === undefined) delete (globalThis as { window?: unknown }).window
      else (globalThis as { window?: unknown }).window = windowRef
    }
  })
})

describe('drainFrame', () => {
  it('drains actions into the runner queue and reports control keys', () => {
    const input = new InputManager(() => codeMapFrom(keybinds))
    input.actionQueue.push('rotateCW', 'hardDrop', 'retry', 'pause', 'assist')

    const queued: InputAction[][] = []
    const runner = { queueActions: (actions: InputAction[]) => queued.push([...actions]) }

    const ctrl = drainFrame(input, runner)

    expect(queued).toHaveLength(1)
    expect(queued[0]).toEqual(['rotateCW', 'hardDrop', 'retry', 'pause', 'assist'])
    expect(ctrl.hardDrop).toBe(true)
    expect(ctrl.retry).toBe(true)
    expect(ctrl.pause).toBe(true)
    expect(ctrl.assist).toBe(true)
    expect(ctrl.actions).toEqual(queued[0])
    // the queue is drained, so a second call yields nothing
    expect(input.drainActions()).toEqual([])
  })

  it('leaves queues untouched on an empty frame', () => {
    const input = new InputManager(() => codeMapFrom(keybinds))
    const queued: InputAction[][] = []
    const runner = { queueActions: (actions: InputAction[]) => queued.push([...actions]) }

    const ctrl = drainFrame(input, runner)

    expect(queued).toEqual([[]])
    expect(ctrl.hardDrop).toBe(false)
    expect(ctrl.retry).toBe(false)
    expect(ctrl.pause).toBe(false)
    expect(ctrl.assist).toBe(false)
  })
})

describe('handlingFromSettings', () => {
  it('converts DAS/ARR/SDF timings to 60Hz frame counts', () => {
    const h = handlingFromSettings({ dasMs: 133, arrMs: 33, sddMs: 33 })
    expect(h).toEqual({
      dasFrames: Math.max(1, msToFrames(133)),
      arrFrames: msToFrames(33),
      sddFrames: msToFrames(33),
    })
    expect(h.dasFrames).toBeGreaterThan(0)
  })

  it('never returns a zero DAS frame count even for instant settings', () => {
    expect(handlingFromSettings({ dasMs: 0, arrMs: 0, sddMs: 0 }).dasFrames).toBe(1)
  })
})