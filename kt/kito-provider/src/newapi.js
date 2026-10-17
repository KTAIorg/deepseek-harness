import { asRecord, cookieHeader, errorMessage, readJson, withTimeout } from './http.js'

export const DEFAULT_NEWAPI_BASE_URL = 'https://ktapi.cc'
export const KITO_MANAGED_TOKEN_NAME = 'kito'

/** @param {NodeJS.ProcessEnv} [env] */
export function newapiBaseUrl(env = process.env) {
  const value = env.KITO_NEWAPI_BASE_URL?.trim() || env.KTAPI_BASE_URL?.trim()
  return value ? value.replace(/\/+$/, '') : DEFAULT_NEWAPI_BASE_URL
}

/** @param {string} key */
export function formatRelayKey(key) {
  return key.startsWith('sk-') ? key : `sk-${key}`
}

/**
 * @param {unknown} payload
 * @param {...string} keys
 * @returns {string | undefined}
 */
function stringField(payload, ...keys) {
  const record = asRecord(payload)
  if (!record) return
  for (const key of keys) {
    const item = record[key]
    if (typeof item === 'string' && item.trim()) return item.trim()
  }
  if (record.data) return stringField(record.data, ...keys)
  return
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit & { signal?: AbortSignal }} init
 */
async function sessionJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, { ...init, signal: withTimeout(init.signal) })
  return { payload: await readJson(response), cookie: cookieHeader(response), status: response.status }
}

/**
 * @param {unknown} payload
 * @returns {Record<string, unknown>[]}
 */
function tokenRows(payload) {
  const record = asRecord(payload)
  const data = record?.data
  if (Array.isArray(data)) return data.filter(row => Boolean(asRecord(row)))
  const items = asRecord(data)?.items
  if (Array.isArray(items)) return items.filter(row => Boolean(asRecord(row)))
  return []
}

/** @param {unknown} payload */
function userIdFrom(payload) {
  const record = asRecord(payload)
  const data = asRecord(record?.data) ?? record
  const id = data?.id ?? asRecord(data?.user)?.id
  if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  if (typeof id === 'string' && id.trim()) return id.trim()
  return
}

/**
 * @param {string} identityToken
 * @param {string} baseUrl
 * @param {typeof fetch} fetchImpl
 * @param {AbortSignal | undefined} signal
 */
async function tryDedicatedTokenEnsure(identityToken, baseUrl, fetchImpl, signal) {
  const response = await fetchImpl(`${baseUrl}/api/iam/token/ensure`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${identityToken}`,
    },
    body: JSON.stringify({ name: KITO_MANAGED_TOKEN_NAME }),
    signal: withTimeout(signal),
  })
  if (response.status === 404) return
  const payload = await readJson(response)
  if (!response.ok) throw new Error(stringField(payload, 'message', 'error') ?? `NewAPI token ensure failed (${response.status})`)
  const key = stringField(payload, 'key')
  if (!key) throw new Error('NewAPI token ensure returned no key')
  return { key: formatRelayKey(key), name: KITO_MANAGED_TOKEN_NAME }
}

/**
 * @param {string} identityToken
 * @param {string} baseUrl
 * @param {typeof fetch} fetchImpl
 * @param {AbortSignal | undefined} signal
 */
async function ensureViaSession(identityToken, baseUrl, fetchImpl, signal) {
  const ensured = await sessionJson(fetchImpl, `${baseUrl}/api/iam/ensure`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${identityToken}`,
    },
    body: '{}',
    signal,
  })
  if (ensured.status >= 400) {
    throw new Error(stringField(ensured.payload, 'message', 'error') ?? `NewAPI ensure failed (${ensured.status})`)
  }
  if (!ensured.cookie) throw new Error('NewAPI ensure did not return a session cookie')
  const userId = userIdFrom(ensured.payload)
  if (!userId) throw new Error('NewAPI ensure did not return a user id')
  const sessionHeaders = { accept: 'application/json', cookie: ensured.cookie, 'New-Api-User': userId }
  const list = async () => {
    const result = await sessionJson(fetchImpl, `${baseUrl}/api/token/?p=1&size=100`, {
      method: 'GET',
      headers: sessionHeaders,
      signal,
    })
    if (result.status >= 400) {
      throw new Error(stringField(result.payload, 'message', 'error') ?? `NewAPI token list failed (${result.status})`)
    }
    return tokenRows(result.payload).find(row => {
      const name = typeof row.name === 'string' ? row.name.trim().toLowerCase() : ''
      return name === KITO_MANAGED_TOKEN_NAME
    })
  }
  let row = await list()
  if (!row) {
    const created = await sessionJson(fetchImpl, `${baseUrl}/api/token/`, {
      method: 'POST',
      headers: { ...sessionHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ name: KITO_MANAGED_TOKEN_NAME, unlimited_quota: true, expired_time: -1 }),
      signal,
    })
    if (created.status >= 400 || asRecord(created.payload)?.success === false) {
      throw new Error(stringField(created.payload, 'message', 'error') ?? `NewAPI token create failed (${created.status})`)
    }
    row = await list()
  }
  const id = typeof row?.id === 'number' ? row.id : Number(row?.id)
  if (!Number.isFinite(id)) throw new Error('NewAPI managed token id was missing')
  const keyResult = await sessionJson(fetchImpl, `${baseUrl}/api/token/${id}/key`, {
    method: 'POST',
    headers: sessionHeaders,
    signal,
  })
  const key = stringField(keyResult.payload, 'key')
  if (keyResult.status >= 400 || !key) {
    throw new Error(stringField(keyResult.payload, 'message', 'error') ?? `NewAPI token key failed (${keyResult.status})`)
  }
  return { key: formatRelayKey(key), name: KITO_MANAGED_TOKEN_NAME }
}

/**
 * @param {string} identityToken
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch, signal?: AbortSignal }} [input]
 */
export async function ensureManagedToken(identityToken, input = {}) {
  const baseUrl = input.baseUrl ?? newapiBaseUrl()
  const fetchImpl = input.fetchImpl ?? fetch
  const dedicated = await tryDedicatedTokenEnsure(identityToken, baseUrl, fetchImpl, input.signal)
  if (dedicated) return dedicated
  return ensureViaSession(identityToken, baseUrl, fetchImpl, input.signal)
}
