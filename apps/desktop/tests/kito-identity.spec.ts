/** Device-login polling for KT Identity. */

import { describe, expect, it } from 'vitest'
import { finishKitoDeviceLogin, startKitoDeviceLogin } from '../src/kito-identity.ts'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** @param handler - one response per request, in order. @returns the fetch stub and the recorded URLs. */
function recorder(handler: Array<() => Response>): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = []
  let index = 0
  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(String(input))
    const next = handler[Math.min(index, handler.length - 1)]
    index += 1
    if (next === undefined) throw new Error('recorder ran out of responses')
    return next()
  }) as typeof fetch
  return { fetchImpl, urls }
}

const challenge = {
  session_id: 's-1', user_code: 'ABCD', opaque_code: 'opaque',
  login_url: 'https://login.example/code', expires_at: '2026-11-08T00:00:00Z', interval: 5,
}
const token = { opaque_code: 'opaque', access_token: 'access', subject: 'kt-1' }

describe('KT Identity device login', () => {
  it('starts a session and returns the code and page to confirm', { timeout: 20_000 }, async () => {
    const { fetchImpl, urls } = recorder([() => json({ challenge })])
    const started = await startKitoDeviceLogin({ fetchImpl, baseUrl: 'https://identity.example' })

    expect(started).toMatchObject({ sessionId: 's-1', userCode: 'ABCD', opaqueCode: 'opaque' })
    expect(urls[0]).toBe('https://identity.example/identity/v1/device/sessions')
  })

  it('fails loudly when the start response omits the session', { timeout: 20_000 }, async () => {
    const { fetchImpl } = recorder([() => json({ challenge: {} })])
    await expect(startKitoDeviceLogin({ fetchImpl, baseUrl: 'https://identity.example' }))
      .rejects.toThrow(/unexpected payload/)
  })

  it('exchanges the code once the person approves', { timeout: 20_000 }, async () => {
    const { fetchImpl, urls } = recorder([
      () => json({ status: 'pending' }),
      () => json({ status: 'approved' }),
      () => json(token),
    ])
    const session = await finishKitoDeviceLogin({
      fetchImpl, baseUrl: 'https://identity.example', sessionId: 's-1', opaqueCode: 'opaque', intervalMs: 1,
    })

    expect(session.token).toBe('access')
    expect(urls.at(-1)).toBe('https://identity.example/identity/v1/device/sessions/s-1/token')
  })

  it('stops when the person denies the request', { timeout: 20_000 }, async () => {
    const { fetchImpl } = recorder([() => json({ status: 'denied' })])
    await expect(finishKitoDeviceLogin({
      fetchImpl, baseUrl: 'https://identity.example', sessionId: 's-1', opaqueCode: 'opaque', intervalMs: 1,
    })).rejects.toThrow(/denied/)
  })

  it('tolerates a rate limit and finishes on the next poll', { timeout: 20_000 }, async () => {
    const { fetchImpl } = recorder([
      () => json({ message: 'slow down' }, 429),
      () => json({ status: 'approved' }),
      () => json(token),
    ])
    const session = await finishKitoDeviceLogin({
      fetchImpl, baseUrl: 'https://identity.example', sessionId: 's-1', opaqueCode: 'opaque', intervalMs: 1,
    })

    expect(session.token).toBe('access')
  })

  it('gives up after repeated rate limits instead of polling forever', { timeout: 20_000 }, async () => {
    const { fetchImpl } = recorder([() => json({ message: 'slow down' }, 429)])
    await expect(finishKitoDeviceLogin({
      fetchImpl, baseUrl: 'https://identity.example', sessionId: 's-1', opaqueCode: 'opaque', intervalMs: 1,
    })).rejects.toThrow(/slow down/)
  })

  it('keeps polling through a transport failure', { timeout: 20_000 }, async () => {
    let call = 0
    const fetchImpl = (async () => {
      call += 1
      if (call === 1) throw new Error('socket hang up')
      return call === 2 ? json({ status: 'approved' }) : json(token)
    }) as unknown as typeof fetch
    const session = await finishKitoDeviceLogin({
      fetchImpl, baseUrl: 'https://identity.example', sessionId: 's-1', opaqueCode: 'opaque', intervalMs: 1,
    })

    expect(session.token).toBe('access')
  })

  it('stops when the caller cancels', { timeout: 20_000 }, async () => {
    const controller = new AbortController()
    const { fetchImpl } = recorder([() => { controller.abort(); return json({ status: 'pending' }) }])
    await expect(finishKitoDeviceLogin({
      fetchImpl, baseUrl: 'https://identity.example', sessionId: 's-1', opaqueCode: 'opaque',
      intervalMs: 1, signal: controller.signal,
    })).rejects.toThrow(/cancel/i)
  })

  it('stops when the code expires', { timeout: 20_000 }, async () => {
    const { fetchImpl } = recorder([() => json({ status: 'pending' })])
    await expect(finishKitoDeviceLogin({
      fetchImpl, baseUrl: 'https://identity.example', sessionId: 's-1', opaqueCode: 'opaque',
      intervalMs: 1, timeoutMs: 5,
    })).rejects.toThrow(/timed out|timeout/i)
  })
})
