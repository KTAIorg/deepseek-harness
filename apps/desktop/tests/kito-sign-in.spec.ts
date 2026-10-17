import { describe, expect, it } from 'vitest'
import { createKitoSignIn } from '../src/kito-sign-in.ts'

describe('Kito welcome sign-in', () => {
  it('shows the Telegram code, then stores the NewAPI key', async () => {
    const published: string[] = []
    const saved: string[] = []
    let opened = ''
    let succeeded = false
    const signIn = createKitoSignIn({
      publish: (state) => { published.push(state.attempt?.phase ?? state.status) },
      saveKey: (key) => { saved.push(key); return Promise.resolve({ ok: true }) },
      onSuccess: () => { succeeded = true },
      openLogin: (url) => { opened = url },
      fetchImpl: async (url, init) => {
        const target = String(url)
        if (target.endsWith('/identity/v1/device/sessions') && init?.method === 'POST') {
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
          return new Response(JSON.stringify({ access_token: 'identity-token', subject: 'acc-1' }), { status: 200 })
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
    expect(succeeded).toBe(true)
    expect(state.status).toBe('credential-stored')
    expect(state.attempt?.phase).toBe('succeeded')
    expect(published).toContain('waiting-browser')
  })
})
