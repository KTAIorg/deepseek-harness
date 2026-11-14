import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => {
  const jar: Array<{ name: string; value: string; path?: string | undefined }> = []
  const cookiesGet = vi.fn(async (filter?: { name?: string }) => (
    filter?.name ? jar.filter(cookie => cookie.name === filter.name) : [...jar]
  ))
  const cookiesSet = vi.fn(async (cookie: { name: string; value: string; path?: string | undefined }) => {
    const idx = jar.findIndex(item => item.name === cookie.name && item.path === cookie.path)
    if (idx >= 0) jar[idx] = { name: cookie.name, value: cookie.value, path: cookie.path }
    else jar.push({ name: cookie.name, value: cookie.value, path: cookie.path })
  })
  const cookiesRemove = vi.fn(async (_url: string, name: string) => {
    for (let i = jar.length - 1; i >= 0; i -= 1) {
      if (jar[i]?.name === name) jar.splice(i, 1)
    }
  })
  return {
    jar,
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

import { KitoConsoleSessionError, openKitoConsole, readKitoAccountBalance, signOutKitoConsole } from '../src/kito-wallet-window.ts'

afterEach(async () => {
  electronMock.jar.length = 0
  electronMock.cookiesGet.mockClear()
  electronMock.cookiesSet.mockClear()
  electronMock.cookiesRemove.mockClear()
  await signOutKitoConsole({ fetchImpl: async () => new Response(null, { status: 200 }) })
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

describe('openKitoConsole', () => {
  const makeFakeWindow = () => {
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    const webHandlers = new Map<string, Array<(...args: unknown[]) => void>>()
    let currentUrl = 'about:blank'
    const fake = {
      destroyed: false,
      loaded: [] as string[],
      closed: false,
      setTitle: vi.fn(),
      isDestroyed: () => fake.destroyed,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      close: () => {
        fake.closed = true
        fake.destroyed = true
        for (const fn of handlers.get('closed') ?? []) fn()
      },
      on: (ev: string, fn: (...args: unknown[]) => void) => {
        handlers.set(ev, [...(handlers.get(ev) ?? []), fn])
      },
      loadURL: vi.fn(async (url: string) => {
        fake.loaded.push(url)
        currentUrl = url
      }),
      webContents: {
        setWindowOpenHandler: vi.fn(),
        getURL: () => currentUrl,
        on: (ev: string, fn: (...args: unknown[]) => void) => {
          webHandlers.set(ev, [...(webHandlers.get(ev) ?? []), fn])
        },
        emitNavigate: (ev: string, url: string) => {
          currentUrl = url
          for (const fn of webHandlers.get(ev) ?? []) fn({}, url)
        },
      },
    }
    return fake
  }

  it('throws KitoConsoleSessionError on 409 without opening an unauthenticated login window', async () => {
    const createWindow = vi.fn()
    await expect(openKitoConsole('id-token', 'wallet', {
      deviceId: 'dev-1',
      createWindow,
      fetchImpl: async () => new Response(JSON.stringify({ code: 'AUTH_SESSION_LIMIT', message: 'Conflict' }), { status: 409 }),
    })).rejects.toMatchObject({ name: 'KitoConsoleSessionError', kind: 'session-limit', status: 409 })
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('preserves stored refresh cookie on transient refresh error instead of creating a new session', async () => {
    electronMock.jar.push({ name: 'new_api_refresh', value: 'sid.secret', path: '/api/user/auth' })
    const fake = makeFakeWindow()
    const calls: string[] = []
    await openKitoConsole('id-token', 'usage', {
      deviceId: 'dev-1',
      createWindow: () => fake as never,
      fetchImpl: async (url) => {
        calls.push(urlOf(url))
        return new Response(null, { status: 503 })
      },
    })
    expect(calls).toEqual(['https://www.ktapi.cc/api/user/auth/refresh'])
    expect(electronMock.cookiesRemove).not.toHaveBeenCalled()
    expect(fake.loaded).toEqual(['https://www.ktapi.cc/usage-logs/common'])
  })

  it('coalesces concurrent open calls onto a single ensure and single window', async () => {
    const fake = makeFakeWindow()
    let ensureCalls = 0
    let releaseEnsure!: () => void
    const gate = new Promise<void>((resolve) => { releaseEnsure = resolve })
    const fetchImpl: typeof fetch = async (url, init) => {
      if (urlOf(url).endsWith('/api/iam/ensure')) {
        ensureCalls += 1
        expect(new Headers(init?.headers).get('x-kito-device-id')).toBe('dev-serial')
        await gate
        const headers = new Headers()
        headers.append('set-cookie', 'new_api_refresh=sid.one; Path=/api/user/auth; HttpOnly; SameSite=Strict')
        headers.append('set-cookie', 'new_api_has_session=1; Path=/; SameSite=Strict')
        return new Response(JSON.stringify({ success: true }), { status: 200, headers })
      }
      return new Response(null, { status: 500 })
    }

    const first = openKitoConsole('id-token', 'wallet', {
      deviceId: 'dev-serial',
      createWindow: () => fake as never,
      fetchImpl,
    })
    const second = openKitoConsole('id-token', 'usage', {
      deviceId: 'dev-serial',
      createWindow: () => fake as never,
      fetchImpl,
    })
    releaseEnsure()
    await Promise.all([first, second])
    expect(ensureCalls).toBe(1)
    expect(fake.loaded).toEqual(['https://www.ktapi.cc/wallet', 'https://www.ktapi.cc/usage-logs/common'])
  })

  it('recovers once when the SPA redirects client-side to /sign-in?redirect=...', async () => {
    electronMock.jar.push({ name: 'new_api_refresh', value: 'sid.stale', path: '/api/user/auth' })
    const fake = makeFakeWindow()
    let ensureCalls = 0
    await openKitoConsole('id-token', 'wallet', {
      deviceId: 'dev-spa',
      createWindow: () => fake as never,
      fetchImpl: async (url) => {
        if (urlOf(url).endsWith('/api/user/auth/refresh')) {
          return new Response(JSON.stringify({ success: true }), { status: 200 })
        }
        if (urlOf(url).endsWith('/api/iam/ensure')) {
          ensureCalls += 1
          const headers = new Headers()
          headers.append('set-cookie', 'new_api_refresh=sid.fresh; Path=/api/user/auth; HttpOnly; SameSite=Strict')
          return new Response(JSON.stringify({ success: true }), { status: 200, headers })
        }
        return new Response(null, { status: 500 })
      },
    })
    fake.webContents.emitNavigate('did-navigate-in-page', 'https://www.ktapi.cc/sign-in?redirect=%2Fwallet')
    await vi.waitFor(() => { expect(ensureCalls).toBe(1) })
    await vi.waitFor(() => { expect(fake.loaded).toEqual(['https://www.ktapi.cc/wallet', 'https://www.ktapi.cc/wallet']) })
    expect(electronMock.cookiesRemove).toHaveBeenCalled()
    expect(KitoConsoleSessionError).toBeDefined()
  })
})
