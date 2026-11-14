/** Open the ktapi.cc wallet with the console session ktapi.cc already uses. */

import { BrowserWindow, session, type Session } from 'electron'
import { failureDetail, kitoFetch, readJson } from './kito-http.ts'
import {
  criticalRetryDelayMs,
  fetchKitoAccountBalanceByKey,
  KITO_CONSOLE_PAGES,
  KITO_WALLET_URL,
  spendableFromEnsure,
  type KitoConsolePage,
} from './kito-identity.ts'
import {
  consoleCookiesFrom,
  consoleLogoutRequest,
  ConsoleLoginError,
  consoleRefreshRequest,
  establishKitoConsoleSession,
  KITO_CONSOLE_REFRESH_COOKIE,
  resolveKitoConsoleDeviceId,
  type ConsoleCookie,
} from './kito-wallet.ts'

const CONSOLE_TITLES: Record<KitoConsolePage, string> = {
  wallet: '充值',
  topups: '充值记录',
  usage: '消费记录',
  keys: 'Token',
}

const WALLET_PARTITION = 'persist:kito-wallet'

/** Reason the console window could not establish an authenticated session. */
export type KitoConsoleErrorKind = 'session-limit' | 'rate-limited' | 'identity-rejected' | 'unavailable'

/** Structured failure raised when opening the console cannot proceed without a session. */
export class KitoConsoleSessionError extends Error {
  /**
   * @param kind - classified reason for localized messaging.
   * @param status - HTTP status code surfaced to the app route (`409` / `429` / `401` / `503`).
   * @param message - non-secret diagnostic summary.
   */
  constructor(
    readonly kind: KitoConsoleErrorKind,
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'KitoConsoleSessionError'
  }
}

/** Optional seams for {@link openKitoConsole}. */
export interface OpenKitoConsoleOptions {
  /** Stable installation device identifier sent on `/api/iam/ensure`. */
  readonly deviceId?: string
  /** Optional device identifier resolver; defaults to {@link resolveKitoConsoleDeviceId}. */
  readonly resolveDeviceId?: () => Promise<string>
  /** Optional fetch implementation for tests. */
  readonly fetchImpl?: typeof fetch
  /** Optional window factory for tests. */
  readonly createWindow?: (title: string) => BrowserWindow
  /** Optional error surface when async SPA redirect fails after the window already opened. */
  readonly onSessionError?: (error: KitoConsoleSessionError) => void
}

let current: BrowserWindow | undefined
let consoleRetryAt = 0
/** When the stored console session last answered a refresh; a session older than this is revalidated before it is trusted. */
let consoleVerifiedAt = 0
/** Last user-initiated attempt, which is allowed to ignore the background cooldown once. */
let consoleExplicitAt = 0
let lastEnsureError: KitoConsoleSessionError | undefined
let openQueue: Promise<void> = Promise.resolve()
let currentTarget: string = KITO_WALLET_URL
let currentIdentityToken = ''
let currentOptions: OpenKitoConsoleOptions = {}
let recoveringLanding = false
let lastRecoveryAt = 0
/** A session that is merely stale is refreshed instead of being trusted until the page fails. */
const CONSOLE_SESSION_FRESH_MS = 10 * 60 * 1000
/** An explicit open may retry this often even while background reads are cooling down. */
const CONSOLE_EXPLICIT_RETRY_MS = 60 * 1000
/** Routes a console build serves when it wants a fresh login. */
const LOGIN_PATH = /\/(?:login|signin|sign-in|auth\/login)(?:[/?#]|$)/iu
const REJECTED_REFRESH_CODES = new Set(['AUTH_SESSION_REVOKED', 'AUTH_TOKEN_EXPIRED', 'AUTH_UNAUTHORIZED'])
let cachedBalance: { readonly at: number; readonly balance: number } | undefined
let balanceBlockedUntil = 0
const BALANCE_TTL_MS = 3 * 60 * 1000

/**
 * Show one ktapi.cc console page. Serializes concurrent requests, reuses a stored
 * refresh cookie without wiping it on transient errors, and refuses to drop onto an
 * unauthenticated login screen when `/api/iam/ensure` rejects the session.
 * @param identityToken - KT Identity access token. It is exchanged for a console cookie and not put in the URL.
 * @param page - wallet, recharge history, usage logs, or API keys.
 * @param options - optional device identifier and test seams.
 */
export function openKitoConsole(
  identityToken: string,
  page: KitoConsolePage = 'wallet',
  options: OpenKitoConsoleOptions = {},
): Promise<void> {
  const run = openQueue.then(() => openKitoConsoleSerialized(identityToken, page, options))
  openQueue = run.catch(() => undefined)
  return run
}

async function openKitoConsoleSerialized(
  identityToken: string,
  page: KitoConsolePage,
  options: OpenKitoConsoleOptions,
): Promise<void> {
  const target = KITO_CONSOLE_PAGES[page]
  const browser = session.fromPartition(WALLET_PARTITION)
  const origin = new URL(target).origin
  currentTarget = target
  currentIdentityToken = identityToken
  currentOptions = options

  await ensureConsoleSession(browser, origin, identityToken, {}, options)

  if (current !== undefined && !current.isDestroyed()) {
    current.setTitle(CONSOLE_TITLES[page])
    if (current.isMinimized()) current.restore()
    current.show()
    current.focus()
    // A reused window carries whatever session state the last page left, so it
    // gets the same login-landing recovery as a fresh one.
    await loadConsolePage(current, target, browser, origin, identityToken, options)
    return
  }

  const window = options.createWindow?.(CONSOLE_TITLES[page]) ?? new BrowserWindow({
    width: 1100,
    height: 780,
    title: CONSOLE_TITLES[page],
    webPreferences: {
      partition: WALLET_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  current = window
  window.on('closed', () => {
    if (current === window) current = undefined
    // Drop the balance cache when a wallet window closes so a top-up surfaces on the next focus.
    cachedBalance = undefined
  })
  window.webContents.setWindowOpenHandler(({ url }) => (
    isWebUrl(url) ? { action: 'allow' } : { action: 'deny' }
  ))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault()
  })
  const handleSpaLanding = (url: string): void => {
    if (!isRedirectedLoginUrl(url) || recoveringLanding) return
    if (Date.now() - lastRecoveryAt < 10_000) return
    void recoverFromLoginLanding(window, url, browser, origin)
  }
  window.webContents.on('did-navigate', (_event, url) => { handleSpaLanding(url) })
  window.webContents.on('did-navigate-in-page', (_event, url) => { handleSpaLanding(url) })
  window.show()
  await loadConsolePage(window, target, browser, origin, identityToken, options)
}

async function recoverFromLoginLanding(
  window: BrowserWindow,
  landingUrl: string,
  browser: Session,
  origin: string,
): Promise<void> {
  if (recoveringLanding || window.isDestroyed()) return
  recoveringLanding = true
  lastRecoveryAt = Date.now()
  try {
    console.warn('kito wallet session was rejected by the console; re-establishing it')
    await clearConsoleCookies(browser, origin)
    consoleVerifiedAt = 0
    await ensureConsoleSession(browser, origin, currentIdentityToken, { force: true }, currentOptions)
    if (window.isDestroyed()) return
    const resumeTarget = resumeTargetFromLanding(landingUrl, origin) ?? currentTarget
    await safeLoadUrl(window, resumeTarget)
  } catch (error) {
    const classified = toConsoleSessionError(error)
    console.error('kito wallet login failed', classified.message)
    if (!window.isDestroyed()) window.close()
    currentOptions.onSessionError?.(classified)
  } finally {
    recoveringLanding = false
  }
}

/**
 * Load one console page, and recover once if the site answered with its login page.
 *
 * A gap this closes: the stored `new_api_refresh` cookie can outlive its server
 * session (a rotation during top-up replaces it, a session cap evicts it). The
 * cookie's presence then proves nothing, so the window lands on the login page
 * while the desktop believes it is signed in. One forced re-login after
 * clearing the dead cookie turns that into a single extra navigation.
 * @param window - console window.
 * @param target - page to load.
 * @param browser - partition session holding the console cookies.
 * @param origin - console origin.
 * @param identityToken - KT Identity access token used for the re-login.
 * @param options - device identifier and fetch seams.
 */
async function loadConsolePage(
  window: BrowserWindow,
  target: string,
  browser: Session,
  origin: string,
  identityToken: string,
  options: OpenKitoConsoleOptions,
): Promise<void> {
  await safeLoadUrl(window, target)
  if (!isLoginLanding(window)) return
  console.warn('kito wallet session was rejected by the console; re-establishing it')
  await clearConsoleCookies(browser, origin)
  consoleVerifiedAt = 0
  await ensureConsoleSession(browser, origin, identityToken, { force: true }, options)
  await safeLoadUrl(window, target)
  if (isLoginLanding(window)) console.error('kito wallet login failed', 'console still requires a login after re-establishing the session')
}

async function safeLoadUrl(window: BrowserWindow, target: string): Promise<void> {
  try {
    await window.loadURL(target)
  } catch (error) {
    // Aborted navigation (-3) happens when the SPA redirects mid-load or a newer target supersedes it.
    if (error !== null && typeof error === 'object' && 'errno' in error && error.errno === -3) return
    if (error instanceof Error && error.message.includes('ERR_ABORTED')) return
    throw error
  }
}

/**
 * @param window - console window. @returns whether the page it shows is the console's login page.
 */
function isLoginLanding(window: BrowserWindow): boolean {
  try {
    return LOGIN_PATH.test(new URL(window.webContents.getURL()).pathname)
  } catch (_error) {
    return false
  }
}

function isRedirectedLoginUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    return LOGIN_PATH.test(parsed.pathname) && parsed.searchParams.has('redirect')
  } catch (_error) {
    return false
  }
}

function resumeTargetFromLanding(landingUrl: string, origin: string): string | undefined {
  try {
    const redirect = new URL(landingUrl).searchParams.get('redirect')
    if (redirect === null || !redirect.startsWith('/')) return undefined
    return new URL(redirect, origin).href
  } catch (_error) {
    return undefined
  }
}

type RefreshOutcome = 'valid' | 'rejected' | 'transient'

function toConsoleSessionError(error: unknown): KitoConsoleSessionError {
  if (error instanceof KitoConsoleSessionError) return error
  if (error instanceof ConsoleLoginError) {
    if (error.status === 409 || error.code === 'AUTH_SESSION_LIMIT') {
      return new KitoConsoleSessionError('session-limit', 409, error.message)
    }
    if (error.status === 429 || error.code === 'AUTH_SESSION_ISSUANCE_LIMIT') {
      return new KitoConsoleSessionError('rate-limited', 429, error.message)
    }
    if (error.status === 401 || error.status === 403) {
      return new KitoConsoleSessionError('identity-rejected', error.status, error.message)
    }
    return new KitoConsoleSessionError('unavailable', 503, error.message)
  }
  const message = error instanceof Error ? error.message : String(error)
  return new KitoConsoleSessionError('unavailable', 503, message)
}

/**
 * Make sure the partition holds a console session the site will accept.
 *
 * A stored cookie is not proof: it may have been rotated elsewhere or evicted
 * by the account's session cap. A session therefore has to be revalidated by
 * its own refresh endpoint before it is trusted past {@link CONSOLE_SESSION_FRESH_MS}.
 * Transient network/rate-limit errors preserve the stored cookie so valid sessions are
 * never discarded and duplicated; only confirmed rejection clears cookies and re-establishes.
 * @param browser - partition session holding the console cookies.
 * @param origin - console origin.
 * @param identityToken - KT Identity access token.
 * @param flags - `force` revalidates a session that is still considered fresh.
 * @param options - device identifier and fetch seams.
 */
async function ensureConsoleSession(
  browser: Session,
  origin: string,
  identityToken: string,
  flags: { force?: boolean } = {},
  options: OpenKitoConsoleOptions = {},
): Promise<void> {
  const stored = await hasRefreshCookie(browser, origin)
  if (stored && flags.force !== true && Date.now() - consoleVerifiedAt < CONSOLE_SESSION_FRESH_MS) return
  if (stored) {
    const refreshResult = await refreshConsoleSession(browser, origin, options.fetchImpl)
    if (refreshResult === 'valid') {
      consoleVerifiedAt = Date.now()
      return
    }
    if (refreshResult === 'transient') {
      // Keep the existing cookie intact so the browser window can retry or use it directly.
      return
    }
    await clearConsoleCookies(browser, origin)
    consoleVerifiedAt = 0
  }
  const cooling = Date.now() < consoleRetryAt
  if (cooling && Date.now() - consoleExplicitAt < CONSOLE_EXPLICIT_RETRY_MS) {
    throw lastEnsureError ?? new KitoConsoleSessionError('unavailable', 503, 'KTAPI console login is cooling down')
  }
  consoleExplicitAt = Date.now()
  try {
    const deviceId = options.deviceId ?? await (options.resolveDeviceId ?? resolveKitoConsoleDeviceId)()
    const established = await establishKitoConsoleSession(identityToken, {
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      deviceId,
    })
    await storeConsoleCookies(browser, origin, established.cookies)
    const balance = spendableFromEnsure(established.payload)
    if (balance !== undefined) cachedBalance = { at: Date.now(), balance }
    consoleVerifiedAt = Date.now()
    consoleRetryAt = 0
    lastEnsureError = undefined
  } catch (error) {
    const retryMs = error instanceof ConsoleLoginError ? error.retryMs : 15 * 60 * 1000
    consoleRetryAt = Date.now() + retryMs
    const classified = toConsoleSessionError(error)
    lastEnsureError = classified
    console.error('kito wallet login failed', failureDetail(error))
    throw classified
  }
}

/**
 * Revalidate the stored console session through its own refresh endpoint.
 * Distinguishes confirmed session rejection (`401`/`403`/`AUTH_SESSION_REVOKED`)
 * from transient failures (`429`/`5xx`/network timeouts) so valid cookies are preserved.
 * @param browser - partition session holding the console cookies.
 * @param origin - console origin.
 * @param fetchImpl - optional fetch implementation for tests.
 * @returns `'valid'`, `'rejected'`, or `'transient'`.
 */
async function refreshConsoleSession(
  browser: Session,
  origin: string,
  fetchImpl: typeof fetch = kitoFetch,
): Promise<RefreshOutcome> {
  const stored = await browser.cookies.get({ url: `${origin}/api/user/auth`, name: KITO_CONSOLE_REFRESH_COOKIE })
  const refreshValue = stored.find(cookie => cookie.value.length > 0)?.value
  if (refreshValue === undefined) return 'rejected'
  const request = consoleRefreshRequest(KITO_WALLET_URL, refreshValue)
  try {
    const response = await fetchImpl(request.url, request.init)
    if (response.ok) {
      await storeConsoleCookies(browser, origin, consoleCookiesFrom(response))
      const balance = spendableFromEnsure(await readJson(response))
      if (balance !== undefined) cachedBalance = { at: Date.now(), balance }
      return 'valid'
    }
    const payload = await readJson(response)
    const code = payload !== null && typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string'
      ? payload.code
      : ''
    if (response.status === 401 || response.status === 403 || REJECTED_REFRESH_CODES.has(code)) {
      return 'rejected'
    }
    if (response.status === 429) {
      consoleRetryAt = Date.now() + criticalRetryDelayMs(response.headers.get('retry-after'))
    }
    return 'transient'
  } catch (error) {
    console.error('kito wallet session refresh failed', failureDetail(error))
    return 'transient'
  }
}

/** @param browser - partition session. @param origin - console origin. */
async function clearConsoleCookies(browser: Session, origin: string): Promise<void> {
  for (const cookie of await browser.cookies.get({ url: origin })) {
    await browser.cookies.remove(new URL(cookie.path || '/', origin).href, cookie.name)
  }
}

/**
 * Show the recharge page.
 * @param identityToken - KT Identity access token.
 */
export function openKitoWallet(identityToken: string): Promise<void> {
  return openKitoConsole(identityToken, 'wallet')
}

/** Optional API-key seams so background balance polling avoids creating website login sessions. */
export interface ReadBalanceOptions {
  /** Read the stored NewAPI relay key without network calls. */
  readonly readApiKey?: () => Promise<string | undefined>
  /** Derive or renew the NewAPI relay key from the Identity token when absent or rejected. */
  readonly refreshApiKey?: (identityToken: string) => Promise<string | undefined>
  /** Optional NewAPI base URL override for tests. */
  readonly baseUrl?: string
  /** Optional fetch implementation for tests. */
  readonly fetchImpl?: typeof fetch
}

/**
 * Read the spendable USD amount without consuming a website login session.
 * Prefers NewAPI's read-only `/api/usage/account/` endpoint using the derived
 * relay key (falling back to an already-stored console refresh cookie only when
 * that route is unavailable).
 * @param identityToken - KT Identity access token.
 * @param options - optional API-key reader/refresher and test seams.
 * @returns the balance, or undefined when no source reports one.
 */
export async function readKitoAccountBalance(
  identityToken: string,
  options: ReadBalanceOptions = {},
): Promise<number | undefined> {
  const now = Date.now()
  if (cachedBalance !== undefined && now - cachedBalance.at < BALANCE_TTL_MS) return cachedBalance.balance
  if (now < balanceBlockedUntil) return cachedBalance?.balance

  const fromApiKey = await readBalanceFromApiKey(identityToken, options)
  if (fromApiKey !== undefined) {
    cachedBalance = { at: Date.now(), balance: fromApiKey }
    return fromApiKey
  }
  return readKitoConsoleBalance()
}

async function readBalanceFromApiKey(
  identityToken: string,
  options: ReadBalanceOptions,
): Promise<number | undefined> {
  const keyRequest = {
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  }
  let apiKey = await options.readApiKey?.()
  if ((apiKey === undefined || apiKey === '') && identityToken !== '') {
    apiKey = await options.refreshApiKey?.(identityToken)
  }
  if (apiKey === undefined || apiKey === '') return undefined

  let result = await fetchKitoAccountBalanceByKey(apiKey, keyRequest)
  if (result.status === 'unauthorized' && identityToken !== '' && options.refreshApiKey !== undefined) {
    const renewed = await options.refreshApiKey(identityToken)
    if (renewed !== undefined && renewed !== '') {
      result = await fetchKitoAccountBalanceByKey(renewed, keyRequest)
    }
  }
  if (result.status === 'rate-limited') {
    balanceBlockedUntil = Date.now() + criticalRetryDelayMs(result.retryAfter)
    return cachedBalance?.balance
  }
  if (result.status === 'ok') return result.balance
  return undefined
}

/**
 * Read the spendable USD amount from the stored console session.
 * Refresh rotates the cookie, so the replacement is written back before the next read.
 * @returns the balance, or undefined when no console session is stored.
 */
export async function readKitoConsoleBalance(): Promise<number | undefined> {
  if (cachedBalance !== undefined && Date.now() - cachedBalance.at < BALANCE_TTL_MS) return cachedBalance.balance
  const browser = session.fromPartition(WALLET_PARTITION)
  const origin = new URL(KITO_WALLET_URL).origin
  const stored = await browser.cookies.get({ url: `${origin}/api/user/auth`, name: KITO_CONSOLE_REFRESH_COOKIE })
  const refreshValue = stored.find(cookie => cookie.value.length > 0)?.value
  if (refreshValue === undefined) return undefined
  const request = consoleRefreshRequest(KITO_WALLET_URL, refreshValue)
  const response = await kitoFetch(request.url, request.init)
  if (response.status === 429) {
    balanceBlockedUntil = Date.now() + criticalRetryDelayMs(response.headers.get('retry-after'))
    await response.body?.cancel()
    return cachedBalance?.balance
  }
  const payload = await readJson(response)
  if (!response.ok) return cachedBalance?.balance
  await storeConsoleCookies(browser, origin, consoleCookiesFrom(response))
  const balance = spendableFromEnsure(payload)
  if (balance === undefined) return cachedBalance?.balance
  cachedBalance = { at: Date.now(), balance }
  return balance
}

/**
 * Revoke the website login kept for the recharge window, using ktapi.cc's existing logout.
 * @param options - optional fetch seam for tests.
 */
export async function signOutKitoConsole(options: { readonly fetchImpl?: typeof fetch } = {}): Promise<void> {
  const browser = session.fromPartition(WALLET_PARTITION)
  const origin = new URL(KITO_WALLET_URL).origin
  const stored = await browser.cookies.get({ url: `${origin}/api/user/auth`, name: KITO_CONSOLE_REFRESH_COOKIE })
  const refreshValue = stored.find(cookie => cookie.value.length > 0)?.value
  if (refreshValue !== undefined) {
    const request = consoleLogoutRequest(KITO_WALLET_URL, refreshValue)
    try {
      const response = await (options.fetchImpl ?? kitoFetch)(request.url, request.init)
      await readJson(response)
      if (!response.ok) console.error('kito wallet logout failed', response.status)
    } catch (error) {
      console.error('kito wallet logout failed', failureDetail(error))
    }
  }
  await clearConsoleCookies(browser, origin)
  consoleRetryAt = 0
  consoleVerifiedAt = 0
  consoleExplicitAt = 0
  lastEnsureError = undefined
  lastRecoveryAt = 0
  recoveringLanding = false
  balanceBlockedUntil = 0
  cachedBalance = undefined
  if (current !== undefined && !current.isDestroyed()) current.close()
}

async function hasRefreshCookie(browser: Session, origin: string): Promise<boolean> {
  const stored = await browser.cookies.get({ url: `${origin}/api/user/auth`, name: KITO_CONSOLE_REFRESH_COOKIE })
  return stored.some(cookie => cookie.value.length > 0)
}

async function storeConsoleCookies(browser: Session, origin: string, cookies: readonly ConsoleCookie[]): Promise<void> {
  for (const cookie of cookies) {
    await browser.cookies.set({
      url: new URL(cookie.path, origin).href,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
    })
  }
}

function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
