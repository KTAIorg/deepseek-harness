/** @param {unknown} payload */
export function asRecord(payload) {
  return payload && typeof payload === 'object' ? /** @type {Record<string, unknown>} */ (payload) : undefined
}

/**
 * @param {Response} response
 * @returns {Promise<unknown>}
 */
export async function readJson(response) {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * @param {unknown} payload
 * @param {string} fallback
 */
export function errorMessage(payload, fallback) {
  const record = asRecord(payload)
  if (!record) return fallback
  for (const key of ['message', 'error', 'code']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return fallback
}

/**
 * @param {AbortSignal | undefined} signal
 * @param {number} ms
 */
export function withTimeout(signal, ms = 15_000) {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/** @param {Response} response */
export function cookieHeader(response) {
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  const pairs = cookies.map(entry => entry.split(';')[0]?.trim()).filter(entry => Boolean(entry))
  return pairs.length ? pairs.join('; ') : undefined
}
