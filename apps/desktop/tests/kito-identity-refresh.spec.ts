import { describe, expect, it, vi } from 'vitest'
import { createKitoIdentityRefresher } from '../src/kito-identity-refresh.ts'

function deps(overrides: Partial<Parameters<typeof createKitoIdentityRefresher>[0]> = {}) {
  return {
    readRefreshToken: vi.fn(async () => 'refresh-1' as string | undefined),
    refresh: vi.fn(async () => ({ token: 'fresh' }) as { token: string; refreshToken?: string } | undefined),
    saveToken: vi.fn(async () => ({ ok: true })),
    saveRefreshToken: vi.fn(async () => ({ ok: true })),
    ...overrides,
  }
}

describe('Kito Identity refresh', () => {
  it('shares one renewal between concurrent account reads and stores the new token', async () => {
    const d = deps()
    const refresh = createKitoIdentityRefresher(d)
    await expect(Promise.all([refresh(), refresh()])).resolves.toEqual(['fresh', 'fresh'])
    expect(d.refresh).toHaveBeenCalledTimes(1)
    expect(d.refresh).toHaveBeenCalledWith('refresh-1')
    expect(d.saveToken).toHaveBeenCalledWith('fresh')
    expect(d.saveRefreshToken).not.toHaveBeenCalled()
  })

  it('does nothing when no sign-in stored a refresh token', async () => {
    const d = deps({ readRefreshToken: vi.fn(async () => undefined) })
    await expect(createKitoIdentityRefresher(d)()).resolves.toBeUndefined()
    expect(d.refresh).not.toHaveBeenCalled()
  })

  it('stops sending a rejected refresh token until a new sign-in stores another', async () => {
    let stored = 'refresh-1'
    const d = deps({
      readRefreshToken: vi.fn(async () => stored),
      refresh: vi.fn(async (token: string) => token === 'refresh-2' ? { token: 'fresh-2' } : undefined),
    })
    const refresh = createKitoIdentityRefresher(d)
    await expect(refresh()).resolves.toBeUndefined()
    await expect(refresh()).resolves.toBeUndefined()
    expect(d.refresh).toHaveBeenCalledTimes(1)
    stored = 'refresh-2'
    await expect(refresh()).resolves.toBe('fresh-2')
  })

  it('stores a rotated refresh token and still returns the renewed token when a save fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const d = deps({
      refresh: vi.fn(async () => ({ token: 'fresh', refreshToken: 'refresh-2' })),
      saveToken: vi.fn(async () => ({ ok: false })),
      saveRefreshToken: vi.fn(async () => ({ ok: false })),
    })
    await expect(createKitoIdentityRefresher(d)()).resolves.toBe('fresh')
    expect(d.saveRefreshToken).toHaveBeenCalledWith('refresh-2')
    expect(error).toHaveBeenCalledTimes(2)
    error.mockRestore()
  })

  it('lets a network failure reach the caller and retries on the next read', async () => {
    const d = deps({ refresh: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ token: 'fresh' }) })
    const refresh = createKitoIdentityRefresher(d)
    await expect(refresh()).rejects.toThrow('offline')
    await expect(refresh()).resolves.toBe('fresh')
  })
})
