/**
 * Live model list for a route that reads `GET {baseURL}/models` instead of a
 * models array in configuration. The listing is the account's own catalog:
 * the gateway already filters it to the key's group.
 */
import type { Api, Model } from '@earendil-works/pi-ai'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { resolveRouteModels } from './catalog.ts'
import type { PiAiCompatProfile, PiAiModality } from './catalog.ts'
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_INPUT, DEFAULT_MAX_TOKENS } from './config.ts'

/** How long a successful listing may be reused before the next catalog read. */
export const LIVE_CATALOG_TTL_MS = 60_000

/** One chat-capable row from an OpenAI-style model listing. */
export interface LiveCatalogModel {
  readonly id: string
  readonly name?: string
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
    const row = raw as { id?: unknown; name?: unknown; supported_endpoint_types?: unknown }
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (id.length === 0 || !chatCapable(row.supported_endpoint_types)) continue
    const name = typeof row.name === 'string' && row.name.trim().length > 0 ? row.name.trim() : undefined
    models.push({ id, ...name === undefined ? {} : { name } })
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
 * @param fetchImpl - HTTP implementation, tests pass a stub.
 * @returns chat-capable models in endpoint order.
 */
export async function fetchLiveCatalog(
  baseURL: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveCatalogModel[]> {
  const url = `${baseURL.replace(/\/+$/, '')}/models`
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        'user-agent': 'Kito/2.0',
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

/** Turn listing rows into the model descriptors this route can call. */
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
      reasoningEfforts: { off: null, high: 'high' },
    })),
  }).models]
}
