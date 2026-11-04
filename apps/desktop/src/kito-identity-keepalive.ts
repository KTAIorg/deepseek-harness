/** Renews the stored KT Identity login on a schedule so model routes never meet an expired access token. */

/** Renewal cadence. The access token lives about 30 minutes; renewing at half that leaves room for a missed tick. */
export const KITO_IDENTITY_KEEPALIVE_MS = 15 * 60 * 1000
/** Focus and resume events closer together than this do not trigger another renewal. */
export const KITO_IDENTITY_KEEPALIVE_MIN_GAP_MS = 60 * 1000

export interface KitoIdentityKeepaliveOptions {
  /** Renews the Identity token; undefined means nothing could be issued. Network failures may throw. */
  readonly refresh: () => Promise<string | undefined>
  /** Called after a renewal stored a new token, so the workspace re-reads the account. */
  readonly onRenewed?: () => void
  /** Tick interval. Defaults to {@link KITO_IDENTITY_KEEPALIVE_MS}. */
  readonly intervalMs?: number
  /** Minimum gap between renewals triggered by {@link KitoIdentityKeepalive.poke}. */
  readonly minGapMs?: number
  /** Clock seam for tests. */
  readonly now?: () => number
  readonly setInterval?: (callback: () => void, ms: number) => unknown
  readonly clearInterval?: (handle: unknown) => void
}

export interface KitoIdentityKeepalive {
  /** Start the periodic renewal and run one immediately. Calling it again is a no-op. */
  start(): void
  /** Renew now unless one ran within the minimum gap. Use on window focus and system resume. */
  poke(): void
  /** Stop the periodic renewal. */
  stop(): void
}

/**
 * Build the keepalive. A failed renewal is logged without the token and retried on the next tick or poke.
 * @param options - renewal action and optional seams.
 * @returns start, poke and stop operations.
 */
export function createKitoIdentityKeepalive(options: KitoIdentityKeepaliveOptions): KitoIdentityKeepalive {
  const intervalMs = options.intervalMs ?? KITO_IDENTITY_KEEPALIVE_MS
  const minGapMs = options.minGapMs ?? KITO_IDENTITY_KEEPALIVE_MIN_GAP_MS
  const now = options.now ?? Date.now
  const schedule = options.setInterval ?? ((callback, ms) => setInterval(callback, ms))
  const cancel = options.clearInterval ?? ((handle) => { clearInterval(handle as ReturnType<typeof setInterval>) })
  let handle: unknown
  let lastRunAt: number | undefined

  const run = (): void => {
    lastRunAt = now()
    options.refresh().then((token) => {
      if (token !== undefined) options.onRenewed?.()
    }).catch((error: unknown) => {
      console.error('kito identity keepalive renewal failed', error instanceof Error ? error.message : 'unknown')
    })
  }

  return {
    start() {
      if (handle !== undefined) return
      handle = schedule(run, intervalMs)
      run()
    },
    poke() {
      if (handle === undefined) return
      if (lastRunAt !== undefined && now() - lastRunAt < minGapMs) return
      run()
    },
    stop() {
      if (handle === undefined) return
      cancel(handle)
      handle = undefined
    },
  }
}
