/** Local account routes for the desktop web view. The Identity token never leaves this process. */

import { failureDetail } from './kito-http.ts'
import { readStoredCredential } from './kito-credentials.ts'
import { isKitoConsolePage, KITO_IDENTITY_TOKEN_REF, type KitoAccountView, type KitoConsolePage } from './kito-identity.ts'
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

async function readAccount(options: KitoRouteOptions): Promise<KitoAccountView> {
  const token = await (options.readToken ?? (() => readStoredCredential(KITO_IDENTITY_TOKEN_REF)))()
  if (token === undefined) return { signedIn: false }
  try {
    if (options.loadAccount !== undefined) return await options.loadAccount(token)
    const profile = await loadKitoProfile(token)
    if (!profile.signedIn || options.readBalance === undefined) return profile
    const balance = await options.readBalance().catch(() => undefined)
    return balance === undefined ? profile : { ...profile, balance }
  } catch (error) {
    console.error('kito account read failed', failureDetail(error))
    return { signedIn: true }
  }
}
