import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => {
  const cookiesGet = vi.fn(async () => [] as Array<{ name: string; value: string; path?: string }>)
  const cookiesSet = vi.fn(async () => undefined)
  const cookiesRemove = vi.fn(async () => undefined)
  return {
    cookiesGet,
    cookiesSet,
    cookiesRemove,
    BrowserWindow: vi.fn(),
    session: {
      fromPartition: () => ({
        cookies: {
          get: cookiesGet,
          set: cookiesSet,
          remove: cookiesRemove,
        },
      }),
    },
  }
})

vi.mock('electron', () => electronMock)

import { readKitoAccountBalance, signOutKitoConsole } from '../src/kito-wallet-window.ts'

afterEach(async () => {
  electronMock.cookiesGet.mockReset()
  electronMock.cookiesGet.mockResolvedValue([])
  await signOutKitoConsole()
})

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

describe('readKitoAccountBalance', () => {
  it('reads spendable balance from /api/usage/account/ without creating a console session', async () => {
    const seenUrls: string[] = []
    const balance = await readKitoAccountBalance('id-token', {
      baseUrl: 'https://ktapi.example',
      readApiKey: async () => 'sk-managed',
      fetchImpl: async (url, init) => {
        seenUrls.push(urlOf(url))
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sk-managed')
        return new Response(JSON.stringify({
          success: true,
          data: { object: 'account_usage', quota_per_unit: 500_000, remain_quota: 227_350_659, remaining_usd: 454.701318 },
        }), { status: 200 })
      },
    })
    expect(balance).toBe(454.7)
    expect(seenUrls).toEqual(['https://ktapi.example/api/usage/account/'])
    expect(electronMock.cookiesSet).not.toHaveBeenCalled()
  })

  it('derives or refreshes the API key once when missing or rejected with 401', async () => {
    let calls = 0
    const refreshed = vi.fn(async () => 'sk-fresh')
    const balance = await readKitoAccountBalance('id-token', {
      baseUrl: 'https://ktapi.example',
      readApiKey: async () => 'sk-stale',
      refreshApiKey: refreshed,
      fetchImpl: async (_url, init) => {
        calls += 1
        const auth = new Headers(init?.headers).get('authorization')
        if (auth === 'Bearer sk-stale') return new Response(null, { status: 401 })
        return new Response(JSON.stringify({ data: { remaining_usd: 12.34 } }), { status: 200 })
      },
    })
    expect(calls).toBe(2)
    expect(refreshed).toHaveBeenCalledWith('id-token')
    expect(balance).toBe(12.34)
  })

  it('derives the API key on first read when none is stored locally yet', async () => {
    const refreshed = vi.fn(async () => 'sk-derived')
    const balance = await readKitoAccountBalance('id-token', {
      baseUrl: 'https://ktapi.example',
      readApiKey: async () => undefined,
      refreshApiKey: refreshed,
      fetchImpl: async () => new Response(JSON.stringify({ data: { remain_quota: 1_000_000, quota_per_unit: 500_000 } }), { status: 200 }),
    })
    expect(refreshed).toHaveBeenCalledWith('id-token')
    expect(balance).toBe(2)
  })

  it('backs off on 429 and falls back only to an existing console cookie when /api/usage/account/ is unavailable', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }))
    const missing = await readKitoAccountBalance('id-token', {
      baseUrl: 'https://ktapi.example',
      readApiKey: async () => 'sk-managed',
      fetchImpl: fetchMock,
    })
    expect(missing).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const limitedFetch = vi.fn(async () => new Response(null, { status: 429, headers: { 'retry-after': '120' } }))
    const throttled = await readKitoAccountBalance('id-token', {
      baseUrl: 'https://ktapi.example',
      readApiKey: async () => 'sk-managed',
      fetchImpl: limitedFetch,
    })
    expect(throttled).toBeUndefined()
    // Subsequent call within cooldown does not hit the network again.
    await expect(readKitoAccountBalance('id-token', {
      baseUrl: 'https://ktapi.example',
      readApiKey: async () => 'sk-managed',
      fetchImpl: limitedFetch,
    })).resolves.toBeUndefined()
    expect(limitedFetch).toHaveBeenCalledTimes(1)
  })
})
