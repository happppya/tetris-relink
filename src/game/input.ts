import type { InputAction } from '../engine/types'
import type { GameRunner } from './runner'

const DIR_ACTIONS: InputAction[] = ['moveLeft', 'moveRight']
const HELD_ACTIONS: InputAction[] = ['softDrop', 'moveLeft', 'moveRight']

/** Builds a code -> action map from keybinds (used by InputManager). */
export function codeMapFrom(keybinds: Record<InputAction, string>): Partial<Record<string, InputAction>> {
  const map: Partial<Record<string, InputAction>> = {}
  for (const [action, code] of Object.entries(keybinds)) {
    if (code) map[code] = action as InputAction
  }
  return map
}

/** Creates an attached InputManager wired to the given keybinds. */
export function bindInput(keybinds: Record<InputAction, string>): InputManager {
  const input = new InputManager(() => codeMapFrom(keybinds))
  input.attach()
  return input
}

export interface FrameControls {
  /** tap actions drained this frame (already queued into the runner). */
  actions: InputAction[]
  hardDrop: boolean
  retry: boolean
  pause: boolean
  assist: boolean
}

/**
 * Drains one frame of discrete inputs from `input` into the runner's buffered
 * action queue and reports which UI control keys were pressed. Call exactly once
 * per animation frame and always pass the drained `actions` along via this
 * helper — draining without queueing drops the actions on non-ticking frames.
 */
export function drainFrame(
  input: Pick<InputManager, 'drainActions'>,
  runner: Pick<GameRunner, 'queueActions'>,
): FrameControls {
  const actions = input.drainActions()
  runner.queueActions(actions)
  return {
    actions,
    hardDrop: actions.includes('hardDrop'),
    retry: actions.includes('retry'),
    pause: actions.includes('pause'),
    assist: actions.includes('assist'),
  }
}

export class InputManager {
  private held = new Set<InputAction>()
  private dirStack: Array<'moveLeft' | 'moveRight'> = []
  readonly actionQueue: InputAction[] = []
  private keyHandler: (e: KeyboardEvent) => void
  private upHandler: (e: KeyboardEvent) => void
  private blurHandler: () => void
  private getCodeMap: () => Partial<Record<string, InputAction>>

  constructor(getCodeMap: () => Partial<Record<string, InputAction>>) {
    this.getCodeMap = getCodeMap
    this.keyHandler = (e) => {
      const action = this.getCodeMap()[e.code]
      if (!action) return
      e.preventDefault()
      if (e.repeat) return
      if (!HELD_ACTIONS.includes(action)) this.actionQueue.push(action)
      if (DIR_ACTIONS.includes(action)) {
        const dir = action as 'moveLeft' | 'moveRight'
        if (!this.dirStack.includes(dir)) this.dirStack.push(dir)
      }
      if (HELD_ACTIONS.includes(action)) this.held.add(action)
    }
    this.upHandler = (e) => {
      const action = this.getCodeMap()[e.code]
      if (!action) return
      this.held.delete(action)
      this.dirStack = this.dirStack.filter((d) => d !== action)
    }
    this.blurHandler = () => {
      this.held.clear()
      this.dirStack = []
    }
  }

  attach() {
    window.addEventListener('keydown', this.keyHandler)
    window.addEventListener('keyup', this.upHandler)
    window.addEventListener('blur', this.blurHandler)
  }

  detach() {
    window.removeEventListener('keydown', this.keyHandler)
    window.removeEventListener('keyup', this.upHandler)
    window.removeEventListener('blur', this.blurHandler)
    this.reset()
  }

  reset() {
    this.held.clear()
    this.dirStack = []
    this.actionQueue.length = 0
  }

  get dir(): -1 | 0 | 1 {
    const top = this.dirStack[this.dirStack.length - 1]
    if (top === 'moveLeft') return -1
    if (top === 'moveRight') return 1
    return 0
  }

  get softDrop(): boolean {
    return this.held.has('softDrop')
  }

  drainActions(): InputAction[] {
    return this.actionQueue.splice(0, this.actionQueue.length)
  }
}
