import { describe, expect, it } from 'vitest'
import { ensureKitoModelKey, formatRelayKey, KITO_MANAGED_TOKEN_NAME } from '../src/kito-model-credential.ts'

/** One recorded request, so a test can assert the route and headers that were used. */
interface Call {
  readonly url: string
  readonly init: RequestInit | undefined
}

function recorder(handler: (call: Call) => Response | Promise<Response>): {
  fetchImpl: typeof fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init }
    calls.push(call)
    return handler(call)
  }) as typeof fetch
  return { fetchImpl, calls }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('Kito model credential', () => {
  it('derives the key from the dedicated ktapi route', async () => {
    const { fetchImpl, calls } = recorder(() => json({ key: 'abc123', created: true }))
    const credential = await ensureKitoModelKey('identity-token', { fetchImpl, baseUrl: 'https://ktapi.example' })

    expect(credential).toEqual({ key: 'sk-abc123', created: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://ktapi.example/api/iam/token/ensure')
    expect(calls[0]?.init?.method).toBe('POST')
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer identity-token')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ name: KITO_MANAGED_TOKEN_NAME })
  })

  it('keeps an already prefixed key untouched', async () => {
    const { fetchImpl } = recorder(() => json({ key: 'sk-ready', created: false }))
    const credential = await ensureKitoModelKey('identity-token', { fetchImpl, baseUrl: 'https://ktapi.example' })
    expect(credential.key).toBe('sk-ready')
    expect(credential.created).toBe(false)
  })

  it('falls back to the console session when the dedicated route is absent', async () => {
    const { fetchImpl, calls } = recorder((call) => {
      if (call.url.endsWith('/api/iam/token/ensure')) return new Response('not found', { status: 404 })
      if (call.url.endsWith('/api/iam/ensure')) {
        const headers = new Headers({ 'set-cookie': 'session=abc; Path=/' })
        return new Response(JSON.stringify({ data: { id: 7 } }), { status: 200, headers })
      }
      if (call.url.includes('/api/token/?')) return json({ data: [{ id: 42, name: 'kito' }] })
      if (call.url.endsWith('/api/token/42/key')) return json({ key: 'from-session' })
      return json({ unexpected: call.url }, 500)
    })

    const credential = await ensureKitoModelKey('identity-token', { fetchImpl, baseUrl: 'https://ktapi.example' })

    expect(credential).toEqual({ key: 'sk-from-session', created: false })
    const keyCall = calls.find(call => call.url.endsWith('/api/token/42/key'))
    const headers = keyCall?.init?.headers as Record<string, string>
    expect(headers.cookie).toBe('session=abc')
    expect(headers['New-Api-User']).toBe('7')
  })

  it('mints the managed token when the account has none', async () => {
    let listed = 0
    const { fetchImpl, calls } = recorder((call) => {
      if (call.url.endsWith('/api/iam/token/ensure')) return new Response('not found', { status: 404 })
      if (call.url.endsWith('/api/iam/ensure')) {
        return new Response(JSON.stringify({ data: { user: { id: 9 } } }), {
          status: 200,
          headers: new Headers({ 'set-cookie': 'session=xyz; Path=/' }),
        })
      }
      if (call.url.includes('/api/token/?')) {
        listed += 1
        return json({ data: listed === 1 ? [] : [{ id: 11, name: 'KITO' }] })
      }
      if (call.url.endsWith('/api/token/') && call.init?.method === 'POST') return json({ success: true })
      if (call.url.endsWith('/api/token/11/key')) return json({ key: 'minted' })
      return json({ unexpected: call.url }, 500)
    })

    const credential = await ensureKitoModelKey('identity-token', { fetchImpl, baseUrl: 'https://ktapi.example' })

    expect(credential).toEqual({ key: 'sk-minted', created: true })
    const mint = calls.find(call => call.url.endsWith('/api/token/') && call.init?.method === 'POST')
    expect(JSON.parse(String(mint?.init?.body))).toEqual({
      name: KITO_MANAGED_TOKEN_NAME,
      unlimited_quota: true,
      expired_time: -1,
    })
  })

  it('reports a rejected identity token with the status', async () => {
    const { fetchImpl } = recorder(() => json({ message: 'identity token expired' }, 401))
    await expect(ensureKitoModelKey('identity-token', { fetchImpl, baseUrl: 'https://ktapi.example' }))
      .rejects.toThrow(/identity token expired/)
  })

  it('rejects a blank identity token before any request', async () => {
    const { fetchImpl, calls } = recorder(() => json({}))
    await expect(ensureKitoModelKey('   ', { fetchImpl, baseUrl: 'https://ktapi.example' }))
      .rejects.toThrow(/required/)
    expect(calls).toHaveLength(0)
  })

  it('formats relay keys idempotently', () => {
    expect(formatRelayKey('plain')).toBe('sk-plain')
    expect(formatRelayKey('sk-plain')).toBe('sk-plain')
  })
})
