/** KT Identity device login used by the Kito Harness welcome window. */

import { errorMessage, failureDetail, jsonHeaders, kitoFetch, readJson, withTimeout } from './kito-http.ts'

export const KITO_IDENTITY_BASE_URL = 'https://login.ktyun.cc'
export const KITO_DEVICE_CLIENT_TYPE = 'kito_desktop'
export const KITO_DEVICE_CLIENT_ID = 'kito-desktop'
export const KITO_NEWAPI_BASE_URL = 'https://ktapi.cc'
export const KITO_NEWAPI_KEY_REF = 'KITO_NEWAPI_API_KEY'
export const KITO_IDENTITY_TOKEN_REF = 'KITO_IDENTITY_TOKEN'
const NEWAPI_QUOTA_PER_USD = 500_000
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
  readonly loginDeeplink: string
  readonly expiresAt: string
  readonly interval: number
}

export interface KitoIdentitySession {
  readonly accountId: string
  readonly token: string
}

/** Public account row. Balance is the shared NewAPI spendable amount in USD. */
export interface KitoAccountView {
  readonly signedIn: boolean
  readonly displayName?: string
  readonly balance?: number
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
  const fetchImpl = input.fetchImpl ?? kitoFetch
  const response = await fetchImpl(`${input.baseUrl ?? identityBaseUrl()}/identity/v1/device/sessions`, {
    method: 'POST',
    headers: jsonHeaders(),
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
  const loginDeeplink = stringField(source?.login_deeplink) ?? stringField(source?.loginDeeplink) ?? loginUrl
  const interval = source?.interval
  return {
    sessionId, userCode, opaqueCode, loginUrl, loginDeeplink, expiresAt,
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
  const fetchImpl = input.fetchImpl ?? kitoFetch
  const baseUrl = input.baseUrl ?? identityBaseUrl()
  const timeoutMs = input.timeoutMs ?? 180_000
  const intervalMs = input.intervalMs ?? 2_000
  const started = Date.now()
  let transientFailures = 0
  while (Date.now() - started < timeoutMs) {
    if (input.signal?.aborted) throw new Error('KT Identity device login cancelled')
    let response: Response
    let payload: unknown
    try {
      response = await fetchImpl(`${baseUrl}/identity/v1/device/sessions/${encodeURIComponent(input.sessionId)}`, {
        method: 'GET',
        headers: jsonHeaders(),
        signal: withTimeout(input.signal),
      })
      payload = await readJson(response)
    } catch (error) {
      transientFailures += 1
      if (transientFailures === 1) console.error('kito device poll failed', failureDetail(error))
      await delay(intervalMs, input.signal)
      continue
    }
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
    if (status === 'approved' || status === 'confirmed') return exchange(input, fetchImpl, baseUrl)
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
    headers: jsonHeaders(),
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
  const fetchImpl = input.fetchImpl ?? kitoFetch
  const baseUrl = input.baseUrl ?? newapiBaseUrl()
  const dedicated = await fetchImpl(`${baseUrl}/api/iam/token/ensure`, {
    method: 'POST',
    headers: jsonHeaders({ authorization: `Bearer ${identityToken}` }),
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
    headers: jsonHeaders({ authorization: `Bearer ${identityToken}` }),
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
  const headers = { ...jsonHeaders(), cookie, 'New-Api-User': userId }
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

/**
 * Read the Telegram display name and the shared NewAPI balance.
 * A missing balance stays absent so the UI does not show a fake zero.
 * @param identityToken - KT Identity access token.
 * @param input - optional origins and cancellation.
 * @returns the signed-in summary, or signed out when the token is rejected.
 */
export async function fetchKitoAccount(identityToken: string, input: FetchInit = {}): Promise<KitoAccountView> {
  const fetchImpl = input.fetchImpl ?? kitoFetch
  const profile = await fetchImpl(`${identityBaseUrl()}/identity/v1/account/me`, {
    method: 'GET',
    headers: jsonHeaders({ authorization: `Bearer ${identityToken}` }),
    signal: withTimeout(input.signal),
  })
  const profilePayload = await readJson(profile)
  if (profile.status === 401) return { signedIn: false }
  if (!profile.ok) throw new Error(errorMessage(profilePayload, `KT Identity account failed (${profile.status})`))
  const balance = await fetchSpendable(identityToken, fetchImpl, input.signal).catch(() => undefined)
  return kitoAccountView(profilePayload, balance)
}

/**
 * Combine an Identity profile with an already-known NewAPI balance.
 * @param profilePayload - `/identity/v1/account/me` body.
 * @param balance - USD amount, omitted when NewAPI did not report a quota.
 * @returns the signed-in summary.
 */
export function kitoAccountView(profilePayload: unknown, balance: number | undefined): KitoAccountView {
  const displayName = displayNameFrom(profilePayload)
  return {
    signedIn: true,
    ...(displayName === undefined ? {} : { displayName }),
    ...(balance === undefined ? {} : { balance }),
  }
}

/** @param quota - NewAPI quota units. @returns USD rounded to cents. */
export function newapiQuotaToUsd(quota: number): number {
  return Math.round((quota / NEWAPI_QUOTA_PER_USD) * 100) / 100
}

function displayNameFrom(payload: unknown): string | undefined {
  const record = asRecord(payload)
  const account = asRecord(record?.account) ?? asRecord(record?.data) ?? record
  const profile = asRecord(record?.profile) ?? asRecord(account?.profile)
  const nested = asRecord(account?.account) ?? account
  return [
    nested?.displayName, nested?.display_name, profile?.displayName, profile?.preferredUsername,
    nested?.telegram_username, nested?.name,
  ]
    .map(item => stringField(item)?.trim())
    .find((item): item is string => Boolean(item))
}

async function fetchSpendable(
  identityToken: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<number | undefined> {
  const response = await fetchImpl(`${newapiBaseUrl()}/api/iam/ensure`, {
    method: 'POST',
    headers: jsonHeaders({ authorization: `Bearer ${identityToken}` }),
    body: '{}',
    signal: withTimeout(signal),
  })
  const payload = await readJson(response)
  if (!response.ok) return undefined
  return spendableFromEnsure(payload)
}

/** @param payload - `/api/iam/ensure` body. @returns the shared USD balance, or undefined when quota is absent. */
export function spendableFromEnsure(payload: unknown): number | undefined {
  const data = asRecord(asRecord(payload)?.data) ?? asRecord(payload)
  const user = asRecord(data?.user) ?? data
  const quota = user?.quota
  return typeof quota === 'number' && Number.isFinite(quota) ? newapiQuotaToUsd(quota) : undefined
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
