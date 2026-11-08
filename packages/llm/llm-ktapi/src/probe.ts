/**
 * Whether the account can actually call a model right now.
 *
 * A listing entry says the account's group routes the model; it says nothing
 * about the channel behind it. This probe sends the smallest possible request
 * (one token, no tools) and classifies what came back, so a selector can tell
 * "callable" from "listed" without the person finding out by failing a turn.
 */

/** One probe outcome class. */
export type ModelProbeState =
  /** The gateway streamed a completion. */
  | 'ok'
  /** Rate limited; temporary, so a selector should not treat it as broken. */
  | 'rate_limited'
  /** The credential or the account's permission was refused. */
  | 'unauthorized'
  /** The gateway does not route this model for this key. */
  | 'not_found'
  /** The channel failed; the model is listed but not serving. */
  | 'upstream_error'
  /** The request never reached a deciding server. */
  | 'network'

/** One model's probe outcome. */
export interface ModelProbeResult {
  /** Catalog model id that was probed. */
  readonly model: string
  /** Whether the model answered. */
  readonly ok: boolean
  /** Outcome class. */
  readonly state: ModelProbeState
  /** HTTP status when a response arrived. */
  readonly status?: number
  /** Short server or transport message, already truncated. */
  readonly message?: string
  /** Round trip in milliseconds. */
  readonly latencyMs: number
}

/** Input to one batch. */
export interface ModelProbeInput {
  /** Relay key derived from the account login. */
  readonly apiKey: string
  /** Gateway endpoint, with or without `/v1`. */
  readonly baseUrl: string
  /** Model ids to probe. */
  readonly models: readonly string[]
  /** Deadline for one model request. */
  readonly timeoutMs?: number
  /** Requests in flight at once. */
  readonly concurrency?: number
  /** Fetch implementation; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch
}

/** Deadline for one probed model. */
export const PROBE_TIMEOUT_MS = 8_000
/** Requests in flight at once. */
export const PROBE_CONCURRENCY = 4
/** Models probed per batch, so one request cannot occupy the gateway for minutes. */
export const PROBE_BATCH_LIMIT = 120

/**
 * Classify one response.
 * @param status - HTTP status.
 * @param body - parsed response body when the server answered JSON.
 * @returns the outcome class.
 */
export function probeStateOf(status: number, body: unknown): ModelProbeState {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'upstream_error'
  // A 400 usually means this model refuses the minimal request (tool-only or
  // reasoning-only routes); the channel itself answered, so it is not a
  // transport failure.
  const message = bodyMessage(body)
  if (message !== undefined && /rate limit|too many requests/iu.test(message)) return 'rate_limited'
  return 'upstream_error'
}

/**
 * Read a short server message from a gateway error body.
 * @param body - parsed response body.
 * @returns the message, or undefined when the body carries none.
 */
export function bodyMessage(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  const error = record.error
  if (typeof error === 'string') return truncate(error)
  if (error !== null && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return truncate(message)
  }
  if (typeof record.message === 'string') return truncate(record.message)
  return undefined
}

function truncate(value: string): string {
  return value.length <= 200 ? value : `${value.slice(0, 200)}…`
}

/**
 * Probe one model with the smallest request the route accepts.
 * @param input - credentials, endpoint and one model id.
 * @returns the classified outcome.
 */
export async function probeModel(input: Omit<ModelProbeInput, 'models' | 'concurrency'> & { readonly model: string }): Promise<ModelProbeResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const target = `${input.baseUrl.replace(/\/+$/u, '')}/chat/completions`
  const started = Date.now()
  try {
    const response = await fetchImpl(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? PROBE_TIMEOUT_MS),
    })
    const text = await response.text().catch(() => '')
    let body: unknown
    try {
      body = text.length === 0 ? undefined : JSON.parse(text)
    } catch (_error) {
      // A non-JSON body still carries the status, which is what classification uses.
      body = undefined
    }
    const state = probeStateOf(response.status, body)
    const message = bodyMessage(body)
    return {
      model: input.model,
      ok: state === 'ok',
      state,
      status: response.status,
      ...message === undefined ? {} : { message },
      latencyMs: Date.now() - started,
    }
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown transport failure'
    return { model: input.model, ok: false, state: 'network', message: truncate(message), latencyMs: Date.now() - started }
  }
}

/**
 * Probe several models with bounded concurrency.
 * @param input - credentials, endpoint, model ids and limits.
 * @returns one result per requested model, in request order.
 */
export async function probeModels(input: ModelProbeInput): Promise<ModelProbeResult[]> {
  const models = input.models.slice(0, PROBE_BATCH_LIMIT)
  if (models.length === 0) return []
  const results = new Array<ModelProbeResult>(models.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < models.length) {
      const index = next++
      const model = models[index]
      if (model === undefined) continue
      results[index] = await probeModel({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        model,
        ...input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs },
        ...input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl },
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(input.concurrency ?? PROBE_CONCURRENCY, models.length) }, worker))
  return results
}
