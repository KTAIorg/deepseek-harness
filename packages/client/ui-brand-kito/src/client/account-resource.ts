/** Shared Telegram account resource backed by the Desktop shell's safe account projection. */
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'

/** Public account facts; credentials remain inside the Desktop main process. */
export interface KitoAccountView {
  readonly signedIn: boolean
  readonly displayName?: string
  readonly accountNo?: string
  readonly telegramUsername?: string
  readonly balance?: number
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    kitoaccount: KitoAccountView
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The resource address does not name the current Desktop account. */
    'kito-account/invalid-address': {}
    /** The shell route could not supply a validated account projection. */
    'kito-account/unavailable': {}
  }
}

/** The one account associated with this Desktop profile. */
export const KITO_ACCOUNT_RESOURCE = 'dsh-resource://kitoaccount/current'
/** Window event shared with the Desktop shell after account changes. */
export const KITO_ACCOUNT_REFRESH = 'kito-account'

/** Ask the active account provider to re-read immediately. */
export function refreshKitoAccount(): void {
  window.dispatchEvent(new Event(KITO_ACCOUNT_REFRESH))
}

function invalidAccount(): never {
  throw new Error('Invalid Kito account response.')
}

type MutableKitoAccount = { -readonly [Key in keyof KitoAccountView]: KitoAccountView[Key] }

/**
 * Validate the Desktop route's JSON before it reaches a view.
 * @param payload - decoded route response.
 * @returns safe account facts with optional fields preserved independently.
 */
export function parseKitoAccount(payload: unknown): KitoAccountView {
  if (typeof payload !== 'object' || payload === null || !('signedIn' in payload) || typeof payload.signedIn !== 'boolean') invalidAccount()
  const account: MutableKitoAccount = { signedIn: payload.signedIn }
  for (const key of ['displayName', 'accountNo', 'telegramUsername'] as const) {
    if (!Object.hasOwn(payload, key)) continue
    const value: unknown = Object.getOwnPropertyDescriptor(payload, key)?.value
    if (typeof value !== 'string') invalidAccount()
    account[key] = value
  }
  if (Object.hasOwn(payload, 'balance')) {
    const balance: unknown = Object.getOwnPropertyDescriptor(payload, 'balance')?.value
    if (typeof balance !== 'number' || !Number.isFinite(balance)) invalidAccount()
    account.balance = balance
  }
  return account
}

async function readAccount(signal: AbortSignal): Promise<KitoAccountView> {
  const response = await fetch('dsh-app://app/kito/account', { signal })
  if (!response.ok) throw new Error(`Kito account route returned ${String(response.status)}.`)
  const payload: unknown = await response.json()
  return parseKitoAccount(payload)
}

/**
 * Serve the current account while at least one view holds the resource.
 * @param refreshIntervalMs - maximum delay between successful or failed reads.
 * @returns provider registration for the Kito plugin instance.
 */
export function kitoAccountResource(refreshIntervalMs: number): ResourceProvider<'kitoaccount'> {
  return {
    protocol: 'kitoaccount',
    async *open(address, { signal }): AsyncIterable<RemoteResult<KitoAccountView>> {
      if (address !== KITO_ACCOUNT_RESOURCE) {
        yield { ok: false, error: new RemoteError('kito-account/invalid-address', 'Invalid Kito account resource address.', {}) }
        return
      }
      const aborted = (): boolean => signal.aborted
      if (aborted()) return
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      let wake: (() => void) | undefined
      let requested = false
      const hasRefreshRequest = (): boolean => requested
      const requestRefresh = (): void => {
        requested = true
        wake?.()
      }
      const abort = (): void => {
        controller.abort()
        requestRefresh()
      }
      signal.addEventListener('abort', abort, { once: true })
      window.addEventListener('focus', requestRefresh)
      window.addEventListener(KITO_ACCOUNT_REFRESH, requestRefresh)
      try {
        while (!aborted()) {
          requested = false
          try {
            const account = await readAccount(controller.signal)
            if (aborted()) return
            yield { ok: true, value: account }
          } catch (error) {
            if (aborted()) return
            yield { ok: false, error: new RemoteError('kito-account/unavailable', 'Kito account could not be read.', {}, { cause: error }) }
          }
          if (aborted()) return
          if (!hasRefreshRequest()) {
            await new Promise<void>((resolve) => {
              wake = () => {
                if (timer !== undefined) clearTimeout(timer)
                timer = undefined
                resolve()
              }
              timer = setTimeout(() => { wake?.() }, refreshIntervalMs)
            })
          }
          wake = undefined
        }
      } finally {
        controller.abort()
        wake?.()
        window.removeEventListener('focus', requestRefresh)
        window.removeEventListener(KITO_ACCOUNT_REFRESH, requestRefresh)
        signal.removeEventListener('abort', abort)
      }
    },
  }
}
