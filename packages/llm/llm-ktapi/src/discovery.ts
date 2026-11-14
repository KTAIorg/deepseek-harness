/**
 * Fetching the ktapi catalog for one account.
 *
 * The listing is read by the shared pi-ai live-catalog reader, so ktapi inherits
 * the endpoint contract, the chat-capability filter, and whatever reasoning
 * capability the gateway declares per row. The account's own listing decides
 * what it may use; the shared pricing payload only decorates the entries. The
 * two requests are issued together, and a pricing failure degrades to an unpriced
 * catalog instead of hiding models the account can already call.
 */

import { fetchLiveCatalog } from '@deepseek-ai/dsh-llm-pi-ai/host'
import { buildKtapiCatalog, type KtapiModel } from './catalog.ts'

/** Default ktapi origin. */
export const KTAI_BASE_URL = 'https://ktapi.cc'
/** Deadline for one catalog request. */
export const CATALOG_TIMEOUT_MS = 15_000
/** Path segment the OpenAI-compatible model listing hangs off. */
const MODELS_PATH = '/v1'

/** One resolved catalog, with the facts a caller needs to decide on a refresh. */
export interface KtapiCatalogSnapshot {
  /** Normalized models, curated picks first. */
  readonly models: readonly KtapiModel[]
  /** Epoch milliseconds when the listing was read. */
  readonly fetchedAt: number
  /** Account groups the pricing payload reported, when it named any. */
  readonly groups: readonly string[]
}

/** Request seams for one catalog read. */
export interface KtapiCatalogInput {
  /** Relay key derived from the KT Identity login. */
  readonly apiKey: string
  /** ktapi origin, with or without its `/v1` segment; defaults to {@link KTAI_BASE_URL}. */
  readonly baseUrl?: string
  /** Fetch implementation; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch
  /** Deadline for one request; defaults to {@link CATALOG_TIMEOUT_MS}. */
  readonly timeoutMs?: number
}

type JsonRecord = Record<string, unknown>

/**
 * Split a configured endpoint into the gateway origin and the models endpoint.
 *
 * Callers configure the Messages endpoint, which usually already ends in `/v1`;
 * the pricing payload hangs off the origin while the listing hangs off `/v1`, so
 * joining the configured value onto another `/v1` would produce `/v1/v1/models`.
 * @param baseUrl - configured endpoint.
 * @returns the origin and the models endpoint.
 */
export function endpointsOf(baseUrl: string | undefined): { readonly origin: string; readonly models: string } {
  let parsed: URL
  try {
    parsed = new URL(baseUrl?.trim() || KTAI_BASE_URL)
  } catch {
    parsed = new URL(KTAI_BASE_URL)
  }
  const path = parsed.pathname.replace(/\/+$/u, '')
  const trimmed = path.endsWith(MODELS_PATH) ? path.slice(0, -MODELS_PATH.length) : path
  const origin = `${parsed.origin}${trimmed}`
  return { origin, models: `${origin}${MODELS_PATH}` }
}

/**
 * Read the shared pricing payload; a failure yields no pricing rather than no catalog.
 * @param input - request seams.
 * @returns the pricing payload, or undefined when ktapi could not serve it.
 */
async function readPricing(input: KtapiCatalogInput): Promise<unknown> {
  const fetchImpl = input.fetchImpl ?? fetch
  const url = `${endpointsOf(input.baseUrl).origin}/api/pricing`
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(input.timeoutMs ?? CATALOG_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const text = await response.text()
    if (!text) return undefined
    try {
      return JSON.parse(text) as unknown
    } catch {
      return undefined
    }
  } catch {
    // Pricing decorates the catalog; the account's own listing is already authoritative.
    return undefined
  }
}

/** @param payload - pricing body. @returns every group the payload enables at least one model for. */
export function groupsFromPricing(payload: unknown): string[] {
  const rows = typeof payload === 'object' && payload !== null
    ? (payload as { data?: unknown }).data
    : undefined
  if (!Array.isArray(rows)) return []
  const groups = new Set<string>()
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const enabled = (row as JsonRecord).enable_groups
    if (!Array.isArray(enabled)) continue
    for (const group of enabled) if (typeof group === 'string' && group.trim()) groups.add(group)
  }
  return [...groups].sort()
}

/**
 * Read one account's catalog.
 * @param input - relay key and request seams.
 * @returns the normalized catalog with the groups the pricing payload reported.
 * @throws {LlmError} with code `DISCOVERY_FAILED` when the listing cannot be read,
 * including a refused relay key.
 */
export async function fetchKtapiCatalog(input: KtapiCatalogInput): Promise<KtapiCatalogSnapshot> {
  const apiKey = input.apiKey.trim()
  if (!apiKey) throw new Error('ktapi catalog requires a relay key')
  const timeoutMs = input.timeoutMs ?? CATALOG_TIMEOUT_MS
  // The shared reader owns the request, so the deadline rides the HTTP
  // implementation: one signal per call, covering the body read too.
  const base = input.fetchImpl ?? fetch
  const deadline: typeof fetch = (url, init) =>
    base(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  const [listing, pricing] = await Promise.all([
    fetchLiveCatalog(endpointsOf(input.baseUrl).models, apiKey, { fetchImpl: deadline }),
    readPricing({ ...input, timeoutMs }),
  ])
  return {
    models: buildKtapiCatalog(listing, pricing),
    fetchedAt: Date.now(),
    groups: groupsFromPricing(pricing),
  }
}
