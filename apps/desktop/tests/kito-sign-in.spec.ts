import { describe, expect, it, vi } from 'vitest'
import { finishKitoDeviceLogin } from '../src/kito-identity.ts'
import { createKitoSignIn } from '../src/kito-sign-in.ts'

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

describe('Kito welcome sign-in', () => {
  it('shows the Telegram code without opening Telegram, then stores the Identity token', async () => {
    const published: string[] = []
    const identities: string[] = []
    const refreshTokens: string[] = []
    let opened = ''
    let succeeded = false
    const signIn = createKitoSignIn({
      publish: (state) => { published.push(state.attempt?.phase ?? state.status) },
      saveIdentity: (token) => { identities.push(token); return Promise.resolve({ ok: true }) },
      saveRefreshToken: (token) => { refreshTokens.push(token); return Promise.resolve({ ok: true }) },
      onSuccess: () => { succeeded = true },
      openLogin: (url) => { opened = url },
      fetchImpl: async (url, init) => {
        const target = urlOf(url)
        if (target.endsWith('/identity/v1/device/sessions') && init?.method === 'POST') {
          const headers = new Headers(init.headers)
          expect(headers.get('user-agent')).toBe('Kito/2.0')
          const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as { client_type: string }
          expect(body.client_type).toBe('kito_desktop')
          return new Response(JSON.stringify({
            session_id: 'sess', user_code: 'ABCD', opaque_code: 'opaque',
            login_url: 'https://login.ktyun.cc/device', login_deeplink: 'tg://resolve?domain=bot&start=login_x',
            expires_at: '2099-01-01T00:00:00Z', interval: 1,
          }), { status: 200 })
        }
        if (target.endsWith('/identity/v1/device/sessions/sess')) {
          return new Response(JSON.stringify({ status: 'approved' }), { status: 200 })
        }
        if (target.endsWith('/token')) {
          return new Response(JSON.stringify({
            access_token: 'identity-token', subject: 'acc-1', refresh_token: 'refresh-1',
          }), { status: 200 })
        }
        return new Response('unexpected', { status: 500 })
      },
    })
    const state = await signIn.start()
    expect(opened).toBe('')
    expect(identities).toEqual(['identity-token'])
    expect(refreshTokens).toEqual(['refresh-1'])
    expect(succeeded).toBe(true)
    expect(state.status).toBe('credential-stored')
    expect(state.attempt?.phase).toBe('succeeded')
    expect(state.attempt?.deeplink).toBe('tg://resolve?domain=bot&start=login_x')
    expect(published).toContain('waiting-browser')
  })

  it('keeps polling after a dropped status request', async () => {
    let polls = 0
    const session = await finishKitoDeviceLogin({
      sessionId: 'sess',
      opaqueCode: 'opaque',
      intervalMs: 0,
      fetchImpl: async (url, init) => {
        const target = urlOf(url)
        if (target.endsWith('/identity/v1/device/sessions/sess') && init?.method === 'GET') {
          polls += 1
          if (polls === 1) throw new TypeError('fetch failed')
          return new Response(JSON.stringify({ status: 'approved' }), { status: 200 })
        }
        if (target.endsWith('/token')) {
          return new Response(JSON.stringify({ access_token: 'identity-token', subject: 'acc-1' }), { status: 200 })
        }
        return new Response('unexpected', { status: 500 })
      },
    })
    expect(polls).toBe(2)
    expect(session).toEqual({ accountId: 'acc-1', token: 'identity-token' })
  })

  it('stores the Identity token without contacting NewAPI', async () => {
    let newapiCalls = 0
    const signIn = createKitoSignIn({
      publish: () => undefined,
      saveIdentity: () => Promise.resolve({ ok: true }),
      onSuccess: () => undefined,
      fetchImpl: async (url, init) => {
        const target = urlOf(url)
        if (target.includes('://ktapi.cc') || target.includes('/api/iam/')) {
          newapiCalls += 1
          return new Response('unexpected', { status: 500 })
        }
        if (target.endsWith('/identity/v1/device/sessions') && init?.method === 'POST') {
          return new Response(JSON.stringify({
            session_id: 'sess', user_code: 'ABCD', opaque_code: 'opaque',
            login_url: 'https://login.ktyun.cc/device', expires_at: '2099-01-01T00:00:00Z', interval: 1,
          }), { status: 200 })
        }
        if (target.endsWith('/identity/v1/device/sessions/sess')) {
          return new Response(JSON.stringify({ status: 'approved' }), { status: 200 })
        }
        if (target.endsWith('/token')) {
          return new Response(JSON.stringify({ access_token: 'identity-token', subject: 'acc-1' }), { status: 200 })
        }
        return new Response('unexpected', { status: 500 })
      },
    })
    const state = await signIn.start()
    expect(newapiCalls).toBe(0)
    expect(state.status).toBe('credential-stored')
  })

  it('pushes to an active QR challenge, resends the same code, and opens the Telegram deep link with fallback', async () => {
    const bodies: unknown[] = []
    let opened: [string, string | undefined] | undefined
    const signIn = createKitoSignIn({
      publish: () => undefined,
      saveIdentity: () => Promise.resolve({ ok: true }),
      onSuccess: () => undefined,
      openLogin: (url, fallbackUrl) => { opened = [url, fallbackUrl] },
      fetchImpl: async (url, init) => {
        const target = urlOf(url)
        if (init?.method === 'POST' && typeof init.body === 'string') bodies.push(JSON.parse(init.body))
        if (target.endsWith('/identity/v1/device/sessions') && init?.method === 'POST') {
          return new Response(JSON.stringify({
            session_id: 'sess', user_code: 'K7Q2', opaque_code: 'opaque',
            login_url: 'https://t.me/bot?start=login_x', login_deeplink: 'tg://resolve?domain=bot&start=login_x',
            expires_at: '2099-01-01T00:00:00Z', interval: 60,
          }), { status: 200 })
        }
        if (target.endsWith('/hint')) return new Response('{}', { status: 202 })
        if (target.endsWith('/identity/v1/device/sessions/sess')) {
          return new Response(JSON.stringify({ status: 'pending' }), { status: 200 })
        }
        return new Response('unexpected', { status: 500 })
      },
    })
    const started = signIn.start()
    await vi.waitFor(() => { expect(signIn.state().attempt?.userCode).toBe('K7Q2') })
    expect(opened).toBeUndefined()
    const pushed = await signIn.push(signIn.state().attempt!.id, '@Ada_T')
    expect(pushed.attempt?.hint).toBe('ada_t')
    expect(pushed.attempt?.push).toBe('accepted')
    expect(bodies[1]).toMatchObject({ opaque_code: 'opaque', telegram_account: 'ada_t' })
    const early = await signIn.resend(signIn.state().attempt!.id)
    expect(early.attempt?.push).toBe('accepted')
    expect(bodies).toHaveLength(2)
    await signIn.openQr(signIn.state().attempt!.id)
    expect(opened).toEqual(['tg://resolve?domain=bot&start=login_x', 'https://t.me/bot?start=login_x'])
    await signIn.cancel(signIn.state().attempt!.id)
    await started
  })

  it('falls back to creating a hinted session when Identity returns 404 for /hint', async () => {
    const sessions: unknown[] = []
    let counter = 0
    const signIn = createKitoSignIn({
      publish: () => undefined,
      saveIdentity: () => Promise.resolve({ ok: true }),
      onSuccess: () => undefined,
      fetchImpl: async (url, init) => {
        const target = urlOf(url)
        if (target.endsWith('/identity/v1/device/sessions') && init?.method === 'POST') {
          counter += 1
          sessions.push(JSON.parse(typeof init.body === 'string' ? init.body : ''))
          return new Response(JSON.stringify({
            session_id: `sess-${counter}`, user_code: `CODE${counter}`, opaque_code: `opaque-${counter}`,
            login_url: `https://t.me/bot?start=login_${counter}`, login_deeplink: `tg://resolve?domain=bot&start=login_${counter}`,
            expires_at: '2099-01-01T00:00:00Z', interval: 60,
          }), { status: 200 })
        }
        if (target.endsWith('/hint')) return new Response('404 page not found', { status: 404 })
        if (target.includes('/identity/v1/device/sessions/')) {
          return new Response(JSON.stringify({ status: 'pending' }), { status: 200 })
        }
        return new Response('unexpected', { status: 500 })
      },
    })
    const initial = signIn.start()
    await vi.waitFor(() => { expect(signIn.state().attempt?.userCode).toBe('CODE1') })
    const pushed = signIn.push(signIn.state().attempt!.id, '@Ada_T')
    await vi.waitFor(() => { expect(signIn.state().attempt?.userCode).toBe('CODE2') })
    expect(sessions[1]).toMatchObject({ telegram_account: 'ada_t' })
    expect(signIn.state().attempt?.push).toBe('accepted')
    await signIn.cancel(signIn.state().attempt!.id)
    await Promise.allSettled([initial, pushed])
  })

  it('starts a session and opens Telegram when openQr is clicked before a challenge exists', async () => {
    let opened: [string, string | undefined] | undefined
    const signIn = createKitoSignIn({
      publish: () => undefined,
      saveIdentity: () => Promise.resolve({ ok: true }),
      onSuccess: () => undefined,
      openLogin: (url, fallbackUrl) => { opened = [url, fallbackUrl] },
      fetchImpl: async (url, init) => {
        const target = urlOf(url)
        if (target.endsWith('/identity/v1/device/sessions') && init?.method === 'POST') {
          return new Response(JSON.stringify({
            session_id: 'sess', user_code: 'OPEN1', opaque_code: 'opaque',
            login_url: 'https://t.me/bot?start=login_open', login_deeplink: 'tg://resolve?domain=bot&start=login_open',
            expires_at: '2099-01-01T00:00:00Z', interval: 60,
          }), { status: 200 })
        }
        if (target.endsWith('/identity/v1/device/sessions/sess')) {
          return new Response(JSON.stringify({ status: 'pending' }), { status: 200 })
        }
        return new Response('unexpected', { status: 500 })
      },
    })
    const running = signIn.openQr()
    await vi.waitFor(() => { expect(opened).toEqual(['tg://resolve?domain=bot&start=login_open', 'https://t.me/bot?start=login_open']) })
    await signIn.cancel(signIn.state().attempt!.id)
    await running
  })
})
