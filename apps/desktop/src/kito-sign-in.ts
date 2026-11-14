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
    readonly deeplink?: string
    readonly hint?: string
    readonly resendAt?: number
    readonly push?: 'accepted' | 'rate-limited' | 'busy'
    readonly failure?: KitoLoginFailure
  } | null
}

/** Options controlling how a device sign-in starts. */
export interface KitoSignInStartOptions {
  /** Launch the Telegram confirmation link as soon as the challenge is issued. */
  readonly open?: boolean
}

export interface KitoSignIn {
  /**
   * @param hint - Telegram username or KT account number. Empty starts a code without a push.
   * @param startOptions - optional launch behavior once the challenge is issued.
   * @returns the attempt after the device challenge is issued.
   */
  start(hint?: string, startOptions?: KitoSignInStartOptions): Promise<KitoWelcomeState>
  /**
   * Deliver confirmation to a Telegram username or KT account, reusing the active challenge when supported.
   * @param id - optional waiting attempt identifier.
   * @param hint - Telegram username or KT account number.
   * @returns the updated snapshot.
   */
  push(id: SignInAttemptId | undefined, hint: string): Promise<KitoWelcomeState>
  /** @param id - waiting attempt whose confirmation should be delivered again. @returns the same code. */
  resend(id: SignInAttemptId): Promise<KitoWelcomeState>
  /**
   * Open the Telegram bot deep link (with web fallback) for the waiting challenge,
   * or issue a fresh challenge and open it when none is waiting.
   * @param id - optional waiting attempt identifier.
   * @returns the current or newly started snapshot.
   */
  openQr(id?: SignInAttemptId): Promise<KitoWelcomeState>
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
 * @param options.openLogin - open the confirmation deep link (with https fallback). Not called unless explicitly requested.
 * @returns start, push, resend, openQr, cancel, and state operations.
 */
export function createKitoSignIn(options: {
  publish: (state: KitoWelcomeState) => void
  saveIdentity: (token: string) => Promise<{ ok: boolean }>
  saveRefreshToken?: (token: string) => Promise<{ ok: boolean }>
  onSuccess: () => void
  remember?: (token: string) => Promise<void>
  openLogin?: (url: string, fallbackUrl?: string) => Promise<void> | void
  fetchImpl?: typeof fetch
}): KitoSignIn {
  let current: {
    id: SignInAttemptId
    abort: AbortController
    phase: NonNullable<KitoWelcomeState['attempt']>['phase']
    authorizeUrl?: string
    deeplink?: string
    userCode?: string
    hint?: string
    sessionId?: string
    opaqueCode?: string
    resendAt?: number
    push?: 'accepted' | 'rate-limited' | 'busy'
    failure?: KitoLoginFailure
    errorCode?: NonNullable<KitoWelcomeState['attempt']>['errorCode']
    status: KitoWelcomeState['status']
    openOnChallenge?: boolean
  } | undefined

  const snapshot = (): KitoWelcomeState => ({
    status: current?.status ?? 'signed-out',
    links: { usageUrl: KITO_WALLET_URL, topUpUrl: KITO_WALLET_URL },
    attempt: current === undefined ? null : {
      id: current.id,
      phase: current.phase,
      ...(current.authorizeUrl === undefined ? {} : { authorizeUrl: current.authorizeUrl }),
      ...(current.deeplink === undefined ? {} : { deeplink: current.deeplink }),
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
  const openCurrent = async (entry: NonNullable<typeof current>): Promise<void> => {
    const target = entry.deeplink ?? entry.authorizeUrl
    if (target === undefined) return
    await options.openLogin?.(target, entry.authorizeUrl)
  }

  const start = async (hint?: string, startOptions?: KitoSignInStartOptions): Promise<KitoWelcomeState> => {
    current?.abort.abort()
    const abort = new AbortController()
    const id = randomUUID() as SignInAttemptId
    const normalized = hint === undefined ? '' : normalizeTelegramHint(hint)
    const entry: NonNullable<typeof current> = {
      id, abort, phase: 'initializing', status: 'signed-out',
      ...(normalized === '' ? {} : { hint: normalized }),
      ...(startOptions?.open ? { openOnChallenge: true } : {}),
    }
    current = entry
    publish()
    try {
      const challenge = await startKitoDeviceLogin({
        signal: abort.signal,
        ...(normalized === '' ? {} : { hint: normalized }),
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      })
      if (current !== entry) return snapshot()
      entry.phase = 'waiting-browser'
      entry.sessionId = challenge.sessionId
      entry.opaqueCode = challenge.opaqueCode
      entry.authorizeUrl = challenge.loginUrl
      entry.deeplink = challenge.loginDeeplink
      entry.userCode = challenge.userCode
      if (normalized !== '') {
        entry.push = 'accepted'
        entry.resendAt = Date.now() + PUSH_COOLDOWN_MS
      }
      publish()
      if (entry.openOnChallenge) {
        entry.openOnChallenge = false
        await openCurrent(entry)
      }
      const identity = await finishKitoDeviceLogin({
        sessionId: challenge.sessionId,
        opaqueCode: challenge.opaqueCode,
        intervalMs: challenge.interval * 1000,
        signal: abort.signal,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      })
      if (current !== entry) return snapshot()
      entry.phase = 'exchanging'
      publish()
      const saved = await options.saveIdentity(identity.token)
      if (!saved.ok) throw new Error('KT Identity sign-in could not store the login token')
      if (identity.refreshToken !== undefined) await options.saveRefreshToken?.(identity.refreshToken)
      if (current !== entry) return snapshot()
      await options.remember?.(identity.token).catch(() => undefined)
      if (current !== entry) return snapshot()
      entry.phase = 'succeeded'
      entry.status = 'credential-stored'
      const state = publish()
      options.onSuccess()
      return state
    } catch (error) {
      if (current !== entry) return snapshot()
      if (abort.signal.aborted) {
        entry.phase = 'cancelled'
        return publish()
      }
      console.error('kito sign-in failed', failureDetail(error))
      const failure = failureOf(error)
      entry.phase = failure.phase
      entry.errorCode = failure.errorCode
      entry.failure = failure.failure
      return publish()
    }
  }

  return {
    state: snapshot,
    start,
    async push(id, rawHint) {
      const normalized = normalizeTelegramHint(rawHint)
      if (normalized === '') return snapshot()
      const entry = current
      if (entry === undefined
        || (id !== undefined && entry.id !== id)
        || entry.phase !== 'waiting-browser'
        || entry.sessionId === undefined
        || entry.opaqueCode === undefined) {
        return start(normalized)
      }
      if (entry.hint === normalized && !resendAllowed(Date.now(), entry.resendAt)) return snapshot()
      let result
      try {
        result = await pushKitoDeviceLoginHint({
          sessionId: entry.sessionId,
          opaqueCode: entry.opaqueCode,
          hint: normalized,
          signal: entry.abort.signal,
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        })
      } catch {
        if (current !== entry) return snapshot()
        entry.push = 'busy'
        return publish()
      }
      if (current !== entry) return snapshot()
      if (result === 'unsupported' || result === 'expired') return start(normalized)
      if (result === 'accepted') {
        entry.hint = normalized
        entry.resendAt = Date.now() + PUSH_COOLDOWN_MS
        entry.push = 'accepted'
        return publish()
      }
      entry.push = result
      return publish()
    },
    async resend(id) {
      const entry = current
      if (entry?.id !== id || entry.phase !== 'waiting-browser' || entry.hint === undefined
        || entry.sessionId === undefined || entry.opaqueCode === undefined) return snapshot()
      if (!resendAllowed(Date.now(), entry.resendAt)) return snapshot()
      let result
      try {
        result = await pushKitoDeviceLoginHint({
          sessionId: entry.sessionId,
          opaqueCode: entry.opaqueCode,
          hint: entry.hint,
          signal: entry.abort.signal,
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        })
      } catch {
        if (current !== entry) return snapshot()
        entry.push = 'busy'
        return publish()
      }
      if (current !== entry) return snapshot()
      if (result === 'unsupported') return start(entry.hint)
      entry.resendAt = Date.now() + PUSH_COOLDOWN_MS
      if (result === 'expired') {
        entry.phase = 'expired'
        entry.errorCode = 'expired'
        entry.failure = 'expired'
        return publish()
      }
      entry.push = result === 'accepted' ? 'accepted' : result === 'rate-limited' ? 'rate-limited' : 'busy'
      return publish()
    },
    async openQr(id) {
      const entry = current
      if (entry !== undefined && (id === undefined || entry.id === id)) {
        if (entry.phase === 'waiting-browser' && (entry.deeplink !== undefined || entry.authorizeUrl !== undefined)) {
          await openCurrent(entry)
          return snapshot()
        }
        if (entry.phase === 'initializing') {
          entry.openOnChallenge = true
          return snapshot()
        }
      }
      return start(undefined, { open: true })
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
