/** Welcome-window KT Identity sign-in. The DeepSeek account stream does not own this attempt. */

import { randomUUID } from 'node:crypto'
import type { AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import { failureDetail } from './kito-http.ts'
import {
  finishKitoDeviceLogin,
  KITO_WALLET_URL,
  pushKitoDeviceLoginHint,
  startKitoDeviceLogin,
} from './kito-identity.ts'
import { normalizeTelegramHint, PUSH_COOLDOWN_MS, resendAllowed } from './kito-login.ts'

/** Why the welcome window stopped this attempt. */
export type KitoLoginFailure = 'denied' | 'consumed' | 'expired' | 'network' | 'storage'

/** Account snapshot plus the Telegram confirmation the welcome page renders. */
export type KitoWelcomeState = AccountView & {
  readonly attempt: AccountView['attempt'] & {
    readonly userCode?: string
    readonly hint?: string
    readonly resendAt?: number
    readonly push?: 'accepted' | 'rate-limited' | 'busy'
    readonly failure?: KitoLoginFailure
  } | null
}

export interface KitoSignIn {
  /**
   * @param hint - Telegram username or KT account number. Empty starts a code without a push.
   * @returns the attempt after the device challenge is issued.
   */
  start(hint?: string): Promise<KitoWelcomeState>
  /** @param id - waiting attempt whose confirmation should be delivered again. @returns the same code. */
  resend(id: SignInAttemptId): Promise<KitoWelcomeState>
  /** @param id - waiting attempt whose https login page should open. Does not open a local Telegram app. */
  openQr(id: SignInAttemptId): void
  /** @param id - attempt to cancel. @returns the cancelled snapshot. */
  cancel(id: SignInAttemptId): Promise<KitoWelcomeState>
  /** @returns the latest snapshot. */
  state(): KitoWelcomeState
}

/**
 * Run one Telegram device login and store the Identity token used directly by model routes.
 * @param options.publish - push a snapshot to the welcome window.
 * @param options.saveIdentity - persist `KITO_IDENTITY_TOKEN`.
 * @param options.saveRefreshToken - persist `KITO_IDENTITY_REFRESH_TOKEN` when KT Identity issued one.
 * @param options.onSuccess - open the workspace after the login is stored.
 * @param options.remember - record the display profile after the token is stored. Failures do not undo the login.
 * @param options.openLogin - open the https confirmation page. Not called when a push starts.
 * @returns start, resend, cancel, and state operations.
 */
export function createKitoSignIn(options: {
  publish: (state: KitoWelcomeState) => void
  saveIdentity: (token: string) => Promise<{ ok: boolean }>
  saveRefreshToken?: (token: string) => Promise<{ ok: boolean }>
  onSuccess: () => void
  remember?: (token: string) => Promise<void>
  openLogin?: (url: string) => void
  fetchImpl?: typeof fetch
}): KitoSignIn {
  let current: {
    id: SignInAttemptId
    abort: AbortController
    phase: NonNullable<KitoWelcomeState['attempt']>['phase']
    authorizeUrl?: string
    userCode?: string
    hint?: string
    sessionId?: string
    opaqueCode?: string
    resendAt?: number
    push?: 'accepted' | 'rate-limited' | 'busy'
    failure?: KitoLoginFailure
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
      ...(current.hint === undefined ? {} : { hint: current.hint }),
      ...(current.resendAt === undefined ? {} : { resendAt: current.resendAt }),
      ...(current.push === undefined ? {} : { push: current.push }),
      ...(current.failure === undefined ? {} : { failure: current.failure }),
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
    async start(hint) {
      current?.abort.abort()
      const abort = new AbortController()
      const id = randomUUID() as SignInAttemptId
      const normalized = hint === undefined ? '' : normalizeTelegramHint(hint)
      current = {
        id, abort, phase: 'initializing', status: 'signed-out',
        ...(normalized === '' ? {} : { hint: normalized }),
      }
      publish()
      try {
        const challenge = await startKitoDeviceLogin({
          signal: abort.signal,
          ...(normalized === '' ? {} : { hint: normalized }),
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        })
        if (current.id !== id) return snapshot()
        current.phase = 'waiting-browser'
        current.sessionId = challenge.sessionId
        current.opaqueCode = challenge.opaqueCode
        current.authorizeUrl = challenge.loginUrl
        current.userCode = challenge.userCode
        if (normalized !== '') {
          current.push = 'accepted'
          current.resendAt = Date.now() + PUSH_COOLDOWN_MS
        }
        publish()
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
        const saved = await options.saveIdentity(identity.token)
        if (!saved.ok) throw new Error('KT Identity sign-in could not store the login token')
        if (identity.refreshToken !== undefined) await options.saveRefreshToken?.(identity.refreshToken)
        if (current.id !== id) return snapshot()
        await options.remember?.(identity.token).catch(() => undefined)
        if (current.id !== id) return snapshot()
        current.phase = 'succeeded'
        current.status = 'credential-stored'
        const state = publish()
        options.onSuccess()
        return state
      } catch (error) {
        if (current.id !== id) return snapshot()
        if (abort.signal.aborted) {
          current.phase = 'cancelled'
          return publish()
        }
        console.error('kito sign-in failed', failureDetail(error))
        const failure = failureOf(error)
        current.phase = failure.phase
        current.errorCode = failure.errorCode
        current.failure = failure.failure
        return publish()
      }
    },
    async resend(id) {
      if (current?.id !== id || current.phase !== 'waiting-browser' || current.hint === undefined
        || current.sessionId === undefined || current.opaqueCode === undefined) return snapshot()
      if (!resendAllowed(Date.now(), current.resendAt)) return snapshot()
      const result = await pushKitoDeviceLoginHint({
        sessionId: current.sessionId,
        opaqueCode: current.opaqueCode,
        hint: current.hint,
        signal: current.abort.signal,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      })
      if (current.id !== id) return snapshot()
      current.resendAt = Date.now() + PUSH_COOLDOWN_MS
      if (result === 'expired') {
        current.phase = 'expired'
        current.errorCode = 'expired'
        current.failure = 'expired'
        return publish()
      }
      current.push = result === 'accepted' ? 'accepted' : result === 'rate-limited' ? 'rate-limited' : 'busy'
      return publish()
    },
    openQr(id) {
      if (current?.id !== id || current.authorizeUrl === undefined) return
      options.openLogin?.(current.authorizeUrl)
    },
    cancel(id) {
      if (current?.id !== id) return Promise.resolve(snapshot())
      current.abort.abort()
      current.phase = 'cancelled'
      return Promise.resolve(publish())
    },
  }
}

function failureOf(error: unknown): {
  phase: 'expired' | 'failed'
  errorCode: NonNullable<NonNullable<KitoWelcomeState['attempt']>['errorCode']>
  failure: KitoLoginFailure
} {
  const message = error instanceof Error ? error.message : ''
  if (/denied/u.test(message)) return { phase: 'failed', errorCode: 'protocol', failure: 'denied' }
  if (/consumed/u.test(message)) return { phase: 'failed', errorCode: 'protocol', failure: 'consumed' }
  if (/timed out|expired/u.test(message)) return { phase: 'expired', errorCode: 'expired', failure: 'expired' }
  if (/could not store the login token/u.test(message)) return { phase: 'failed', errorCode: 'storage', failure: 'storage' }
  return { phase: 'failed', errorCode: 'network', failure: 'network' }
}
