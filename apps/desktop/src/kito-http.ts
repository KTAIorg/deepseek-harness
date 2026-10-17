/** Small JSON helpers for the Kito Identity and NewAPI calls. */

/** @param response - HTTP response. @returns parsed JSON, raw text, or undefined when the body is empty. */
export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** @param payload - response body. @param fallback - message used when the body has no error string. @returns a human-readable failure. */
export function errorMessage(payload: unknown, fallback: string): string {
  if (payload === null || typeof payload !== 'object') return fallback
  const record = payload as { message?: unknown; error?: unknown }
  if (typeof record.message === 'string' && record.message.trim()) return record.message
  if (typeof record.error === 'string' && record.error.trim()) return record.error
  return fallback
}

/** @param signal - caller cancellation. @param ms - request deadline. @returns a signal that aborts on either condition. */
export function withTimeout(signal: AbortSignal | undefined, ms = 15_000): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}
