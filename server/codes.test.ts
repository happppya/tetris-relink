import { describe, expect, it } from 'vitest'
import { CODE_LENGTH, generateCode } from './codes.ts'

describe('generateCode', () => {
  it('produces codes of the configured length', () => {
    expect(generateCode()).toHaveLength(CODE_LENGTH)
  })

  it('only uses unambiguous characters (no 0/O, 1/I/L)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/)
    }
  })

  it('respects an injected rng', () => {
    const rng = () => 0.999
    expect(generateCode(rng)).toBe('99999')
  })

  it('produces distinct codes', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(generateCode())
    expect(seen.size).toBeGreaterThan(900)
  })
})