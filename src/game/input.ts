import type { InputAction } from '../engine/types'

const DIR_ACTIONS: InputAction[] = ['moveLeft', 'moveRight']
const HELD_ACTIONS: InputAction[] = ['softDrop', 'moveLeft', 'moveRight']

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
