import os from 'node:os'

import { errorMessage, readJson, withTimeout } from './http.js'

export const DEFAULT_IDENTITY_BASE_URL = 'https://login.ktyun.cc'
export const KITO_DEVICE_CLIENT_TYPE = 'kito_desktop'
export const KITO_DEVICE_CLIENT_ID = 'kito-desktop'

/** @param {NodeJS.ProcessEnv} [env] */
export function identityBaseUrl(env = process.env) {
  const value = env.KT_IDENTITY_BASE_URL?.trim()
  return value ? value.replace(/\/+$/, '') : DEFAULT_IDENTITY_BASE_URL
}

/** @param {NodeJS.ProcessEnv} [env] */
export function deviceName(env = process.env) {
  const host = (env.KITO_DEVICE_NAME ?? os.hostname()).trim()
  return host ? `Kito Harness on ${host}` : 'Kito Harness'
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function stringField(value) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/**
 * @param {unknown} payload
 */
export function asPasswordSession(payload) {
  if (!payload || typeof payload !== 'object') return
  const record = /** @type {Record<string, unknown>} */ (payload)
  if (record.data && record.data !== payload) return asPasswordSession(record.data)
  const account = /** @type {{ id?: unknown, accountNo?: unknown, displayName?: unknown } | undefined} */ (record.account)
  const session = /** @type {{ id?: unknown, tokenType?: unknown, expiresAt?: unknown } | undefined} */ (record.session)
  if (typeof record.token !== 'string' || !record.token) return
  if (typeof account?.id !== 'string' || typeof account.accountNo !== 'string') return
  const expiresAt = typeof session?.expiresAt === 'string'
    ? session.expiresAt
    : typeof record.expiresAt === 'string' ? record.expiresAt : undefined
  return {
    account: {
      id: account.id,
      accountNo: account.accountNo,
      ...(typeof account.displayName === 'string' ? { displayName: account.displayName } : {}),
    },
    token: record.token,
    session: {
      id: typeof session?.id === 'string' ? session.id : 'identity',
      tokenType: typeof session?.tokenType === 'string' ? session.tokenType : 'Bearer',
      ...(expiresAt ? { expiresAt } : {}),
    },
  }
}

/**
 * @param {unknown} payload
 */
export function asDeviceChallenge(payload) {
  if (!payload || typeof payload !== 'object') return
  const record = /** @type {Record<string, unknown>} */ (payload)
  const source = record.challenge && typeof record.challenge === 'object'
    ? /** @type {Record<string, unknown>} */ (record.challenge)
    : record
  const sessionId = stringField(source.session_id) ?? stringField(source.sessionId)
  const userCode = stringField(source.user_code) ?? stringField(source.userCode)
  const opaqueCode = stringField(source.opaque_code) ?? stringField(source.opaqueCode)
  const loginUrl = stringField(source.login_url) ?? stringField(source.loginUrl)
  const expiresAt = stringField(source.expires_at) ?? stringField(source.expiresAt)
  if (!sessionId || !userCode || !opaqueCode || !loginUrl || !expiresAt) return
  const interval = source.interval
  return {
    sessionId,
    userCode,
    opaqueCode,
    loginUrl,
    expiresAt,
    interval: typeof interval === 'number' && interval > 0 ? interval : 5,
  }
}

/**
 * @param {unknown} payload
 */
export function asDeviceSession(payload) {
  if (!payload || typeof payload !== 'object') return
  const record = /** @type {Record<string, unknown>} */ (payload)
  const source = record.data && typeof record.data === 'object'
    ? /** @type {Record<string, unknown>} */ (record.data)
    : record
  const accessToken = stringField(source.access_token) ?? stringField(source.accessToken)
  const accountId = stringField(source.subject) ?? stringField(source.account_id)
  if (!accessToken || !accountId) return
  const username = stringField(source.username)
  const refreshToken = stringField(source.refresh_token) ?? stringField(source.refreshToken)
  const expiresAt = stringField(source.expires_at) ?? stringField(source.expiresAt)
  const refreshExpiresAt = stringField(source.refresh_expires_at) ?? stringField(source.refreshExpiresAt)
  const deviceSessionId = stringField(source.device_session_id) ?? stringField(source.deviceSessionId)
  return {
    account: { id: accountId, accountNo: username ?? accountId },
    token: accessToken,
    session: {
      id: deviceSessionId ?? 'identity',
      tokenType: stringField(source.token_type) ?? stringField(source.tokenType) ?? 'Bearer',
      ...(expiresAt ? { expiresAt } : {}),
    },
    ...(refreshToken || refreshExpiresAt || deviceSessionId
      ? {
          device: {
            ...(refreshToken ? { refreshToken } : {}),
            ...(refreshExpiresAt ? { refreshExpiresAt } : {}),
            ...(deviceSessionId ? { deviceSessionId } : {}),
          },
        }
      : {}),
  }
}

/**
 * @param {{ loginName: string, password: string, baseUrl?: string, signal?: AbortSignal }} input
 * @param {typeof fetch} [fetchImpl]
 */
export async function passwordLogin(input, fetchImpl = fetch) {
  const baseUrl = input.baseUrl ?? identityBaseUrl()
  const response = await fetchImpl(`${baseUrl}/identity/v1/auth/login`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ loginName: input.loginName.trim(), password: input.password }),
    signal: withTimeout(input.signal),
  })
  const payload = await readJson(response)
  if (!response.ok) throw new Error(errorMessage(payload, `KT Identity password login failed (${response.status})`))
  const session = asPasswordSession(payload)
  if (!session) throw new Error('KT Identity password login returned an unexpected payload')
  return session
}

/**
 * @param {{ baseUrl?: string, signal?: AbortSignal, deviceLabel?: string }} [input]
 * @param {typeof fetch} [fetchImpl]
 */
export async function startDeviceLogin(input = {}, fetchImpl = fetch) {
  const baseUrl = input.baseUrl ?? identityBaseUrl()
  const response = await fetchImpl(`${baseUrl}/identity/v1/device/sessions`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_type: KITO_DEVICE_CLIENT_TYPE,
      client_id: KITO_DEVICE_CLIENT_ID,
      device_name: input.deviceLabel ?? deviceName(),
    }),
    signal: withTimeout(input.signal),
  })
  const payload = await readJson(response)
  if (!response.ok) throw new Error(errorMessage(payload, `KT Identity device login start failed (${response.status})`))
  const challenge = asDeviceChallenge(payload)
  if (!challenge) throw new Error('KT Identity device login start returned an unexpected payload')
  return challenge
}

/**
 * @param {{ sessionId: string, opaqueCode: string, baseUrl?: string, signal?: AbortSignal, deviceLabel?: string }} input
 * @param {typeof fetch} [fetchImpl]
 */
export async function exchangeDeviceTokens(input, fetchImpl = fetch) {
  const baseUrl = input.baseUrl ?? identityBaseUrl()
  const response = await fetchImpl(`${baseUrl}/identity/v1/device/sessions/${encodeURIComponent(input.sessionId)}/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      opaque_code: input.opaqueCode.trim(),
      client_id: KITO_DEVICE_CLIENT_ID,
      device_name: input.deviceLabel ?? deviceName(),
    }),
    signal: withTimeout(input.signal),
  })
  const payload = await readJson(response)
  if (!response.ok) throw new Error(errorMessage(payload, `KT Identity device token exchange failed (${response.status})`))
  const session = asDeviceSession(payload)
  if (!session) throw new Error('KT Identity device token exchange returned an unexpected payload')
  return session
}

/**
 * @param {{
 *   sessionId: string,
 *   opaqueCode: string,
 *   baseUrl?: string,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 *   intervalMs?: number,
 *   deviceLabel?: string,
 * }} input
 * @param {typeof fetch} [fetchImpl]
 */
export async function pollDeviceLogin(input, fetchImpl = fetch) {
  const timeoutMs = input.timeoutMs ?? 180_000
  const intervalMs = input.intervalMs ?? 2_000
  const started = Date.now()
  const baseUrl = input.baseUrl ?? identityBaseUrl()
  const opaqueCode = input.opaqueCode.trim()
  if (!opaqueCode) throw new Error('KT Identity device login requires opaqueCode')
  let transientFailures = 0
  while (Date.now() - started < timeoutMs) {
    if (input.signal?.aborted) throw new Error('KT Identity device login cancelled')
    let response
    try {
      response = await fetchImpl(`${baseUrl}/identity/v1/device/sessions/${encodeURIComponent(input.sessionId)}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: withTimeout(input.signal),
      })
    } catch (error) {
      transientFailures += 1
      if (transientFailures >= 5) throw error instanceof Error ? error : new Error('KT Identity device login poll failed')
      await delay(intervalMs, input.signal)
      continue
    }
    const payload = await readJson(response)
    if (!response.ok) {
      const transient = response.status === 429 || response.status >= 500
      if (!transient) throw new Error(errorMessage(payload, `KT Identity device login poll failed (${response.status})`))
      transientFailures += 1
      if (transientFailures >= 5) {
        throw new Error(errorMessage(payload, `KT Identity device login poll failed (${response.status})`))
      }
      await delay(intervalMs, input.signal)
      continue
    }
    transientFailures = 0
    const status = payload && typeof payload === 'object' && typeof /** @type {{ status?: unknown }} */ (payload).status === 'string'
      ? /** @type {{ status: string }} */ (payload).status
      : 'pending'
    if (status === 'approved') return exchangeDeviceTokens(input, fetchImpl)
    if (status === 'denied' || status === 'expired' || status === 'consumed') {
      throw new Error(`KT Identity device login ${status}`)
    }
    await delay(intervalMs, input.signal)
  }
  throw new Error('KT Identity device login timed out')
}

/**
 * @param {number} ms
 * @param {AbortSignal | undefined} signal
 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(undefined)
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('KT Identity device login cancelled'))
    }
    if (signal?.aborted) {
      clearTimeout(timer)
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
