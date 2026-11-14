/** Turn the stored KT Identity login into a ktapi.cc console session for the wallet page. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveKitoHarnessHome } from './kito-home.ts'
import { failureDetail, jsonHeaders, kitoFetch, readJson, withTimeout } from './kito-http.ts'
import { identityBaseUrl, kitoAccountView, KITO_WALLET_URL, spendableFromEnsure, type KitoAccountView } from './kito-identity.ts'

/** Cookie the NewAPI console uses to recognize a login. The value never leaves this process. */
export const KITO_CONSOLE_REFRESH_COOKIE = 'new_api_refresh'
const CONSOLE_DEVICE_FILE = '.console-device-id'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export interface ConsoleCookie {
  readonly name: string
  readonly value: string
  readonly path: string
  readonly httpOnly: boolean
  readonly secure: boolean
  readonly sameSite: 'strict' | 'lax' | 'no_restriction'
  readonly expirationDate?: number
}

/**
 * Parse one `Set-Cookie` line into the fields Electron can store.
 * @param header - one cookie, including attributes.
 * @returns the cookie, or undefined when the line has no name or value.
 */
export function parseSetCookie(header: string): ConsoleCookie | undefined {
  const parts = header.split(';').map(part => part.trim()).filter(part => part.length > 0)
  const first = parts[0]
  if (first === undefined) return undefined
  const separator = first.indexOf('=')
  if (separator <= 0) return undefined
  const name = first.slice(0, separator).trim()
  const value = first.slice(separator + 1).trim()
  if (name.length === 0 || value.length === 0) return undefined
  let path = '/'
  let httpOnly = false
  let secure = false
  let sameSite: ConsoleCookie['sameSite'] = 'lax'
  let expirationDate: number | undefined
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=')
    const key = (eq < 0 ? part : part.slice(0, eq)).trim().toLowerCase()
    const attr = eq < 0 ? '' : part.slice(eq + 1).trim()
    if (key === 'path' && attr.startsWith('/')) path = attr
    else if (key === 'httponly') httpOnly = true
    else if (key === 'secure') secure = true
    else if (key === 'samesite') {
      const site = attr.toLowerCase()
      sameSite = site === 'strict' ? 'strict' : site === 'none' ? 'no_restriction' : 'lax'
    } else if (key === 'max-age') {
      const seconds = Number(attr)
      if (Number.isFinite(seconds) && seconds > 0) expirationDate = Math.floor(Date.now() / 1000) + Math.floor(seconds)
    } else if (key === 'expires' && expirationDate === undefined) {
      const time = Date.parse(attr)
      if (Number.isFinite(time)) expirationDate = Math.floor(time / 1000)
    }
  }
  return { name, value, path, httpOnly, secure, sameSite, ...(expirationDate === undefined ? {} : { expirationDate }) }
}

/** @param response - console login response. @returns every cookie the response set. */
export function consoleCookiesFrom(response: Response): readonly ConsoleCookie[] {
  const lines = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  return lines.flatMap((line) => {
    const cookie = parseSetCookie(line)
    return cookie === undefined ? [] : [cookie]
  })
}

/**
 * Return a stable device identifier for this Kito Harness home so repeated
 * console sign-ins from the same installation can replace their own session
 * instead of accumulating duplicate rows on the server.
 * @param home - Kito Harness data directory; defaults to {@link resolveKitoHarnessHome}.
 * @returns persisted UUID for this desktop profile.
 */
export async function resolveKitoConsoleDeviceId(home: string = resolveKitoHarnessHome()): Promise<string> {
  const path = join(home, CONSOLE_DEVICE_FILE)
  try {
    const existing = (await readFile(path, 'utf8')).trim()
    if (UUID_RE.test(existing)) return existing
  } catch {
    // Missing or unreadable id falls through to generate and store a fresh one.
  }
  const generated = randomUUID()
  try {
    await mkdir(home, { recursive: true })
    await writeFile(path, `${generated}\n`, { mode: 0o600 })
  } catch {
    // A read-only home still receives a consistent in-run identifier.
  }
  return generated
}

/**
 * Ask ktapi.cc to accept the Identity login and return the console session cookies.
 * The token is not placed in the page URL.
 * @param identityToken - KT Identity access token.
 * @param input - optional wallet page, stable client device id, and fetch implementation.
 * @returns the page to open and the cookies that sign it in.
 */
export async function establishKitoConsoleSession(
  identityToken: string,
  input: { readonly fetchImpl?: typeof fetch; readonly walletUrl?: string; readonly deviceId?: string } = {},
): Promise<{ readonly pageUrl: string; readonly cookies: readonly ConsoleCookie[]; readonly payload: unknown }> {
  const pageUrl = input.walletUrl ?? KITO_WALLET_URL
  const origin = new URL(pageUrl).origin
  const fetchImpl = input.fetchImpl ?? kitoFetch
  const deviceId = input.deviceId?.trim()
  let response: Response
  try {
    response = await fetchImpl(`${origin}/api/iam/ensure`, {
      method: 'POST',
      headers: jsonHeaders({
        authorization: `Bearer ${identityToken}`,
        ...(deviceId ? { 'x-kito-device-id': deviceId } : {}),
      }),
      body: deviceId ? JSON.stringify({ device_id: deviceId }) : '{}',
      signal: withTimeout(undefined),
    })
  } catch (error) {
    throw new ConsoleLoginError(`KTAPI console login failed (${failureDetail(error)})`, 60_000, 0, '')
  }
  const payload = await readJson(response)
  if (!response.ok) {
    const code = payload !== null && typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string'
      ? payload.code
      : ''
    const retryAfter = Number(response.headers.get('retry-after'))
    const waitMs = response.status === 429
      ? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 10 * 60 * 1000)
      : response.status === 409 ? 15 * 60 * 1000 : 60 * 1000
    throw new ConsoleLoginError(
      `KTAPI console login failed (${response.status}${code === '' ? '' : ` ${code}`})`,
      waitMs,
      response.status,
      code,
    )
  }
  const cookies = consoleCookiesFrom(response)
  if (!cookies.some(cookie => cookie.name === KITO_CONSOLE_REFRESH_COOKIE)) {
    throw new ConsoleLoginError('KTAPI console login did not return a session', 60_000, response.status, '')
  }
  return { pageUrl, cookies, payload }
}

/**
 * Build the existing console logout call. The refresh cookie is the session; the Identity token is not sent.
 * @param pageUrl - wallet page whose origin owns the cookie.
 * @param refreshValue - `new_api_refresh` value already stored for that origin.
 * @returns the request that revokes this one website login.
 */
/**
 * Build the existing console refresh call. The response rotates the refresh cookie and includes the spendable quota.
 * @param pageUrl - wallet page whose origin owns the cookie.
 * @param refreshValue - `new_api_refresh` value already stored for that origin.
 * @returns the request that renews this one website login.
 */
export function consoleRefreshRequest(pageUrl: string, refreshValue: string): { readonly url: string; readonly init: RequestInit } {
  const origin = new URL(pageUrl).origin
  return {
    url: `${origin}/api/user/auth/refresh`,
    init: {
      method: 'POST',
      headers: {
        ...jsonHeaders(),
        cookie: `${KITO_CONSOLE_REFRESH_COOKIE}=${refreshValue}`,
        origin,
        referer: pageUrl,
      },
      body: '{}',
    },
  }
}

export function consoleLogoutRequest(pageUrl: string, refreshValue: string): { readonly url: string; readonly init: RequestInit } {
  const origin = new URL(pageUrl).origin
  return {
    url: `${origin}/api/user/auth/logout`,
    init: {
      method: 'POST',
      headers: {
        ...jsonHeaders(),
        cookie: `${KITO_CONSOLE_REFRESH_COOKIE}=${refreshValue}`,
        origin,
        referer: pageUrl,
      },
      body: '{}',
    },
  }
}

const CONSOLE_SESSION_TTL_MS = 15 * 60 * 1000

/** A console login the server asked us not to repeat immediately. */
export class ConsoleLoginError extends Error {
  /**
   * @param message - status only, never the token or cookie.
   * @param retryMs - how long to wait before another attempt.
   * @param status - HTTP status code (0 for transport errors).
   * @param code - gateway error code such as `AUTH_SESSION_LIMIT`.
   */
  constructor(
    message: string,
    readonly retryMs: number,
    readonly status = 0,
    readonly code = '',
  ) {
    super(message)
    this.name = 'ConsoleLoginError'
  }
}

interface DesktopSession {
  readonly at: number
  readonly pageUrl: string
  readonly account: KitoAccountView
  readonly cookies: readonly ConsoleCookie[]
}

let cachedSession: DesktopSession | undefined
let sessionInflight: Promise<DesktopSession> | undefined
let consoleRetryAt = 0

/**
 * Read the Telegram name. This does not create a ktapi.cc console login.
 * A console login is only created when the recharge page opens, because each
 * successful `/api/iam/ensure` occupies one of the 50 active website sessions.
 * @param identityToken - KT Identity access token.
 * @returns the signed-in name, without a balance until a console session exists.
 */
export async function loadKitoProfile(identityToken: string): Promise<KitoAccountView> {
  if (cachedSession !== undefined && Date.now() - cachedSession.at < CONSOLE_SESSION_TTL_MS) return cachedSession.account
  const response = await kitoFetch(`${identityBaseUrl()}/identity/v1/account/me`, {
    method: 'GET',
    headers: jsonHeaders({ authorization: `Bearer ${identityToken}` }),
    signal: withTimeout(undefined),
  })
  const payload = await readJson(response)
  if (response.status === 401) return { signedIn: false }
  if (!response.ok) throw new Error(`KT Identity account failed (${response.status})`)
  return kitoAccountView(payload, undefined)
}

/**
 * Read the Telegram name and the console cookies from one login.
 * Repeated account checks reuse this result so the console login limit is not spent on polling.
 * @param identityToken - KT Identity access token.
 * @returns the account summary and the cookies that open the wallet signed in.
 */
export async function loadKitoDesktopSession(identityToken: string): Promise<DesktopSession> {
  if (cachedSession !== undefined && cachedSession.cookies.length > 0 && Date.now() - cachedSession.at < CONSOLE_SESSION_TTL_MS) {
    return cachedSession
  }
  if (Date.now() < consoleRetryAt) {
    if (cachedSession !== undefined) return cachedSession
    throw new Error('KTAPI console login is cooling down')
  }
  sessionInflight ??= readDesktopSession(identityToken).finally(() => { sessionInflight = undefined })
  return sessionInflight
}

async function readDesktopSession(identityToken: string): Promise<DesktopSession> {
  const fetchImpl = kitoFetch
  const profileResponse = await fetchImpl(`${identityBaseUrl()}/identity/v1/account/me`, {
    method: 'GET',
    headers: jsonHeaders({ authorization: `Bearer ${identityToken}` }),
    signal: withTimeout(undefined),
  })
  const profilePayload = await readJson(profileResponse)
  if (profileResponse.status === 401) throw new Error('KT Identity account rejected the stored login')
  if (!profileResponse.ok) throw new Error(`KT Identity account failed (${profileResponse.status})`)
  let established: Awaited<ReturnType<typeof establishKitoConsoleSession>>
  try {
    established = await establishKitoConsoleSession(identityToken, { fetchImpl })
  } catch (error) {
    console.error('kito wallet login failed', failureDetail(error))
    consoleRetryAt = Date.now() + (error instanceof ConsoleLoginError ? error.retryMs : 60_000)
    if (cachedSession !== undefined && cachedSession.cookies.length > 0) return cachedSession
    const session: DesktopSession = {
      at: Date.now(),
      pageUrl: KITO_WALLET_URL,
      cookies: [],
      account: kitoAccountView(profilePayload, undefined),
    }
    cachedSession = session
    return session
  }
  const session: DesktopSession = {
    at: Date.now(),
    pageUrl: established.pageUrl,
    cookies: established.cookies,
    account: kitoAccountView(profilePayload, spendableFromEnsure(established.payload)),
  }
  cachedSession = session
  return session
}
