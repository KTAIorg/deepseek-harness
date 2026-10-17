import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { handleKitoAppRoute } from '../src/kito-account-route.ts'
import { readStoredCredential } from '../src/kito-credentials.ts'
import { fetchKitoAccount, newapiQuotaToUsd } from '../src/kito-identity.ts'
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
    expect(view).toEqual({ signedIn: true, displayName: 'Ada', balance: 2 })
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
    expect(view).toEqual({ signedIn: true, displayName: '豆豆', balance: 1 })
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
})
