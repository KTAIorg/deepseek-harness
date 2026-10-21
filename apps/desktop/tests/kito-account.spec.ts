import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { handleKitoAppRoute } from '../src/kito-account-route.ts'
import { readStoredCredential } from '../src/kito-credentials.ts'
import {
  accountUsageRequest,
  criticalRetryDelayMs,
  fetchKitoAccount,
  KITO_CONSOLE_PAGES,
  newapiQuotaToUsd,
  refreshKitoIdentity,
  usdFromAccountUsage,
} from '../src/kito-identity.ts'
import { consoleLogoutRequest, consoleRefreshRequest, establishKitoConsoleSession, parseSetCookie } from '../src/kito-wallet.ts'

describe('Kito account summary', () => {
  it('uses the Telegram display name and the shared NewAPI balance', async () => {
    const view = await fetchKitoAccount('token', {
      fetchImpl: async (url) => {
        const target = String(url)
        if (target.endsWith('/identity/v1/account/me')) {
          return new Response(JSON.stringify({ account: { displayName: ' Ada ', accountNo: 'KT1' } }), { status: 200 })
        }
        if (target.endsWith('/api/iam/ensure')) {
          return new Response(JSON.stringify({ data: { quota: 1_000_000 } }), { status: 200 })
        }
        return new Response('unexpected', { status: 500 })
      },
    })
    expect(view).toEqual({ signedIn: true, displayName: 'Ada', accountNo: 'KT1', balance: 2 })
    expect(newapiQuotaToUsd(500_000)).toBe(1)
  })

  it('reads the nested Identity profile name', async () => {
    const view = await fetchKitoAccount('token', {
      fetchImpl: async (url) => {
        if (String(url).endsWith('/identity/v1/account/me')) {
          return new Response(JSON.stringify({
            account: { accountNo: 'KT1' },
            profile: { displayName: ' 豆豆 ' },
          }), { status: 200 })
        }
        return new Response(JSON.stringify({ data: { user: { quota: 500_000 } } }), { status: 200 })
      },
    })
    expect(view).toEqual({ signedIn: true, displayName: '豆豆', accountNo: 'KT1', balance: 1 })
  })

  it('reads the identity token from the credentials document without coercing it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'kito-credentials-'))
    await writeFile(join(home, '.credentials.yaml'), [
      'version: 1',
      'refs:',
      '  KITO_IDENTITY_TOKEN: ABC123',
      '  KITO_NEWAPI_API_KEY: "12345"',
      '',
    ].join('\n'))
    await expect(readStoredCredential('KITO_IDENTITY_TOKEN', home)).resolves.toBe('ABC123')
    await expect(readStoredCredential('KITO_NEWAPI_API_KEY', home)).resolves.toBe('12345')
    await expect(readStoredCredential('MISSING', home)).resolves.toBeUndefined()
  })

  it('reports a stored identity as signed in and does not ask the renderer to log in again', async () => {
    const response = await handleKitoAppRoute(new Request('dsh-app://app/kito/account'), {
      showWelcome: () => undefined,
      openWallet: async () => undefined,
      readToken: async () => 'stored-token',
      loadAccount: async () => ({ signedIn: true, displayName: '豆豆', balance: 3 }),
    })
    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toEqual({ signedIn: true, displayName: '豆豆', balance: 3 })
  })

  it('omits the balance when NewAPI does not report a quota', async () => {
    const view = await fetchKitoAccount('token', {
      fetchImpl: async (url) => {
        if (String(url).endsWith('/identity/v1/account/me')) {
          return new Response(JSON.stringify({ displayName: 'Ada' }), { status: 200 })
        }
        return new Response(JSON.stringify({ data: {} }), { status: 200 })
      },
    })
    expect(view).toEqual({ signedIn: true, displayName: 'Ada' })
  })

  it('keeps the KT account number and the Telegram username for support copy', async () => {
    const view = await fetchKitoAccount('token', {
      fetchImpl: async (url) => {
        if (String(url).endsWith('/identity/v1/account/me')) {
          return new Response(JSON.stringify({
            account: { displayName: 'Ada', accountNo: 'KT251018ABCD' },
            identities: [
              { provider: 'password', metadata: { login_name: 'ada' } },
              { provider: 'telegram', metadata: { username: '@ada_t' } },
            ],
          }), { status: 200 })
        }
        return new Response(JSON.stringify({ data: {} }), { status: 200 })
      },
    })
    expect(view).toEqual({
      signedIn: true,
      displayName: 'Ada',
      accountNo: 'KT251018ABCD',
      telegramUsername: 'ada_t',
    })
  })

  it('turns the stored login into a ktapi.cc console session without putting the token in the page URL', async () => {
    const cookie = parseSetCookie('new_api_refresh=sid.secret; Path=/api/user/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=3600')
    expect(cookie).toMatchObject({
      name: 'new_api_refresh', value: 'sid.secret', path: '/api/user/auth', httpOnly: true, secure: true, sameSite: 'strict',
    })
    let seenAuthorization = ''
    let seenUrl = ''
    const session = await establishKitoConsoleSession('identity-token', {
      walletUrl: 'https://www.ktapi.cc/wallet',
      fetchImpl: async (url, init) => {
        seenUrl = String(url)
        seenAuthorization = new Headers(init?.headers).get('authorization') ?? ''
        const headers = new Headers()
        headers.append('set-cookie', 'new_api_refresh=sid.secret; Path=/api/user/auth; HttpOnly; Secure; SameSite=Strict')
        headers.append('set-cookie', 'new_api_has_session=1; Path=/; Secure; SameSite=Strict')
        return new Response(JSON.stringify({ success: true }), { status: 200, headers })
      },
    })
    expect(seenUrl).toBe('https://www.ktapi.cc/api/iam/ensure')
    expect(seenAuthorization).toBe('Bearer identity-token')
    expect(session.pageUrl).toBe('https://www.ktapi.cc/wallet')
    expect(session.cookies.map(item => item.name)).toEqual(['new_api_refresh', 'new_api_has_session'])
  })

  it('opens the signed-in wallet from the account click and asks to log in when no account is stored', async () => {
    const opened: string[] = []
    let welcomed = false
    const signedIn = await handleKitoAppRoute(new Request('dsh-app://app/kito/topup', { method: 'POST' }), {
      showWelcome: () => { welcomed = true },
      openWallet: async (token) => { opened.push(token) },
      readToken: async () => 'stored-token',
    })
    expect(signedIn?.status).toBe(200)
    expect(opened).toEqual(['stored-token'])
    expect(welcomed).toBe(false)
    const signedOut = await handleKitoAppRoute(new Request('dsh-app://app/kito/topup', { method: 'POST' }), {
      showWelcome: () => { welcomed = true },
      openWallet: async (token) => { opened.push(token) },
      readToken: async () => undefined,
    })
    expect(signedOut?.status).toBe(401)
    expect(welcomed).toBe(true)
    expect(opened).toEqual(['stored-token'])
  })

  it('reads the wallet balance from the relay-key usage endpoint, including a negative amount', () => {
    const request = accountUsageRequest('https://ktapi.cc/', 'sk-secret')
    expect(request.url).toBe('https://ktapi.cc/api/usage/account/')
    expect(request.url).not.toContain('sk-secret')
    expect(new Headers(request.init.headers).get('authorization')).toBe('Bearer sk-secret')
    expect(usdFromAccountUsage({ success: true, data: { remaining_usd: 9.934818 } })).toBe(9.93)
    expect(usdFromAccountUsage({ data: { remaining_usd: -0.0651 } })).toBe(-0.07)
    expect(usdFromAccountUsage({ data: {} })).toBeUndefined()
    expect(criticalRetryDelayMs('522')).toBe(522_000)
    expect(criticalRetryDelayMs(null)).toBe(60_000)
    expect(criticalRetryDelayMs('9999')).toBe(20 * 60 * 1000)
    expect(KITO_CONSOLE_PAGES).toEqual({
      wallet: 'https://www.ktapi.cc/wallet',
      topups: 'https://www.ktapi.cc/wallet?show_history=true',
      usage: 'https://www.ktapi.cc/usage-logs/common',
      keys: 'https://www.ktapi.cc/keys',
    })
  })

  it('opens recharge history, usage, and tokens on the same console login as top-up', async () => {
    const opened: Array<[string, string]> = []
    const response = await handleKitoAppRoute(new Request('dsh-app://app/kito/open?target=usage', { method: 'POST' }), {
      showWelcome: () => undefined,
      openWallet: async () => undefined,
      openConsole: async (token, page) => { opened.push([token, page]) },
      readToken: async () => 'stored-token',
    })
    expect(response?.status).toBe(200)
    expect(opened).toEqual([['stored-token', 'usage']])
    const rejected = await handleKitoAppRoute(new Request('dsh-app://app/kito/open?target=https://evil.example', { method: 'POST' }), {
      showWelcome: () => undefined,
      openWallet: async () => undefined,
      openConsole: async (token, page) => { opened.push([token, page]) },
      readToken: async () => 'stored-token',
    })
    expect(rejected?.status).toBe(400)
    expect(opened).toEqual([['stored-token', 'usage']])
  })

  it('logs out through the existing ktapi.cc console logout', async () => {
    const request = consoleLogoutRequest('https://www.ktapi.cc/wallet', 'sid.secret')
    expect(request.url).toBe('https://www.ktapi.cc/api/user/auth/logout')
    expect(new Headers(request.init.headers).get('cookie')).toBe('new_api_refresh=sid.secret')
    expect(new Headers(request.init.headers).get('origin')).toBe('https://www.ktapi.cc')
    const refresh = consoleRefreshRequest('https://www.ktapi.cc/wallet', 'sid.secret')
    expect(refresh.url).toBe('https://www.ktapi.cc/api/user/auth/refresh')
    let signedOut = false
    const response = await handleKitoAppRoute(new Request('dsh-app://app/kito/sign-out', { method: 'POST' }), {
      showWelcome: () => undefined,
      openWallet: async () => undefined,
      signOutConsole: async () => { signedOut = true },
    })
    expect(response?.status).toBe(200)
    expect(signedOut).toBe(true)
  })

  it('removes the stored login on sign-out so a refresh cannot sign the person back in', async () => {
    const steps: string[] = []
    await handleKitoAppRoute(new Request('dsh-app://app/kito/sign-out', { method: 'POST' }), {
      showWelcome: () => undefined,
      openWallet: async () => undefined,
      signOutConsole: async () => { steps.push('console') },
      forgetIdentity: async () => { steps.push('identity') },
    })
    expect(steps).toEqual(['console', 'identity'])
  })

  it('renews an expired login once from the refresh token', async () => {
    let refreshes = 0
    const response = await handleKitoAppRoute(new Request('dsh-app://app/kito/account'), {
      showWelcome: () => undefined,
      openWallet: async () => undefined,
      readToken: async () => 'expired',
      loadAccount: async token => token === 'renewed' ? { signedIn: true, displayName: 'Ada' } : { signedIn: false },
      refreshIdentity: async () => { refreshes += 1; return 'renewed' },
    })
    await expect(response?.json()).resolves.toEqual({ signedIn: true, displayName: 'Ada' })
    expect(refreshes).toBe(1)
  })

  it('reports a stored model key and its balance when there is no login', async () => {
    const options = {
      showWelcome: () => undefined,
      openWallet: async () => undefined,
      readToken: async () => undefined,
      refreshIdentity: async () => undefined,
      readBalance: async () => 499.95,
    }
    const withKey = await handleKitoAppRoute(new Request('dsh-app://app/kito/account'), { ...options, hasModelKey: async () => true })
    await expect(withKey?.json()).resolves.toEqual({ signedIn: false, keyConfigured: true, balance: 499.95 })
    const unreadable = await handleKitoAppRoute(new Request('dsh-app://app/kito/account'), {
      ...options,
      hasModelKey: async () => true,
      readBalance: async () => { throw new Error('offline') },
    })
    await expect(unreadable?.json()).resolves.toEqual({ signedIn: false, keyConfigured: true })
    const withoutKey = await handleKitoAppRoute(new Request('dsh-app://app/kito/account'), { ...options, hasModelKey: async () => false })
    await expect(withoutKey?.json()).resolves.toEqual({ signedIn: false })
  })

  it('renews the Identity token through the device refresh endpoint', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const reply = (status: number, body: unknown) => async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify(body), { status })
    }
    await expect(refreshKitoIdentity('refresh-1', { baseUrl: 'https://login.test', fetchImpl: reply(200, { access_token: 'fresh' }) }))
      .resolves.toEqual({ token: 'fresh' })
    expect(requests[0]).toEqual({ url: 'https://login.test/identity/v1/device/token/refresh', body: { refresh_token: 'refresh-1' } })
    await expect(refreshKitoIdentity('refresh-1', { fetchImpl: reply(200, { data: { accessToken: 'fresh', refreshToken: 'refresh-2' } }) }))
      .resolves.toEqual({ token: 'fresh', refreshToken: 'refresh-2' })
    await expect(refreshKitoIdentity('refresh-1', { fetchImpl: reply(401, { error: 'invalid_refresh_token' }) })).resolves.toBeUndefined()
    await expect(refreshKitoIdentity('refresh-1', { fetchImpl: reply(503, { message: 'down' }) })).rejects.toThrow()
    await expect(refreshKitoIdentity('refresh-1', { fetchImpl: reply(200, {}) })).rejects.toThrow('unexpected payload')
  })
})
