/** KT Identity device login used by the Kito Harness welcome window. */

import { errorMessage, readJson, withTimeout } from './kito-http.ts'

export const KITO_IDENTITY_BASE_URL = 'https://login.ktyun.cc'
export const KITO_DEVICE_CLIENT_TYPE = 'kito_desktop'
export const KITO_DEVICE_CLIENT_ID = 'kito-desktop'
export const KITO_NEWAPI_BASE_URL = 'https://ktapi.cc'
export const KITO_NEWAPI_KEY_REF = 'KITO_NEWAPI_API_KEY'
export const KITO_MANAGED_TOKEN_NAME = 'kito'
export const KITO_WALLET_URL = 'https://www.ktapi.cc/wallet'

/** @param env - process environment. @returns identity origin without a trailing slash. */
export function identityBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.KT_IDENTITY_BASE_URL?.trim()
  return value ? value.replace(/\/+$/, '') : KITO_IDENTITY_BASE_URL
}

/** @param env - process environment. @returns NewAPI origin without a trailing slash. */
export function newapiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.KITO_NEWAPI_BASE_URL?.trim() || env.KTAPI_BASE_URL?.trim()
  return value ? value.replace(/\/+$/, '') : KITO_NEWAPI_BASE_URL
}

export interface KitoDeviceChallenge {
  readonly sessionId: string
  readonly userCode: string
  readonly opaqueCode: string
  readonly loginUrl: string
  readonly expiresAt: string
  readonly interval: number
}

export interface KitoIdentitySession {
  readonly accountId: string
  readonly token: string
}

interface FetchInit {
  readonly baseUrl?: string
  readonly signal?: AbortSignal
  readonly fetchImpl?: typeof fetch
  readonly deviceLabel?: string
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

/** @param key - relay secret from NewAPI. @returns a key with the `sk-` prefix. */
export function formatRelayKey(key: string): string {
  return key.startsWith('sk-') ? key : `sk-${key}`
}

/**
 * Start a Telegram device login with the registered Kito desktop client.
 * @param input - optional origin and cancellation.
 * @returns the code the person confirms and the page to open.
 */
export async function startKitoDeviceLogin(input: FetchInit = {}): Promise<KitoDeviceChallenge> {
  const fetchImpl = input.fetchImpl ?? fetch
  const response = await fetchImpl(`${input.baseUrl ?? identityBaseUrl()}/identity/v1/device/sessions`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_type: KITO_DEVICE_CLIENT_TYPE,
      client_id: KITO_DEVICE_CLIENT_ID,
      device_name: input.deviceLabel ?? 'Kito Harness',
    }),
    signal: withTimeout(input.signal),
  })
  const payload = await readJson(response)
  if (!response.ok) throw new Error(errorMessage(payload, `KT Identity device login start failed (${response.status})`))
  const record = asRecord(payload)
  const source = asRecord(record?.challenge) ?? record
  const sessionId = stringField(source?.session_id) ?? stringField(source?.sessionId)
  const userCode = stringField(source?.user_code) ?? stringField(source?.userCode)
  const opaqueCode = stringField(source?.opaque_code) ?? stringField(source?.opaqueCode)
  const loginUrl = stringField(source?.login_url) ?? stringField(source?.loginUrl)
  const expiresAt = stringField(source?.expires_at) ?? stringField(source?.expiresAt)
  if (!sessionId || !userCode || !opaqueCode || !loginUrl || !expiresAt) {
    throw new Error('KT Identity device login start returned an unexpected payload')
  }
  const interval = source?.interval
  return {
    sessionId, userCode, opaqueCode, loginUrl, expiresAt,
    interval: typeof interval === 'number' && interval > 0 ? interval : 5,
  }
}

/**
 * Wait until the device challenge is approved, then exchange it for an access token.
 * @param input - challenge identifiers from {@link startKitoDeviceLogin}.
 * @returns the Identity bearer.
 */
export async function finishKitoDeviceLogin(input: FetchInit & {
  sessionId: string
  opaqueCode: string
  timeoutMs?: number
  intervalMs?: number
}): Promise<KitoIdentitySession> {
  const fetchImpl = input.fetchImpl ?? fetch
  const baseUrl = input.baseUrl ?? identityBaseUrl()
  const timeoutMs = input.timeoutMs ?? 180_000
  const intervalMs = input.intervalMs ?? 2_000
  const started = Date.now()
  let transientFailures = 0
  while (Date.now() - started < timeoutMs) {
    if (input.signal?.aborted) throw new Error('KT Identity device login cancelled')
    const response = await fetchImpl(`${baseUrl}/identity/v1/device/sessions/${encodeURIComponent(input.sessionId)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: withTimeout(input.signal),
    })
    const payload = await readJson(response)
    if (!response.ok) {
      const transient = response.status === 429 || response.status >= 500
      transientFailures += 1
      if (!transient || transientFailures >= 5) {
        throw new Error(errorMessage(payload, `KT Identity device login poll failed (${response.status})`))
      }
      await delay(intervalMs, input.signal)
      continue
    }
    transientFailures = 0
    const status = asRecord(payload)?.status
    if (status === 'approved') return exchange(input, fetchImpl, baseUrl)
    if (status === 'denied' || status === 'expired' || status === 'consumed') {
      throw new Error(`KT Identity device login ${status}`)
    }
    await delay(intervalMs, input.signal)
  }
  throw new Error('KT Identity device login timed out')
}

async function exchange(
  input: FetchInit & { sessionId: string; opaqueCode: string },
  fetchImpl: typeof fetch,
  baseUrl: string,
): Promise<KitoIdentitySession> {
  const response = await fetchImpl(`${baseUrl}/identity/v1/device/sessions/${encodeURIComponent(input.sessionId)}/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      opaque_code: input.opaqueCode.trim(),
      client_id: KITO_DEVICE_CLIENT_ID,
      device_name: input.deviceLabel ?? 'Kito Harness',
    }),
    signal: withTimeout(input.signal),
  })
  const payload = await readJson(response)
  if (!response.ok) throw new Error(errorMessage(payload, `KT Identity device token exchange failed (${response.status})`))
  const record = asRecord(payload)
  const source = asRecord(record?.data) ?? record
  const token = stringField(source?.access_token) ?? stringField(source?.accessToken)
  const accountId = stringField(source?.subject) ?? stringField(source?.account_id)
  if (!token || !accountId) throw new Error('KT Identity device token exchange returned an unexpected payload')
  return { accountId, token }
}

/**
 * Exchange an Identity bearer for the shared `kito` NewAPI key.
 * A missing dedicated endpoint falls back to the session token Kito already uses.
 * @param identityToken - KT Identity access token.
 * @param input - optional NewAPI origin.
 * @returns the relay key stored as `KITO_NEWAPI_API_KEY`.
 */
export async function ensureKitoApiKey(identityToken: string, input: FetchInit = {}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch
  const baseUrl = input.baseUrl ?? newapiBaseUrl()
  const dedicated = await fetchImpl(`${baseUrl}/api/iam/token/ensure`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${identityToken}`,
    },
    body: JSON.stringify({ name: KITO_MANAGED_TOKEN_NAME }),
    signal: withTimeout(input.signal),
  })
  if (dedicated.status !== 404) {
    const payload = await readJson(dedicated)
    if (!dedicated.ok) throw new Error(errorMessage(payload, `NewAPI token ensure failed (${dedicated.status})`))
    const key = stringField(asRecord(payload)?.key) ?? stringField(asRecord(asRecord(payload)?.data)?.key)
    if (!key) throw new Error('NewAPI token ensure returned no key')
    return formatRelayKey(key)
  }
  return ensureViaSession(identityToken, baseUrl, fetchImpl, input.signal)
}

async function ensureViaSession(
  identityToken: string,
  baseUrl: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<string> {
  const ensured = await fetchImpl(`${baseUrl}/api/iam/ensure`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${identityToken}`,
    },
    body: '{}',
    signal: withTimeout(signal),
  })
  const payload = await readJson(ensured)
  if (!ensured.ok) throw new Error(errorMessage(payload, `NewAPI ensure failed (${ensured.status})`))
  const cookie = cookieHeader(ensured)
  const data = asRecord(asRecord(payload)?.data) ?? asRecord(payload)
  const id = data?.id ?? asRecord(data?.user)?.id
  const userId = typeof id === 'number' || typeof id === 'string' ? String(id) : ''
  if (!cookie || userId === '') throw new Error('NewAPI ensure did not return a session')
  const headers = { accept: 'application/json', cookie, 'New-Api-User': userId }
  const listed = await fetchImpl(`${baseUrl}/api/token/?p=1&size=100`, { method: 'GET', headers, signal: withTimeout(signal) })
  const listPayload = await readJson(listed)
  if (!listed.ok) throw new Error(errorMessage(listPayload, `NewAPI token list failed (${listed.status})`))
  const listedRows = asRecord(listPayload)?.data
  const rows = Array.isArray(listedRows) ? listedRows : []
  const row = rows.map(asRecord).find(item => typeof item?.name === 'string' && item.name.trim().toLowerCase() === KITO_MANAGED_TOKEN_NAME)
  const tokenId = typeof row?.id === 'number' ? row.id : Number(row?.id)
  if (!Number.isFinite(tokenId)) throw new Error('NewAPI managed token id was missing')
  const keyResult = await fetchImpl(`${baseUrl}/api/token/${tokenId}/key`, { method: 'POST', headers, signal: withTimeout(signal) })
  const keyPayload = await readJson(keyResult)
  const key = stringField(asRecord(keyPayload)?.key)
  if (!keyResult.ok || !key) throw new Error(errorMessage(keyPayload, `NewAPI token key failed (${keyResult.status})`))
  return formatRelayKey(key)
}

function cookieHeader(response: Response): string | undefined {
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  const pairs = cookies.map(entry => entry.split(';')[0]?.trim()).filter((entry): entry is string => Boolean(entry))
  return pairs.length > 0 ? pairs.join('; ') : undefined
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('KT Identity device login cancelled'))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
