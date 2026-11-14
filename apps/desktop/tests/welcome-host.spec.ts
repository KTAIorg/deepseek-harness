/** Native onboarding reuses authenticated Web RPC and never reads credential values. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectDesktopWelcome } from '../src/welcome-backend.ts'

function transport(preference?: string) {
  const keys = new Map<string, string>()
  const namespaces = [
    { ns: 'llm-deepseek', value: { apiKeyEnv: 'CUSTOM_DEEPSEEK_KEY' } },
    { ns: 'llm-pi-ai', value: { profiles: { example: { apiKeyEnv: 'EXAMPLE_API_KEY' } } } },
    { ns: 'locale', value: preference === undefined ? {} : { preference } },
  ]
  const send = vi.fn<NonNullable<Parameters<typeof connectDesktopWelcome>[2]>>(async (_input, init) => {
    const { rpcId, method, payload } = JSON.parse(init!.body as string) as {
      rpcId: string
      method: string
      payload: { args: { ref: string; value: string; refs: string[] } }
    }
    let value: unknown
    if (method === 'account/getState') value = { links: { usageUrl: 'http://localhost/usage', topUpUrl: 'http://localhost/top_up' }, status: 'signed-out', attempt: null }
    else if (method === 'settings/describe') value = { namespaces }
    else if (method === 'llm/listConfigurableProviders') value = [{ settingsNs: 'llm-pi-ai', settingsPath: ['profiles', 'example'] }]
    else if (method === 'productAnalytics/enabled') value = true
    else if (method === 'productAnalytics/report') value = undefined
    else if (method === 'credentials/set') keys.set(payload.args.ref, payload.args.value)
    else value = Object.fromEntries(payload.args.refs.map(ref => [ref, { configured: keys.has(ref), writable: true }]))
    return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
  })
  return { send, keys, namespaces }
}

const url = 'http://127.0.0.1:19387/'
const cookie = 'dsh-auth-fixture=signed'

afterEach(() => { vi.unstubAllEnvs() })

describe('desktop welcome Web operations', () => {
  it.each(['kito', 'local'])('uses the independent Kito account instead of DeepSeek state: %s', async (profile) => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', profile)
    const host = transport()
    const backend = connectDesktopWelcome(url, cookie, host.send)
    expect(await backend.read()).toMatchObject({ loggedIn: false, hasApiKey: false, writable: false, themePreference: 'system' })
    expect(host.send.mock.calls.every(([, init]) => !(init?.body as string | undefined)?.includes('account/getState'))).toBe(true)
  })

  it.each(['light', 'dark', 'system'] as const)('reads the live %s theme in the existing settings request', async (preference) => {
    const host = transport()
    host.namespaces.push({ ns: 'ui-theme', value: { preference } })
    const backend = connectDesktopWelcome(url, cookie, host.send)
    expect(await backend.read()).toMatchObject({ themePreference: preference })
    expect(host.send.mock.calls.filter(([input]) => input.endsWith('/api/settings/describe'))).toHaveLength(1)
    host.namespaces.find(item => item.ns === 'ui-theme')!.value.preference = 'system'
    expect(await backend.read()).toMatchObject({ themePreference: 'system' })
  })

  it('falls back for an invalid optional theme without blocking startup metadata', async () => {
    const host = transport()
    host.namespaces.push({ ns: 'ui-theme', value: { preference: 'invalid' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await connectDesktopWelcome(url, cookie, host.send).read()).toMatchObject({ themePreference: 'system' })
      expect(warn).toHaveBeenCalledOnce()
    } finally { warn.mockRestore() }
  })

  it('authenticates with the explicit Host cookie and stores only through the configured credential reference', async () => {
    const host = transport()
    const backend = connectDesktopWelcome(url, cookie, host.send)
    expect(await backend.analyticsEnabled()).toBe(true)
    expect(await backend.save('sk-example')).toEqual({ ok: true })
    expect(host.keys.get('KITO_NEWAPI_API_KEY')).toBe('sk-example')
    expect(await backend.read()).toEqual({ loggedIn: true, hasApiKey: true, writable: true, localePreference: null, themePreference: 'system' })
    for (const [input, init] of host.send.mock.calls) {
      expect(input).toMatch(/^http:\/\/127\.0\.0\.1:19387\/api\//u)
      expect(init).toMatchObject({ redirect: 'error', headers: { cookie } })
      expect(init).not.toHaveProperty('credentials')
    }
  })

  it('reads the explicit language preference and recognizes another provider key', async () => {
    const host = transport('zh')
    host.keys.set('EXAMPLE_API_KEY', 'sk-other')
    const backend = connectDesktopWelcome(url, cookie, host.send)
    expect(await backend.read()).toMatchObject({ localePreference: 'zh', hasApiKey: true })
    host.keys.clear()
    expect(await backend.read()).toMatchObject({ hasApiKey: false })
    expect(host.send.mock.calls.every(([, init]) => !(init?.body as string | undefined)?.includes('credentials/set'))).toBe(true)
  })

  it('reads language without querying account or model providers', async () => {
    const host = transport('zh')
    const backend = connectDesktopWelcome(url, cookie, host.send)
    host.send.mockClear()
    expect(await backend.readLocalePreference()).toBe('zh')
    expect(host.send).toHaveBeenCalledOnce()
    expect(host.send.mock.calls[0]![0]).toContain('/api/settings/describe')
  })

  it('allows profiles without the official provider and retains custom key detection', async () => {
    const host = transport()
    host.namespaces.splice(0, 1)
    const backend = connectDesktopWelcome(url, cookie, host.send)
    expect(await backend.read()).toMatchObject({ hasApiKey: false, writable: true })
    host.keys.set('EXAMPLE_API_KEY', 'custom-key')
    expect(await backend.read()).toMatchObject({ hasApiKey: true, writable: true })
    expect(await backend.save('official-key')).toEqual({ ok: true })
    expect(host.keys.get('KITO_NEWAPI_API_KEY')).toBe('official-key')
  })

  it.each(['', 'bad key', 'key\n'])('rejects malformed keys without contacting a provider: %s', async (value) => {
    const host = transport()
    const backend = connectDesktopWelcome(url, cookie, host.send)
    host.send.mockClear()
    expect(await backend.save(value)).toEqual({ ok: false })
    expect(host.send).not.toHaveBeenCalled()
  })

  it('keeps provider diagnostics out of failures and rejects unmatched RPC envelopes', async () => {
    const host = transport()
    const backend = connectDesktopWelcome(url, cookie, host.send)
    host.send.mockRejectedValueOnce(new Error('private credential sk-must-not-leak'))
    expect(await backend.save('sk-example')).toEqual({ ok: false })
    host.send.mockResolvedValueOnce(Response.json({ type: 'server-response', rpcId: 'other', result: { ok: true } }))
    await expect(backend.read()).rejects.toThrow('desktop welcome: settings/describe returned an invalid RPC envelope')
  })

  it('reports the failed method and remote code without provider diagnostics', async () => {
    const host = transport()
    const backend = connectDesktopWelcome(url, cookie, host.send)
    host.send.mockImplementationOnce(async (_input, init) => {
      const { rpcId } = JSON.parse(init?.body as string) as { rpcId: string }
      return Response.json({
        type: 'server-response', rpcId,
        result: { ok: false, error: { code: 'settings/unavailable', message: 'private credential sk-must-not-leak' } },
      })
    })
    const failure = backend.read()
    await expect(failure).rejects.toThrow('desktop welcome: settings/describe failed (settings/unavailable)')
    await expect(failure).rejects.not.toThrow('sk-must-not-leak')
  })

  it('submits native analytics through authenticated RPC with a bounded request', async () => {
    const host = transport()
    const backend = connectDesktopWelcome(url, cookie, host.send)
    const event = { eventName: 'desktop_app_launch' as const, timestamp: 100, attributes: {} }
    await backend.report(event)
    const [input, init] = host.send.mock.calls.at(-1)!
    expect(input).toBe('http://127.0.0.1:19387/api/productAnalytics/report')
    expect(init?.headers).toMatchObject({ cookie })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init!.body as string)).toMatchObject({ payload: { args: { event } } })
  })
})
