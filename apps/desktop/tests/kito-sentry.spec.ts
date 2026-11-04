import { afterEach, describe, expect, it, vi } from 'vitest'

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}))

vi.mock('@sentry/node', () => sentry)

async function load() {
  vi.resetModules()
  return import('../src/kito-sentry.ts')
}

afterEach(() => {
  delete process.env.DSH_SENTRY_DSN
  delete process.env.DSH_SENTRY_ENVIRONMENT
  sentry.init.mockReset()
  sentry.captureException.mockReset()
  sentry.flush.mockReset()
  sentry.flush.mockResolvedValue(true)
})

describe('Kito desktop error collection', () => {
  it('stays quiet when no DSN is configured', async () => {
    const collector = await load()
    expect(collector.initKitoSentry({ packaged: false, release: '0.2.1-rc.2' })).toBe(false)
    await collector.captureKitoFailure(new Error('renderer exited'), { source: 'renderer', phase: 'startup' })
    expect(sentry.init).not.toHaveBeenCalled()
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it('collects a development fatal without tracing or request data', async () => {
    process.env.DSH_SENTRY_DSN = 'https://public@sentry.ktyun.cc/1'
    const collector = await load()
    expect(collector.initKitoSentry({ packaged: false, release: '0.2.1-rc.2' })).toBe(true)
    const options = sentry.init.mock.calls[0]?.[0] as {
      environment: string
      tracesSampleRate: number
      beforeSend: (event: {
        request?: { url: string }
        user?: { id: string }
        exception?: { values?: { value?: string }[] }
      }) => unknown
    }
    expect(options.environment).toBe('development')
    expect(options.tracesSampleRate).toBe(0)
    const event = {
      request: { url: 'https://www.ktapi.cc/wallet' },
      user: { id: '378' },
      exception: { values: [{ value: 'refresh failed Bearer eyJhbGciOi.secret' }] },
    }
    expect(options.beforeSend(event)).toMatchObject({
      exception: { values: [{ value: 'refresh failed Bearer [redacted]' }] },
    })
    expect(event.request).toBeUndefined()
    expect(event.user).toBeUndefined()

    const failure = new Error('Desktop renderer exited: crashed')
    await collector.captureKitoFailure(failure, { source: 'renderer', phase: 'startup' })
    expect(sentry.captureException).toHaveBeenCalledWith(failure, {
      tags: { 'kito.source': 'renderer', 'kito.phase': 'startup', surface: 'desktop' },
    })
    expect(sentry.flush).toHaveBeenCalledOnce()
  })

  it('labels a packaged build separately from local development', async () => {
    process.env.DSH_SENTRY_DSN = 'https://public@sentry.ktyun.cc/1'
    const collector = await load()
    expect(collector.initKitoSentry({ packaged: true, release: '0.2.1-rc.2' })).toBe(true)
    expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({ environment: 'packaged' })
  })

  it('keeps a rejected DSN from stopping startup', async () => {
    process.env.DSH_SENTRY_DSN = 'not-a-dsn'
    sentry.init.mockImplementation(() => { throw new Error('Invalid DSN') })
    const collector = await load()
    expect(collector.initKitoSentry({ packaged: true, release: '0.2.1-rc.2' })).toBe(false)
    await collector.captureKitoFailure(new Error('startup'), { source: 'main', phase: 'startup' })
    expect(sentry.captureException).not.toHaveBeenCalled()
  })
})
