/** Local account routes for the desktop web view. The Identity token never leaves this process. */

import { failureDetail } from './kito-http.ts'
import { readStoredCredential } from './kito-credentials.ts'
import {
  isKitoConsolePage,
  KITO_IDENTITY_TOKEN_REF,
  KITO_NEWAPI_KEY_REF,
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
  /** Revoke the ktapi.cc console session kept for the recharge window. */
  readonly signOutConsole?: () => Promise<void>
  /** Read the spendable USD balance from the stored console session, without creating a new one. */
  readonly readBalance?: () => Promise<number | undefined>
  /** Renew and store the Identity token from the saved refresh token; undefined when none can be issued. */
  readonly refreshIdentity?: () => Promise<string | undefined>
  /** Remove the stored Identity token and refresh token after sign-out. */
  readonly forgetIdentity?: () => Promise<void>
  /** Test seam. Production checks that `KITO_NEWAPI_API_KEY` is stored. */
  readonly hasModelKey?: () => Promise<boolean>
  /** Test seam. Production reads `KITO_IDENTITY_TOKEN` from the harness home. */
  readonly readToken?: () => Promise<string | undefined>
  /** Test seam. Production calls KT Identity and NewAPI. */
  readonly loadAccount?: (token: string) => Promise<KitoAccountView>
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
    return Response.json(await readAccount(options))
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
  if (options.openConsole !== undefined) await options.openConsole(token, page)
  else if (page === 'wallet') await options.openWallet(token)
  else return Response.json({ ok: false }, { status: 501 })
  return Response.json({ ok: true })
}

/**
 * A rejected or missing Identity token is renewed once from the refresh token. Without an Identity
 * login the view still reports a stored model key and its balance, because models keep working.
 */
async function readAccount(options: KitoRouteOptions): Promise<KitoAccountView> {
  const token = await (options.readToken ?? (() => readStoredCredential(KITO_IDENTITY_TOKEN_REF)))()
  try {
    let profile: KitoAccountView = token === undefined ? { signedIn: false } : await loadProfile(options, token)
    if (!profile.signedIn && options.refreshIdentity !== undefined) {
      const renewed = await options.refreshIdentity()
      if (renewed !== undefined) profile = await loadProfile(options, renewed)
    }
    if (!profile.signedIn) return await keyOnlyAccount(options)
    if (options.loadAccount !== undefined || options.readBalance === undefined) return profile
    const balance = await options.readBalance().catch(() => undefined)
    return balance === undefined ? profile : { ...profile, balance }
  } catch (error) {
    console.error('kito account read failed', failureDetail(error))
    return { signedIn: true }
  }
}

function loadProfile(options: KitoRouteOptions, token: string): Promise<KitoAccountView> {
  return options.loadAccount !== undefined ? options.loadAccount(token) : loadKitoProfile(token)
}

async function keyOnlyAccount(options: KitoRouteOptions): Promise<KitoAccountView> {
  const hasModelKey = options.hasModelKey ?? (async () => (await readStoredCredential(KITO_NEWAPI_KEY_REF)) !== undefined)
  if (!await hasModelKey()) return { signedIn: false }
  const balance = await options.readBalance?.().catch(() => undefined)
  return balance === undefined ? { signedIn: false, keyConfigured: true } : { signedIn: false, keyConfigured: true, balance }
}
