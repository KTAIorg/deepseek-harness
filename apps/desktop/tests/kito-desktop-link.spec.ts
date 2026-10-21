import http from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { runKitoDesktopLink } from '../src/kito-desktop-link.ts'

describe('Kito desktop link', () => {
  it('keeps an independent session and reports a conflict until the person switches', async () => {
    const seen: string[] = []
    const server = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`)
      if (req.method === 'GET') {
        res.end(JSON.stringify({ accountId: 'acct-new', displayName: 'New', allowSwitch: false }))
        return
      }
      res.end('{}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no port')
    const result = await runKitoDesktopLink(
      `kito-harness://desktop-login?port=${address.port}&request=${'ab'.repeat(32)}`,
      {
        currentAccountId: async () => 'acct-old',
        saveIdentity: async () => ({ ok: true }),
        saveKey: async () => ({ ok: true }),
        onSuccess: () => undefined,
      },
    )
    server.close()
    expect(result).toBe('account_conflict')
    expect(seen.some(line => line.startsWith('POST') && line.endsWith('/complete'))).toBe(true)
    expect(seen.some(line => line.includes('/approve'))).toBe(false)
  })

  it('reuses the same account without starting a device login', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`)
      return new Response(JSON.stringify({ accountId: 'acct', displayName: 'A', allowSwitch: false }), { status: 200 })
    }) as typeof fetch
    const result = await runKitoDesktopLink(
      `kito-harness://desktop-login?port=9&request=${'ab'.repeat(32)}`,
      {
        fetchImpl,
        currentAccountId: async () => 'acct',
        saveIdentity: async () => ({ ok: true }),
        saveKey: async () => ({ ok: true }),
        onSuccess: () => undefined,
      },
    )
    expect(result).toBe('reused')
    expect(calls.some(line => line.includes('/approve'))).toBe(false)
    expect(calls.some(line => line.includes('/commit'))).toBe(true)
  })

  it('tells the desktop the handoff failed', async () => {
    const bodies: string[] = []
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') bodies.push(String(init.body))
      if (String(url).endsWith('/complete')) return new Response('{}', { status: 200 })
      return new Response(JSON.stringify({ accountId: 'acct', displayName: 'A', allowSwitch: true }), { status: 200 })
    }) as typeof fetch
    await expect(runKitoDesktopLink(
      `kito-harness://desktop-login?port=9&request=${'cd'.repeat(32)}`,
      {
        fetchImpl,
        currentAccountId: async () => { throw new Error('account unreadable') },
        saveIdentity: async () => ({ ok: true }),
        saveKey: async () => ({ ok: true }),
        onSuccess: () => undefined,
      },
    )).rejects.toThrow(/unreadable/)
    expect(bodies.some(body => body.includes('"failed"'))).toBe(true)
  })

  it('rejects a login url that is not the desktop handoff', async () => {
    await expect(runKitoDesktopLink('https://example.com/desktop-login', {
      currentAccountId: async () => undefined,
      saveIdentity: async () => ({ ok: true }),
      saveKey: async () => ({ ok: true }),
      onSuccess: () => undefined,
    })).rejects.toThrow(/rejected/)
    expect(vi).toBeDefined()
  })
})
