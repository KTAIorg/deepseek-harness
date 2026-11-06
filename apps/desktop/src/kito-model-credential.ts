/**
 * Derive the account's KT-managed model key from a KT Identity login.
 *
 * KT Identity proves who the person is; ktapi issues the account-scoped relay
 * key that model traffic actually uses. The derivation is idempotent: one
 * account always gets the token named {@link KITO_MANAGED_TOKEN_NAME} back, so a
 * second sign-in on another machine or product reuses the same key instead of
 * minting a duplicate.
 */

import { KITO_NEWAPI_KEY_REF, newapiBaseUrl } from './kito-identity.ts'
import { errorMessage, jsonHeaders, kitoFetch, readJson, withTimeout } from './kito-http.ts'

/** Relay token name ktapi keeps for every account; shared with the Kito clients. */
export const KITO_MANAGED_TOKEN_NAME = 'kito'

/** Credential reference holding the derived relay key. */
export { KITO_NEWAPI_KEY_REF }

/** Outcome of deriving the account's model credential. */
export interface KitoModelCredential {
  /** Relay key (`sk-…`) usable as a bearer token against `https://ktapi.cc/v1`. */
  readonly key: string
  /** Whether this call minted the managed token instead of reusing one. */
  readonly created: boolean
}

/** Request seams for the derivation, so tests can run without ktapi. */
export interface KitoModelCredentialInput {
  /** ktapi origin; defaults to the configured endpoint. */
  readonly baseUrl?: string
  /** Fetch implementation; defaults to the ktapi-aware fetch. */
  readonly fetchImpl?: typeof fetch
  /** Abort signal bounding the whole derivation. */
  readonly signal?: AbortSignal
  /** Deadline for one request; defaults to 15 seconds. */
  readonly timeoutMs?: number
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined
}

function stringField(value: unknown, ...names: string[]): string | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  for (const name of names) {
    const field = record[name]
    if (typeof field === 'string' && field.trim()) return field.trim()
  }
  return undefined
}

/** @param key - relay key as ktapi returns it. @returns the key with its `sk-` prefix. */
export function formatRelayKey(key: string): string {
  return key.startsWith('sk-') ? key : `sk-${key}`
}

/**
 * Collect `Set-Cookie` values into one request header.
 * @param response - response whose cookies carry the NewAPI session.
 * @returns the cookie header, or undefined when the response set none.
 */
function cookieHeader(response: Response): string | undefined {
  const getSetCookie = (response.headers as { getSetCookie?: () => string[] }).getSetCookie
  const cookies = typeof getSetCookie === 'function' ? getSetCookie.call(response.headers) : []
  const pairs = cookies
    .map(entry => entry.split(';')[0]?.trim())
    .filter((entry): entry is string => entry !== undefined && entry !== '')
  return pairs.length > 0 ? pairs.join('; ') : undefined
}

interface Ensured {
  readonly response: Response
  readonly payload: unknown
  readonly cookie: string | undefined
}

/**
 * Send one JSON request and read its body, cookies, and status together.
 * @param fetchImpl - fetch implementation.
 * @param url - absolute request URL.
 * @param init - request init.
 * @returns the response, parsed payload, and session cookie.
 */
async function sendJson(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Ensured> {
  const response = await fetchImpl(url, init)
  return { response, payload: await readJson(response), cookie: cookieHeader(response) }
}

/**
 * Ask ktapi for the account's managed token in one call.
 * @param identityToken - KT Identity access token.
 * @param baseUrl - ktapi origin.
 * @param input - request seams.
 * @returns the derived credential, or undefined when ktapi serves no dedicated endpoint.
 */
async function ensureViaDedicatedRoute(
  identityToken: string,
  baseUrl: string,
  input: KitoModelCredentialInput,
): Promise<KitoModelCredential | undefined> {
  const fetchImpl = input.fetchImpl ?? kitoFetch
  const ensured = await sendJson(fetchImpl, `${baseUrl}/api/iam/token/ensure`, {
    method: 'POST',
    headers: jsonHeaders({ authorization: `Bearer ${identityToken}` }),
    body: JSON.stringify({ name: KITO_MANAGED_TOKEN_NAME }),
    signal: withTimeout(input.signal, input.timeoutMs),
  })
  // An older ktapi without this route falls back to the session path below.
  if (ensured.response.status === 404) return undefined
  if (!ensured.response.ok) {
    throw new Error(errorMessage(ensured.payload, `ktapi token ensure failed (${String(ensured.response.status)})`))
  }
  const key = stringField(ensured.payload, 'key') ?? stringField(asRecord(ensured.payload)?.data, 'key')
  if (key === undefined) throw new Error('ktapi token ensure returned no key')
  const created = asRecord(ensured.payload)?.created === true
    || asRecord(asRecord(ensured.payload)?.data)?.created === true
  return { key: formatRelayKey(key), created }
}

/** @param payload - `/api/iam/ensure` body. @returns the NewAPI user id. */
function userIdFrom(payload: unknown): string | undefined {
  const record = asRecord(payload)
  const data = asRecord(record?.data) ?? record
  const raw = data?.id ?? asRecord(data?.user)?.id
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return undefined
}

/** @param payload - `/api/token/` body. @returns the token rows it lists. */
function tokenRows(payload: unknown): JsonRecord[] {
  const record = asRecord(payload)
  const data = record?.data
  if (Array.isArray(data)) return data.filter((row): row is JsonRecord => asRecord(row) !== undefined)
  const items = asRecord(data)?.items
  if (Array.isArray(items)) return items.filter((row): row is JsonRecord => asRecord(row) !== undefined)
  return []
}

/**
 * Derive the managed token through a NewAPI console session, for ktapi builds
 * without the dedicated route: ensure a session, then find, create, or read the
 * named token.
 * @param identityToken - KT Identity access token.
 * @param baseUrl - ktapi origin.
 * @param input - request seams.
 * @returns the derived credential.
 */
async function ensureViaSession(
  identityToken: string,
  baseUrl: string,
  input: KitoModelCredentialInput,
): Promise<KitoModelCredential> {
  const fetchImpl = input.fetchImpl ?? kitoFetch
  const signal = withTimeout(input.signal, input.timeoutMs)
  const ensured = await sendJson(fetchImpl, `${baseUrl}/api/iam/ensure`, {
    method: 'POST',
    headers: jsonHeaders({ authorization: `Bearer ${identityToken}` }),
    body: '{}',
    signal,
  })
  if (!ensured.response.ok) {
    throw new Error(errorMessage(ensured.payload, `ktapi session ensure failed (${String(ensured.response.status)})`))
  }
  if (ensured.cookie === undefined) throw new Error('ktapi session ensure returned no session cookie')
  const userId = userIdFrom(ensured.payload)
  if (userId === undefined) throw new Error('ktapi session ensure returned no user id')
  const sessionHeaders: Record<string, string> = { cookie: ensured.cookie, 'New-Api-User': userId }

  const findManaged = async (): Promise<JsonRecord | undefined> => {
    const listed = await sendJson(fetchImpl, `${baseUrl}/api/token/?p=1&size=100`, {
      method: 'GET',
      headers: { ...jsonHeaders(), ...sessionHeaders },
      signal,
    })
    if (!listed.response.ok) {
      throw new Error(errorMessage(listed.payload, `ktapi token list failed (${String(listed.response.status)})`))
    }
    return tokenRows(listed.payload).find((row) => {
      const name = typeof row.name === 'string' ? row.name.trim().toLowerCase() : ''
      return name === KITO_MANAGED_TOKEN_NAME
    })
  }

  let row = await findManaged()
  let created = false
  if (row === undefined) {
    const minted = await sendJson(fetchImpl, `${baseUrl}/api/token/`, {
      method: 'POST',
      headers: { ...jsonHeaders(), ...sessionHeaders },
      body: JSON.stringify({ name: KITO_MANAGED_TOKEN_NAME, unlimited_quota: true, expired_time: -1 }),
      signal,
    })
    const failed = !minted.response.ok || asRecord(minted.payload)?.success === false
    if (failed) {
      throw new Error(errorMessage(minted.payload, `ktapi token create failed (${String(minted.response.status)})`))
    }
    created = true
    row = await findManaged()
  }
  const rawId = row?.id
  const tokenId = typeof rawId === 'number' ? rawId : Number(rawId)
  if (!Number.isFinite(tokenId)) throw new Error('ktapi managed token has no id')

  const keyResult = await sendJson(fetchImpl, `${baseUrl}/api/token/${String(tokenId)}/key`, {
    method: 'POST',
    headers: { ...jsonHeaders(), ...sessionHeaders },
    signal,
  })
  const key = stringField(keyResult.payload, 'key')
  if (!keyResult.response.ok || key === undefined) {
    throw new Error(errorMessage(keyResult.payload, `ktapi token key failed (${String(keyResult.response.status)})`))
  }
  return { key: formatRelayKey(key), created }
}

/**
 * Derive the account's relay key, preferring ktapi's dedicated route.
 * @param identityToken - KT Identity access token; a blank value is rejected.
 * @param input - request seams.
 * @returns the derived credential.
 * @throws when ktapi rejects the identity token or returns no key.
 */
export async function ensureKitoModelKey(
  identityToken: string,
  input: KitoModelCredentialInput = {},
): Promise<KitoModelCredential> {
  const token = identityToken.trim()
  if (!token) throw new Error('KT Identity token is required to derive the model key')
  const baseUrl = (input.baseUrl ?? newapiBaseUrl()).replace(/\/+$/, '')
  const dedicated = await ensureViaDedicatedRoute(token, baseUrl, input)
  return dedicated ?? ensureViaSession(token, baseUrl, input)
}
