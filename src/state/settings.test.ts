import { describe, expect, it } from 'vitest'
import { HANDLING_PRESETS, handlingPresetFromValues, DEFAULT_SETTINGS } from './settings'

describe('handling presets', () => {
  it('noob is the default and matches the default handling', () => {
    expect(HANDLING_PRESETS.noob).toEqual({ dasMs: 133, arrMs: 33, sddMs: 33 })
    expect(DEFAULT_SETTINGS.dasMs).toBe(HANDLING_PRESETS.noob.dasMs)
    expect(DEFAULT_SETTINGS.arrMs).toBe(HANDLING_PRESETS.noob.arrMs)
    expect(DEFAULT_SETTINGS.sddMs).toBe(HANDLING_PRESETS.noob.sddMs)
  })

  it('pro uses DAS 80 / ARR 0 / SDD 0', () => {
    expect(HANDLING_PRESETS.pro).toEqual({ dasMs: 80, arrMs: 0, sddMs: 0 })
  })

  it('detects the active preset from values and reports custom configs', () => {
    expect(handlingPresetFromValues(HANDLING_PRESETS.noob)).toBe('noob')
    expect(handlingPresetFromValues(HANDLING_PRESETS.pro)).toBe('pro')
    expect(handlingPresetFromValues({ dasMs: 100, arrMs: 0, sddMs: 0 })).toBeNull()
    // a single tweak off the preset is custom
    expect(handlingPresetFromValues({ ...HANDLING_PRESETS.pro, dasMs: 90 })).toBeNull()
  })
})
