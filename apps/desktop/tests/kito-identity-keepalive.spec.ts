import { describe, expect, it, vi } from 'vitest'
import {
  createKitoIdentityKeepalive,
  KITO_IDENTITY_KEEPALIVE_MIN_GAP_MS,
  KITO_IDENTITY_KEEPALIVE_MS,
} from '../src/kito-identity-keepalive.ts'

function harness(overrides: Partial<Parameters<typeof createKitoIdentityKeepalive>[0]> = {}) {
  let clock = 1_000_000
  let tick: (() => void) | undefined
  const handle = Symbol('interval')
  const setIntervalSpy = vi.fn((callback: () => void, _ms: number) => {
    tick = callback
    return handle
  })
  const clearIntervalSpy = vi.fn()
  const refresh = vi.fn<() => Promise<string | undefined>>(async () => 'fresh')
  const onRenewed = vi.fn()
  const keepalive = createKitoIdentityKeepalive({
    refresh,
    onRenewed,
    now: () => clock,
    setInterval: setIntervalSpy,
    clearInterval: clearIntervalSpy,
    ...overrides,
  })
  return {
    keepalive,
    refresh,
    onRenewed,
    setIntervalSpy,
    clearIntervalSpy,
    handle,
    advance: (ms: number) => { clock += ms },
    fire: () => { tick?.() },
  }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
}

describe('Kito Identity keepalive', () => {
  it('renews once at start and schedules the default interval', async () => {
    const h = harness()
    h.keepalive.start()
    await settle()
    expect(h.refresh).toHaveBeenCalledTimes(1)
    expect(h.setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), KITO_IDENTITY_KEEPALIVE_MS)
    expect(h.onRenewed).toHaveBeenCalledTimes(1)
  })

  it('renews again on every scheduled tick', async () => {
    const h = harness()
    h.keepalive.start()
    h.fire()
    h.fire()
    await settle()
    expect(h.refresh).toHaveBeenCalledTimes(3)
  })

  it('ignores a second start while running', () => {
    const h = harness()
    h.keepalive.start()
    h.keepalive.start()
    expect(h.setIntervalSpy).toHaveBeenCalledTimes(1)
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('honours a custom interval', () => {
    const h = harness({ intervalMs: 5_000 })
    h.keepalive.start()
    expect(h.setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000)
  })

  it('throttles pokes inside the minimum gap and allows one after it', () => {
    const h = harness()
    h.keepalive.start()
    h.advance(KITO_IDENTITY_KEEPALIVE_MIN_GAP_MS - 1)
    h.keepalive.poke()
    expect(h.refresh).toHaveBeenCalledTimes(1)
    h.advance(1)
    h.keepalive.poke()
    expect(h.refresh).toHaveBeenCalledTimes(2)
  })

  it('honours a custom minimum gap', () => {
    const h = harness({ minGapMs: 10 })
    h.keepalive.start()
    h.advance(10)
    h.keepalive.poke()
    expect(h.refresh).toHaveBeenCalledTimes(2)
  })

  it('does nothing on poke before start or after stop', () => {
    const h = harness()
    h.keepalive.poke()
    expect(h.refresh).not.toHaveBeenCalled()
    h.keepalive.start()
    h.keepalive.stop()
    h.advance(KITO_IDENTITY_KEEPALIVE_MS)
    h.keepalive.poke()
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('stops the interval once and ignores a repeated stop', () => {
    const h = harness()
    h.keepalive.stop()
    expect(h.clearIntervalSpy).not.toHaveBeenCalled()
    h.keepalive.start()
    h.keepalive.stop()
    h.keepalive.stop()
    expect(h.clearIntervalSpy).toHaveBeenCalledTimes(1)
    expect(h.clearIntervalSpy).toHaveBeenCalledWith(h.handle)
  })

  it('can start again after stop', () => {
    const h = harness()
    h.keepalive.start()
    h.keepalive.stop()
    h.keepalive.start()
    expect(h.setIntervalSpy).toHaveBeenCalledTimes(2)
    expect(h.refresh).toHaveBeenCalledTimes(2)
  })

  it('does not announce a renewal when no token was issued', async () => {
    const h = harness({ refresh: vi.fn(async () => undefined) })
    h.keepalive.start()
    await settle()
    expect(h.onRenewed).not.toHaveBeenCalled()
  })

  it('works without a renewal callback', async () => {
    const refresh = vi.fn<() => Promise<string | undefined>>(async () => 'fresh')
    const keepalive = createKitoIdentityKeepalive({
      refresh,
      setInterval: () => Symbol('interval'),
      clearInterval: () => undefined,
    })
    keepalive.start()
    await settle()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('logs a failed renewal without the token and keeps renewing on later ticks', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce('not an error object')
      .mockResolvedValueOnce('fresh')
    const h = harness({ refresh })
    h.keepalive.start()
    h.fire()
    h.fire()
    await settle()
    expect(error).toHaveBeenNthCalledWith(1, 'kito identity keepalive renewal failed', 'offline')
    expect(error).toHaveBeenNthCalledWith(2, 'kito identity keepalive renewal failed', 'unknown')
    expect(h.onRenewed).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it('uses the real timers and clock when no seams are given', async () => {
    vi.useFakeTimers()
    try {
      const refresh = vi.fn<() => Promise<string | undefined>>(async () => 'fresh')
      const keepalive = createKitoIdentityKeepalive({ refresh, intervalMs: 1_000, minGapMs: 500 })
      keepalive.start()
      expect(refresh).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(refresh).toHaveBeenCalledTimes(2)
      keepalive.stop()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(refresh).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
