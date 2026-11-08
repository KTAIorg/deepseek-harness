/**
 * Client cache of "this model answers right now" probe outcomes.
 *
 * The Host owns the probe (`POST /kito/model-probe`): it holds the relay key and
 * the gateway endpoint. This module only remembers the answers, bounds how often
 * they are asked for, and exposes one snapshot the selector can subscribe to.
 * Results stay usable for {@link PROBE_STALE_MS}, matching the desktop's own
 * catalogue lifetime, so reopening the selector does not re-probe every time.
 */

/** Outcome classes the Host reports. */
export type ProbeState = 'ok' | 'rate_limited' | 'unauthorized' | 'not_found' | 'upstream_error' | 'network'

/** One model's cached outcome. */
export interface ProbeOutcome {
  /** Whether the model answered. */
  readonly ok: boolean
  /** Outcome class. */
  readonly state: ProbeState
  /** HTTP status when the gateway answered. */
  readonly status?: number
  /** Short server or transport message. */
  readonly message?: string
  /** Round trip in milliseconds. */
  readonly latencyMs: number
  /** Epoch milliseconds when this outcome was recorded. */
  readonly at: number
}

/** Observable probe state for the selector. */
export interface ProbeSnapshot {
  /** Outcomes keyed by `provider:model`. */
  readonly results: Readonly<Record<string, ProbeOutcome>>
  /** Keys currently being probed. */
  readonly pending: Readonly<Record<string, true>>
  /** When the last batch finished, or null before the first run. */
  readonly probedAt: number | null
  /** Whether a batch is in flight. */
  readonly running: boolean
  /** Models finished in the current or last batch. */
  readonly done: number
  /** Models requested in the current or last batch. */
  readonly total: number
  /** Transport or protocol failure of the batch itself. */
  readonly error: string | null
}

/** How long an outcome stays fresh. */
export const PROBE_STALE_MS = 30 * 60 * 1000

/** Models per HTTP request, so progress moves while a long family is still being checked. */
const PROBE_CHUNK = 12

/** Route the desktop shell answers on its application origin. */
const DESKTOP_PROBE_PATH = 'dsh-app://app/kito/model-probe'
/** Route a browser build reaches on the Host origin. */
const HOST_PROBE_PATH = '/kito/model-probe'

/**
 * Where this renderer asks for probe results.
 *
 * The desktop renderer is served from `dsh-app://app/`, so a relative path
 * would never reach the Host web server; the shell answers the probe on its own
 * origin because it already holds the relay key. A browser build has no shell
 * and posts to the Host route instead.
 * @returns the absolute or origin-relative probe URL.
 */
function probeEndpoint(): string {
  return 'dshDesktop' in globalThis ? DESKTOP_PROBE_PATH : HOST_PROBE_PATH
}

/** One model the selector wants checked. */
export interface ProbeTarget {
  readonly provider: string
  readonly model: string
}

const EMPTY: ProbeSnapshot = {
  results: {}, pending: {}, probedAt: null, running: false, done: 0, total: 0, error: null,
}

/** Key one model inside the shared result map. */
export function probeKey(provider: string, model: string): string {
  return `${provider}:${model}`
}

/**
 * Read one outcome, ignoring anything past {@link PROBE_STALE_MS}.
 * @param snapshot - current probe state.
 * @param provider - model provider.
 * @param model - model id.
 * @returns the fresh outcome, or undefined.
 */
export function freshOutcome(snapshot: ProbeSnapshot, provider: string, model: string): ProbeOutcome | undefined {
  const outcome = snapshot.results[probeKey(provider, model)]
  if (outcome === undefined) return undefined
  return Date.now() - outcome.at < PROBE_STALE_MS ? outcome : undefined
}

/**
 * Read the batch-wide staleness, which decides whether opening the selector
 * should quietly refresh the results.
 * @param snapshot - current probe state.
 * @returns whether a new batch is worth starting.
 */
export function probeIsStale(snapshot: ProbeSnapshot): boolean {
  return snapshot.probedAt === null || Date.now() - snapshot.probedAt >= PROBE_STALE_MS
}

/** Renderer-side probe cache; one account per renderer, so one instance. */
class ModelProbeStore {
  private snapshot: ProbeSnapshot = EMPTY
  private readonly listeners = new Set<() => void>()
  private inflight: Promise<void> | undefined

  /** @param listener - called after every snapshot change. @returns unsubscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** @returns the current snapshot. */
  getSnapshot = (): ProbeSnapshot => this.snapshot

  private publish(patch: Partial<ProbeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  /**
   * Probe the given models, sharing one in-flight batch.
   * Only the account-backed route is probeable; other providers have no
   * endpoint, so their rows keep no dot.
   * @param targets - models to check.
   * @param options - `force` re-probes models whose outcome is still fresh.
   * @returns after the batch settles.
   */
  run = async (targets: readonly ProbeTarget[], options: { force?: boolean } = {}): Promise<void> => {
    if (this.inflight !== undefined) return this.inflight
    const wanted = targets.filter(target => target.provider === 'ktapi')
    if (wanted.length === 0) return
    const keys = wanted.map(target => probeKey(target.provider, target.model))
    const pendingKeys = options.force === true
      ? keys
      : keys.filter((key) => {
        const outcome = this.snapshot.results[key]
        return outcome === undefined || Date.now() - outcome.at >= PROBE_STALE_MS
      })
    if (pendingKeys.length === 0) return
    this.publish({
      pending: Object.fromEntries(pendingKeys.map(key => [key, true as const])),
      running: true, done: 0, total: pendingKeys.length, error: null,
    })
    this.inflight = this.execute(wanted.filter(target => pendingKeys.includes(probeKey(target.provider, target.model))))
      .finally(() => { this.inflight = undefined })
    return this.inflight
  }

  private async execute(targets: readonly ProbeTarget[]): Promise<void> {
    const results = { ...this.snapshot.results }
    const at = Date.now()
    let done = 0
    try {
      for (let start = 0; start < targets.length; start += PROBE_CHUNK) {
        const chunk = targets.slice(start, start + PROBE_CHUNK)
        const response = await fetch(probeEndpoint(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ models: chunk.map(target => target.model) }),
        })
        const payload = await response.json().catch(() => undefined) as
          | { results?: readonly RawResult[]; error?: string; message?: string }
          | undefined
        if (!response.ok || payload?.results === undefined) {
          this.publish({
            running: false, pending: {},
            error: payload?.message ?? payload?.error ?? `HTTP ${String(response.status)}`,
          })
          return
        }
        for (const result of payload.results) {
          if (result.provider !== undefined && result.provider !== 'ktapi') continue
          results[probeKey('ktapi', result.model)] = {
            ok: result.ok,
            state: result.state,
            ...result.status === undefined ? {} : { status: result.status },
            ...result.message === undefined ? {} : { message: result.message },
            latencyMs: result.latencyMs ?? 0,
            at,
          }
        }
        done += chunk.length
        const nextPending = Object.fromEntries(targets.slice(start + PROBE_CHUNK)
          .map(target => [probeKey(target.provider, target.model), true as const]))
        this.publish({ results: { ...results }, pending: nextPending, done })
      }
      this.publish({ running: false, pending: {}, probedAt: at, done: targets.length, error: null })
    } catch (error) {
      this.publish({ running: false, pending: {}, error: error instanceof Error ? error.message : 'probe request failed' })
    }
  }
}

interface RawResult {
  readonly model: string
  readonly ok: boolean
  readonly state: ProbeState
  readonly status?: number
  readonly message?: string
  readonly latencyMs?: number
  readonly provider?: string
}

/** The renderer's single probe cache. */
export const modelProbe = new ModelProbeStore()
