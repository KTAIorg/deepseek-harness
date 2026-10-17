/** Welcome-window KT Identity sign-in. The DeepSeek account stream does not own this attempt. */

import { randomUUID } from 'node:crypto'
import type { AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import {
  ensureKitoApiKey,
  finishKitoDeviceLogin,
  KITO_WALLET_URL,
  startKitoDeviceLogin,
} from './kito-identity.ts'

/** Account snapshot plus the Telegram confirmation code the welcome page renders. */
export type KitoWelcomeState = AccountView & {
  readonly attempt: AccountView['attempt'] & { readonly userCode?: string } | null
}

export interface KitoSignIn {
  /** @returns the attempt after the device challenge is issued. */
  start(): Promise<KitoWelcomeState>
  /** @param id - attempt to cancel. @returns the cancelled snapshot. */
  cancel(id: SignInAttemptId): Promise<KitoWelcomeState>
  /** @returns the latest snapshot. */
  state(): KitoWelcomeState
}

/**
 * Run one Telegram device login and store the resulting NewAPI key.
 * @param options.publish - push a snapshot to the welcome window.
 * @param options.saveKey - persist `KITO_NEWAPI_API_KEY`.
 * @param options.onSuccess - open the workspace after the key is stored.
 * @param options.openLogin - open the confirmation page.
 * @returns start, cancel, and state operations.
 */
export function createKitoSignIn(options: {
  publish: (state: KitoWelcomeState) => void
  saveKey: (key: string) => Promise<{ ok: boolean }>
  onSuccess: () => void
  openLogin?: (url: string) => void
  fetchImpl?: typeof fetch
}): KitoSignIn {
  let current: {
    id: SignInAttemptId
    abort: AbortController
    phase: NonNullable<KitoWelcomeState['attempt']>['phase']
    authorizeUrl?: string
    userCode?: string
    errorCode?: NonNullable<KitoWelcomeState['attempt']>['errorCode']
    status: KitoWelcomeState['status']
  } | undefined

  const snapshot = (): KitoWelcomeState => ({
    status: current?.status ?? 'signed-out',
    links: { usageUrl: KITO_WALLET_URL, topUpUrl: KITO_WALLET_URL },
    attempt: current === undefined ? null : {
      id: current.id,
      phase: current.phase,
      ...(current.authorizeUrl === undefined ? {} : { authorizeUrl: current.authorizeUrl }),
      ...(current.userCode === undefined ? {} : { userCode: current.userCode }),
      ...(current.errorCode === undefined ? {} : { errorCode: current.errorCode }),
    },
  })
  const publish = (): KitoWelcomeState => {
    const state = snapshot()
    options.publish(state)
    return state
  }

  return {
    state: snapshot,
    async start() {
      current?.abort.abort()
      const abort = new AbortController()
      const id = randomUUID() as SignInAttemptId
      current = { id, abort, phase: 'initializing', status: 'signed-out' }
      publish()
      try {
        const challenge = await startKitoDeviceLogin({
          signal: abort.signal,
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        })
        if (current.id !== id) return snapshot()
        current.phase = 'waiting-browser'
        current.authorizeUrl = challenge.loginUrl
        current.userCode = challenge.userCode
        publish()
        options.openLogin?.(challenge.loginUrl)
        const identity = await finishKitoDeviceLogin({
          sessionId: challenge.sessionId,
          opaqueCode: challenge.opaqueCode,
          intervalMs: challenge.interval * 1000,
          signal: abort.signal,
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        })
        if (current.id !== id) return snapshot()
        current.phase = 'exchanging'
        publish()
        const key = await ensureKitoApiKey(identity.token, {
          signal: abort.signal,
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        })
        const saved = await options.saveKey(key)
        if (!saved.ok) throw new Error('KT Identity sign-in could not store the API key')
        if (current.id !== id) return snapshot()
        current.phase = 'succeeded'
        current.status = 'credential-stored'
        const state = publish()
        options.onSuccess()
        return state
      } catch (error) {
        if (current?.id !== id) return snapshot()
        if (abort.signal.aborted) {
          current.phase = 'cancelled'
          return publish()
        }
        current.phase = 'failed'
        current.errorCode = error instanceof Error && /timed out|expired/u.test(error.message) ? 'expired' : 'network'
        return publish()
      }
    },
    async cancel(id) {
      if (current?.id !== id) return snapshot()
      current.abort.abort()
      current.phase = 'cancelled'
      return publish()
    },
  }
}
