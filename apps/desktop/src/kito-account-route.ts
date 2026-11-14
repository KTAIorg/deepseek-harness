/** Local account routes for the desktop web view. The Identity token never leaves this process. */

import { failureDetail } from './kito-http.ts'
import { readStoredCredential } from './kito-credentials.ts'
import {
  isKitoConsolePage,
  KITO_IDENTITY_TOKEN_REF,
  type KitoAccountView,
  type KitoConsolePage,
} from './kito-identity.ts'
import { loadKitoProfile } from './kito-wallet.ts'

export interface KitoRouteOptions {
  readonly showWelcome: () => void
  /** Open the ktapi.cc recharge page with the stored Identity login. */
  readonly openWallet: (identityToken: string) => Promise<void>
  /** Open a ktapi.cc console page with the same login. Falls back to {@link openWallet}. */
  readonly openConsole?: (identityToken: string, page: KitoConsolePage) => Promise<void>
  /** Optional surface notified when opening the console fails instead of showing an unauthenticated form. */
  readonly onConsoleError?: (error: unknown) => void
  /** Revoke the ktapi.cc console session kept for the recharge window. */
  readonly signOutConsole?: () => Promise<void>
  /** Read the spendable USD balance through the Identity login. */
  readonly readBalance?: (identityToken: string) => Promise<number | undefined>
  /** Renew and store the Identity token from the saved refresh token; undefined when none can be issued. */
  readonly refreshIdentity?: () => Promise<string | undefined>
  /** Remove the stored Identity token and refresh token after sign-out. */
  readonly forgetIdentity?: () => Promise<void>
  /** Remove legacy local model keys after sign-out or a confirmed signed-out read. */
  readonly forgetModelKeys?: () => Promise<void>
  /** Test seam. Production reads `KITO_IDENTITY_TOKEN` from the harness home. */
  readonly readToken?: () => Promise<string | undefined>
  /** Test seam. Production calls KT Identity and NewAPI. */
  readonly loadAccount?: (token: string) => Promise<KitoAccountView>
  /** Test seam for profile-only loading when exercising `readBalance` separately. */
  readonly loadProfile?: (token: string) => Promise<KitoAccountView>
}

/**
 * Answer Kito account requests on the desktop app origin.
 * @param request - renderer request.
 * @param options - shell actions and optional test readers.
 * @returns a response, or undefined when the path belongs to the host.
 */
export async function handleKitoAppRoute(request: Request, options: KitoRouteOptions): Promise<Response | undefined> {
  const url = new URL(request.url)
  if (url.hostname !== 'app') return undefined
  if (url.pathname === '/kito/account' && request.method === 'GET') {
    return readAccountResponse(options)
  }
  if (url.pathname === '/kito/sign-in' && request.method === 'POST') {
    options.showWelcome()
    return Response.json({ ok: true })
  }
  if (url.pathname === '/kito/topup' && request.method === 'POST') {
    return openConsolePage(options, 'wallet')
  }
  if (url.pathname === '/kito/open' && request.method === 'POST') {
    const page = url.searchParams.get('target')
    if (!isKitoConsolePage(page)) return Response.json({ ok: false }, { status: 400 })
    return openConsolePage(options, page)
  }
  if (url.pathname === '/kito/sign-out' && request.method === 'POST') {
    await options.signOutConsole?.()
    await options.forgetModelKeys?.()
    await options.forgetIdentity?.()
    return Response.json({ ok: true })
  }
  return undefined
}

async function openConsolePage(options: KitoRouteOptions, page: KitoConsolePage): Promise<Response> {
  const token = await (options.readToken ?? (() => readStoredCredential(KITO_IDENTITY_TOKEN_REF)))()
  if (token === undefined) {
    options.showWelcome()
    return Response.json({ ok: false }, { status: 401 })
  }
  try {
    if (options.openConsole !== undefined) await options.openConsole(token, page)
    else if (page === 'wallet') await options.openWallet(token)
    else return Response.json({ ok: false }, { status: 501 })
    return Response.json({ ok: true })
  } catch (error) {
    options.onConsoleError?.(error)
    const status = error !== null && typeof error === 'object' && 'status' in error
      && typeof error.status === 'number' && error.status >= 400 && error.status <= 599
      ? error.status
      : 503
    return Response.json({ ok: false }, { status })
  }
}

/**
 * A rejected or missing Identity token is renewed once from the refresh token. A confirmed
 * signed-out read removes legacy local model keys, so stale keys cannot restore model access.
 */
async function readAccountResponse(options: KitoRouteOptions): Promise<Response> {
  const token = await (options.readToken ?? (() => readStoredCredential(KITO_IDENTITY_TOKEN_REF)))()
  try {
    let activeToken = token
    let profile: KitoAccountView = activeToken === undefined ? { signedIn: false } : await loadProfile(options, activeToken)
    if (!profile.signedIn && options.refreshIdentity !== undefined) {
      const renewed = await options.refreshIdentity()
      if (renewed !== undefined) {
        activeToken = renewed
        profile = await loadProfile(options, renewed)
      }
    }
    if (!profile.signedIn) {
      await options.forgetModelKeys?.()
      return Response.json({ signedIn: false })
    }
    if (options.loadAccount !== undefined || options.readBalance === undefined) return Response.json(profile)
    const balance = await options.readBalance(activeToken ?? '').catch(() => undefined)
    return Response.json(balance === undefined ? profile : { ...profile, balance })
  } catch (error) {
    console.error('kito account read failed', failureDetail(error))
    // Surface transient Identity/network failures as 503 so the client resource retains the last good name and balance.
    return Response.json({ error: 'account-unavailable' }, { status: 503 })
  }
}

function loadProfile(options: KitoRouteOptions, token: string): Promise<KitoAccountView> {
  if (options.loadAccount !== undefined) return options.loadAccount(token)
  return options.loadProfile !== undefined ? options.loadProfile(token) : loadKitoProfile(token)
}
