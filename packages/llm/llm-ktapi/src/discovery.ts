/**
 * Fetching the ktapi catalog for one account.
 *
 * The account's own listing decides what it may use; the shared pricing payload
 * only decorates the entries. The two requests are issued together, and a
 * pricing failure degrades to an unpriced catalog instead of hiding models the
 * account can already call.
 */

import { buildKtapiCatalog, type KtapiModel } from './catalog.ts'

/** Default ktapi origin. */
export const KTAI_BASE_URL = 'https://ktapi.cc'
/** Deadline for one catalog request. */
export const CATALOG_TIMEOUT_MS = 15_000

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
  /** ktapi origin; defaults to {@link KTAI_BASE_URL}. */
  readonly baseUrl?: string
  /** Fetch implementation; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch
  /** Deadline for one request; defaults to {@link CATALOG_TIMEOUT_MS}. */
  readonly timeoutMs?: number
  /** Signal bounding the whole read. */
  readonly signal?: AbortSignal
}

/** Raised when ktapi refuses the relay key, so a caller can re-derive it. */
export class KtapiCredentialError extends Error {
  /**
   * @param status - HTTP status ktapi answered with.
   * @param detail - gateway message, when it carried one.
   */
  constructor(readonly status: number, detail: string) {
    super(`ktapi refused the model credential (${String(status)}): ${detail}`)
    this.name = 'KtapiCredentialError'
  }
}

type JsonRecord = Record<string, unknown>

function messageOf(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null) return fallback
  const record = payload as JsonRecord
  const error = record.error
  if (typeof record.message === 'string' && record.message.trim()) return record.message
  if (typeof error === 'string' && error.trim()) return error
  if (typeof error === 'object' && error !== null) {
    const nested = (error as JsonRecord).message
    if (typeof nested === 'string' && nested.trim()) return nested
  }
  return fallback
}

/**
 * Reduce a configured endpoint to the gateway origin.
 *
 * Callers pass the Messages base URL, which already ends in `/v1`; the listing
 * and pricing endpoints sit at fixed paths under the origin, so keeping the
 * path would produce `/v1/v1/models`.
 * @param baseUrl - configured endpoint, with or without its `/v1` segment.
 * @returns the origin, falling back to {@link KTAI_BASE_URL} when the value is absent or unusable.
 */
function siteOf(baseUrl: string | undefined): string {
  if (baseUrl === undefined || baseUrl.trim() === '') return KTAI_BASE_URL
  try {
    return new URL(baseUrl).origin
  } catch {
    return KTAI_BASE_URL
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/**
 * Read the account's model listing.
 * @param input - request seams.
 * @returns the listing payload.
 * @throws {@link KtapiCredentialError} when ktapi rejects the key.
 */
async function readListing(input: Required<Pick<KtapiCatalogInput, 'apiKey'>> & KtapiCatalogInput): Promise<unknown> {
  const fetchImpl = input.fetchImpl ?? fetch
  const baseUrl = siteOf(input.baseUrl)
  const response = await fetchImpl(`${baseUrl}/v1/models`, {
    headers: { accept: 'application/json', authorization: `Bearer ${input.apiKey}` },
    signal: input.signal ?? AbortSignal.timeout(input.timeoutMs ?? CATALOG_TIMEOUT_MS),
  })
  const payload = await readJson(response)
  if (response.status === 401 || response.status === 403) {
    throw new KtapiCredentialError(response.status, messageOf(payload, 'credential rejected'))
  }
  if (!response.ok) throw new Error(messageOf(payload, `ktapi model listing failed (${String(response.status)})`))
  return payload
}

/**
 * Read the shared pricing payload; a failure yields no pricing rather than no catalog.
 * @param input - request seams.
 * @returns the pricing payload, or undefined when ktapi could not serve it.
 */
async function readPricing(input: KtapiCatalogInput): Promise<unknown> {
  const fetchImpl = input.fetchImpl ?? fetch
  const baseUrl = siteOf(input.baseUrl)
  try {
    const response = await fetchImpl(`${baseUrl}/api/pricing`, {
      headers: { accept: 'application/json' },
      signal: input.signal ?? AbortSignal.timeout(input.timeoutMs ?? CATALOG_TIMEOUT_MS),
    })
    return response.ok ? await readJson(response) : undefined
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
 * @throws {@link KtapiCredentialError} when the relay key is refused, and a plain
 * Error when the listing cannot be read at all.
 */
export async function fetchKtapiCatalog(input: KtapiCatalogInput): Promise<KtapiCatalogSnapshot> {
  const apiKey = input.apiKey.trim()
  if (!apiKey) throw new Error('ktapi catalog requires a relay key')
  const [listing, pricing] = await Promise.all([readListing({ ...input, apiKey }), readPricing(input)])
  return {
    models: buildKtapiCatalog(listing, pricing),
    fetchedAt: Date.now(),
    groups: groupsFromPricing(pricing),
  }
}
