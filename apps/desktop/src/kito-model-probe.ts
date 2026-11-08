/** Answer "can this account call that model right now" for the desktop model selector. */

import { readStoredCredential } from './kito-credentials.ts'
import { KITO_NEWAPI_KEY_REF, newapiBaseUrl } from './kito-identity.ts'

/** One probe outcome class. */
export type KitoProbeState = 'ok' | 'rate_limited' | 'unauthorized' | 'not_found' | 'upstream_error' | 'network'

/** One model's outcome. */
export interface KitoProbeResult {
  readonly model: string
  readonly ok: boolean
  readonly state: KitoProbeState
  readonly status?: number
  readonly message?: string
  readonly latencyMs: number
}

/** Deadline for one probed model. */
const PROBE_TIMEOUT_MS = 8_000
/** Requests in flight at once. */
const PROBE_CONCURRENCY = 4
/** Models probed per request. */
const PROBE_LIMIT = 120

/**
 * Classify one gateway response.
 * @param status - HTTP status.
 * @param body - parsed response body when there is one.
 * @returns the outcome class.
 */
export function probeStateOf(status: number, body: unknown): KitoProbeState {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'upstream_error'
  const message = messageOf(body)
  if (message !== undefined && /rate limit|too many requests/iu.test(message)) return 'rate_limited'
  return 'upstream_error'
}

function messageOf(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  const error = record.error
  if (typeof error === 'string') return error.slice(0, 200)
  if (error !== null && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return message.slice(0, 200)
  }
  return typeof record.message === 'string' ? record.message.slice(0, 200) : undefined
}

/**
 * Probe one model with the smallest request the gateway accepts.
 * @param apiKey - relay key stored for this account.
 * @param baseURL - gateway origin.
 * @param model - catalog id.
 * @returns the classified outcome.
 */
async function probeModel(apiKey: string, baseURL: string, model: string): Promise<KitoProbeResult> {
  const started = Date.now()
  try {
    const response = await fetch(`${baseURL.replace(/\/+$/u, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const text = await response.text().catch(() => '')
    let body: unknown
    try {
      body = text.length === 0 ? undefined : JSON.parse(text)
    } catch (_error) {
      // A non-JSON body still carries the status, which decides the class.
      body = undefined
    }
    const state = probeStateOf(response.status, body)
    const message = messageOf(body)
    return {
      model,
      ok: state === 'ok',
      state,
      status: response.status,
      ...message === undefined ? {} : { message },
      latencyMs: Date.now() - started,
    }
  } catch (error) {
    return {
      model,
      ok: false,
      state: 'network',
      message: (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown transport failure').slice(0, 200),
      latencyMs: Date.now() - started,
    }
  }
}

/**
 * Probe several models with bounded concurrency.
 * @param models - catalog ids to check.
 * @returns one result per model, in request order; empty when signed out.
 */
export async function probeKitoModels(
  models: readonly string[],
): Promise<{ readonly probedAt: number; readonly results: readonly KitoProbeResult[] } | undefined> {
  const apiKey = await readStoredCredential(KITO_NEWAPI_KEY_REF)
  if (apiKey === undefined) return undefined
  const wanted = models.slice(0, PROBE_LIMIT)
  const results = new Array<KitoProbeResult>(wanted.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < wanted.length) {
      const index = next++
      const model = wanted[index]
      if (model === undefined) continue
      results[index] = await probeModel(apiKey, newapiBaseUrl(), model)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, wanted.length) }, worker))
  return { probedAt: Date.now(), results }
}
