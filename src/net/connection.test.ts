import { afterEach, describe, expect, it, vi } from 'vitest'

describe('serverUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('falls back to the localhost default when VITE_SERVER_URL is unset', async () => {
    vi.unstubAllEnvs()
    vi.resetModules()
    const { serverUrl } = await import('./connection')
    expect(serverUrl()).toBe('ws://localhost:8787')
  })

  it('falls back to the localhost default when VITE_SERVER_URL is empty (CI without a repo variable)', async () => {
    vi.stubEnv('VITE_SERVER_URL', '')
    vi.resetModules()
    const { serverUrl } = await import('./connection')
    expect(serverUrl()).toBe('ws://localhost:8787')
  })

  it('uses the configured wss:// server when set', async () => {
    vi.stubEnv('VITE_SERVER_URL', 'wss://tetris.example/')
    vi.resetModules()
    const { serverUrl } = await import('./connection')
    expect(serverUrl()).toBe('wss://tetris.example/')
  })
})
