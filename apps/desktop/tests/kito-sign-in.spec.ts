import { describe, expect, it } from 'vitest'
import { finishKitoDeviceLogin } from '../src/kito-identity.ts'
import { createKitoSignIn } from '../src/kito-sign-in.ts'

describe('Kito welcome sign-in', () => {
  it('shows the Telegram code, then stores the NewAPI key', async () => {
    const published: string[] = []
    const saved: string[] = []
    const identities: string[] = []
    const refreshTokens: string[] = []
    let opened = ''
    let succeeded = false
    const signIn = createKitoSignIn({
      publish: (state) => { published.push(state.attempt?.phase ?? state.status) },
      saveKey: (key) => { saved.push(key); return Promise.resolve({ ok: true }) },
      saveIdentity: (token) => { identities.push(token); return Promise.resolve({ ok: true }) },
      saveRefreshToken: (token) => { refreshTokens.push(token); return Promise.resolve({ ok: true }) },
      onSuccess: () => { succeeded = true },
      openLogin: (url) => { opened = url },
      fetchImpl: async (url, init) => {
        const target = String(url)
        if (target.endsWith('/identity/v1/device/sessions') && init?.method === 'POST') {
          const headers = new Headers(init?.headers)
          expect(headers.get('user-agent')).toBe('Kito/2.0')
          const body = JSON.parse(String(init.body)) as { client_type: string }
          expect(body.client_type).toBe('kito_desktop')
          return new Response(JSON.stringify({
            session_id: 'sess', user_code: 'ABCD', opaque_code: 'opaque',
            login_url: 'https://login.ktyun.cc/device', expires_at: '2099-01-01T00:00:00Z', interval: 1,
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
        if (target.endsWith('/api/iam/token/ensure')) {
          return new Response(JSON.stringify({ key: 'relay' }), { status: 200 })
        }
        return new Response('unexpected', { status: 500 })
      },
    })
    const state = await signIn.start()
    expect(opened).toBe('https://login.ktyun.cc/device')
    expect(saved).toEqual(['sk-relay'])
    expect(identities).toEqual(['identity-token'])
    expect(refreshTokens).toEqual(['refresh-1'])
    expect(succeeded).toBe(true)
    expect(state.status).toBe('credential-stored')
    expect(state.attempt?.phase).toBe('succeeded')
    expect(published).toContain('waiting-browser')
  })

  it('keeps polling after a dropped status request', async () => {
    let polls = 0
    const session = await finishKitoDeviceLogin({
      sessionId: 'sess',
      opaqueCode: 'opaque',
      intervalMs: 0,
      fetchImpl: async (url, init) => {
        const target = String(url)
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

  it('retries a dropped NewAPI key request after Telegram confirms', async () => {
    let ensures = 0
    const signIn = createKitoSignIn({
      publish: () => undefined,
      saveKey: () => Promise.resolve({ ok: true }),
      onSuccess: () => undefined,
      fetchImpl: async (url, init) => {
        const target = String(url)
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
        if (target.endsWith('/api/iam/token/ensure')) {
          ensures += 1
          if (ensures === 1) throw new TypeError('fetch failed')
          return new Response(JSON.stringify({ key: 'relay' }), { status: 200 })
        }
        return new Response('unexpected', { status: 500 })
      },
    })
    const state = await signIn.start()
    expect(ensures).toBe(2)
    expect(state.status).toBe('credential-stored')
  })
})
