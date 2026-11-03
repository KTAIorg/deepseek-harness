/**
 * Live model list for a route that reads `GET {baseURL}/models` instead of a
 * models array in configuration. The listing is the account's own catalog:
 * the gateway already filters it to the key's group. A gateway that knows each
 * model's reasoning levels states them in the row's `reasoning` object; a row
 * without one describes a non-reasoning model, because a live route has no
 * installed catalog entry to inherit capability from.
 */
import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { resolveRouteModels, THINKING_LEVELS } from './catalog.ts'
import type { PiAiCompatProfile, PiAiModality, PiAiReasoningEfforts } from './catalog.ts'
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_INPUT, DEFAULT_MAX_TOKENS } from './config.ts'

/** How long a successful listing may be reused before the next catalog read. */
export const LIVE_CATALOG_TTL_MS = 60_000

/** Discovery request header names this module owns; deployment headers never override them. */
const RESERVED_DISCOVERY_HEADERS = new Set(['accept', 'authorization', 'user-agent'])

/** Reasoning capability a listing row declares for one model. */
export interface LiveModelReasoning {
  /** pi-ai effort map — which levels the model offers and their wire spellings; `false` for a non-reasoning model. */
  readonly efforts: PiAiReasoningEfforts | false
  /** The gateway's declared default effort, when one is stated. */
  readonly defaultEffort?: ModelThinkingLevel
}

/** One chat-capable row from an OpenAI-style model listing. */
export interface LiveCatalogModel {
  readonly id: string
  readonly name?: string
  readonly reasoning?: LiveModelReasoning
}

const KNOWN_LEVELS: ReadonlySet<string> = new Set(THINKING_LEVELS)

/**
 * Translate one listing row's `reasoning` object into the effort map this
 * adapter's model materialization reads. Every level the gateway names maps to
 * itself on the wire — the gateway is OpenAI-compatible and spells its own
 * reasoning parameter with the same vocabulary — while `off` maps to `null`
 * (supported, send nothing).
 * @param value - the row's `reasoning` field, when the gateway states one.
 * @returns the translated capability; `undefined` when the row declares none.
 */
function parseRowReasoning(value: unknown): LiveModelReasoning | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const row = value as { efforts?: unknown; default?: unknown }
  if (!Array.isArray(row.efforts) || row.efforts.length === 0) {
    return { efforts: false, ...defaultEffort(row.default) }
  }
  const levels = row.efforts.filter((level): level is string => typeof level === 'string')
  if (levels.length === 0) return { efforts: false, ...defaultEffort(row.default) }
  const efforts: Partial<Record<ModelThinkingLevel, string | null>> = {}
  for (const level of levels) {
    if (!KNOWN_LEVELS.has(level)) continue
    efforts[level as ModelThinkingLevel] = level === 'off' ? null : level
  }
  if (Object.keys(efforts).length === 0) return { efforts: false, ...defaultEffort(row.default) }
  return { efforts, ...defaultEffort(row.default) }
}

function defaultEffort(value: unknown): { defaultEffort: ModelThinkingLevel } | Record<string, never> {
  return typeof value === 'string' && KNOWN_LEVELS.has(value)
    ? { defaultEffort: value as ModelThinkingLevel }
    : {}
}

/**
 * Keep chat and responses models. A row that declares endpoint types and names
 * neither is not selectable in this client. A row that declares none stays.
 * @param body - JSON body from `GET /v1/models`.
 * @returns ids in endpoint order.
 */
export function selectChatModels(body: unknown): LiveCatalogModel[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    throw new LlmError(
      'the endpoint model listing has no "data" array',
      'DISCOVERY_FAILED',
    )
  }
  const models: LiveCatalogModel[] = []
  for (const raw of data) {
    if (raw === null || typeof raw !== 'object') continue
    const row = raw as { id?: unknown; name?: unknown; supported_endpoint_types?: unknown; reasoning?: unknown }
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (id.length === 0 || !chatCapable(row.supported_endpoint_types)) continue
    const name = typeof row.name === 'string' && row.name.trim().length > 0 ? row.name.trim() : undefined
    const reasoning = parseRowReasoning(row.reasoning)
    models.push({ id, ...name === undefined ? {} : { name }, ...reasoning === undefined ? {} : { reasoning } })
  }
  return models
}

function chatCapable(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return true
  return value.some(item => item === 'openai' || item === 'chat' || item === 'openai-response' || item === 'responses')
}

/**
 * Read the account's model list.
 * @param baseURL - provider origin, with or without a trailing slash.
 * @param apiKey - relay key. It is sent as a bearer token and is not logged.
 * @param options - deployment headers and an HTTP implementation for tests.
 * @param options.headers - provider deployment headers; the discovery-owned
 * `accept`, `authorization`, and `user-agent` names are never overridden, so a
 * deployment cannot silently replace the resolved credential.
 * @param options.fetchImpl - HTTP implementation, tests pass a stub.
 * @returns chat-capable models in endpoint order.
 */
export async function fetchLiveCatalog(
  baseURL: string,
  apiKey: string,
  options: {
    headers?: Readonly<Record<string, string>>
    fetchImpl?: typeof fetch
  } = {},
): Promise<LiveCatalogModel[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const url = `${baseURL.replace(/\/+$/, '')}/models`
  const deployment = Object.fromEntries(Object.entries(options.headers ?? {})
    .filter(([name]) => !RESERVED_DISCOVERY_HEADERS.has(name.toLowerCase())))
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        'user-agent': 'Kito/2.0',
        ...deployment,
      },
    })
  } catch (error: unknown) {
    throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(`${url} answered ${response.status}`, 'DISCOVERY_FAILED')
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
  return selectChatModels(body)
}

/**
 * Turn listing rows into the model descriptors this route can call. A row that
 * states no reasoning capability materializes as non-reasoning: a live route
 * has no installed catalog entry to inherit from, and offering a fabricated
 * effort list would let a selector send a parameter the model does not read.
 * @param input - route identity, endpoint, listed models and compatibility defaults.
 * @returns model descriptors for the live route.
 */
export function materializeLiveModels(input: {
  provider: string
  api: string
  baseURL: string
  models: readonly LiveCatalogModel[]
  compat?: PiAiCompatProfile
  defaultContextWindow?: number
  defaultMaxTokens?: number
  defaultInput?: readonly PiAiModality[]
}): Model<Api>[] {
  if (input.models.length === 0) return []
  return [...resolveRouteModels({
    provider: input.provider,
    api: input.api,
    baseURL: input.baseURL,
    ...input.compat === undefined ? {} : { compat: input.compat },
    defaultContextWindow: input.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    defaultMaxTokens: input.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
    defaultInput: [...input.defaultInput ?? DEFAULT_INPUT],
    models: input.models.map(model => ({
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      reasoningEfforts: model.reasoning?.efforts ?? false,
    })),
  }).models]
}
