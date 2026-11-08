/** Open the ktapi.cc wallet with the console session ktapi.cc already uses. */

import { BrowserWindow, session, type Session } from 'electron'
import { failureDetail, kitoFetch, readJson } from './kito-http.ts'
import { criticalRetryDelayMs, KITO_CONSOLE_PAGES, KITO_WALLET_URL, spendableFromEnsure, type KitoConsolePage } from './kito-identity.ts'
import { consoleCookiesFrom, consoleLogoutRequest, consoleRefreshRequest, establishKitoConsoleSession, KITO_CONSOLE_REFRESH_COOKIE, type ConsoleCookie } from './kito-wallet.ts'

const CONSOLE_TITLES: Record<KitoConsolePage, string> = {
  wallet: '充值',
  topups: '充值记录',
  usage: '消费记录',
  keys: 'Token',
}

const WALLET_PARTITION = 'persist:kito-wallet'

let current: BrowserWindow | undefined
let consoleRetryAt = 0
/** When the stored console session last answered a refresh; a session older than this is revalidated before it is trusted. */
let consoleVerifiedAt = 0
/** Last user-initiated attempt, which is allowed to ignore the background cooldown once. */
let consoleExplicitAt = 0
/** A session that is merely stale is refreshed instead of being trusted until the page fails. */
const CONSOLE_SESSION_FRESH_MS = 10 * 60 * 1000
/** An explicit open may retry this often even while background reads are cooling down. */
const CONSOLE_EXPLICIT_RETRY_MS = 60 * 1000
/** Routes a console build serves when it wants a fresh login. */
const LOGIN_PATH = /\/(?:login|signin|sign-in|auth\/login)(?:[/?#]|$)/iu
let cachedBalance: { readonly at: number; readonly balance: number } | undefined
let balanceBlockedUntil = 0
/** One diagnosis per blocked window: a refused console login must not repeat in every poll. */
let balanceFailureLogged = false
const BALANCE_TTL_MS = 3 * 60 * 1000

/**
 * Show one ktapi.cc console page. A stored console cookie is reused; a new login is created only when that cookie is absent.
 * @param identityToken - KT Identity access token. It is exchanged for a console cookie and not put in the URL.
 * @param page - wallet, recharge history, usage logs, or API keys.
 */
export async function openKitoConsole(identityToken: string, page: KitoConsolePage = 'wallet'): Promise<void> {
  const target = KITO_CONSOLE_PAGES[page]
  if (current !== undefined && !current.isDestroyed()) {
    current.setTitle(CONSOLE_TITLES[page])
    if (current.isMinimized()) current.restore()
    current.show()
    current.focus()
    // A reused window carries whatever session state the last page left, so it
    // gets the same login-landing recovery as a fresh one.
    const browser = session.fromPartition(WALLET_PARTITION)
    await loadConsolePage(current, target, browser, new URL(target).origin, identityToken)
    return
  }
  const browser = session.fromPartition(WALLET_PARTITION)
  const origin = new URL(target).origin
  if (!await ensureConsoleSession(browser, origin, identityToken)) {
    console.error('kito wallet login failed', 'opening the console page without a console session')
  }
  const window = new BrowserWindow({
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
  })
  window.webContents.setWindowOpenHandler(({ url }) => (
    isWebUrl(url) ? { action: 'allow' } : { action: 'deny' }
  ))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault()
  })
  window.show()
  await loadConsolePage(window, target, browser, origin, identityToken)
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
 */
async function loadConsolePage(
  window: BrowserWindow, target: string, browser: Session, origin: string, identityToken: string,
): Promise<void> {
  await window.loadURL(target)
  if (!isLoginLanding(window)) return
  console.warn('kito wallet session was rejected by the console; re-establishing it')
  await clearConsoleCookies(browser, origin)
  consoleVerifiedAt = 0
  if (!await ensureConsoleSession(browser, origin, identityToken, { force: true })) return
  await window.loadURL(target)
  if (isLoginLanding(window)) console.error('kito wallet login failed', 'console still requires a login after re-establishing the session')
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

/**
 * Make sure the partition holds a console session the site will accept.
 *
 * A stored cookie is not proof: it may have been rotated elsewhere or evicted
 * by the account's session cap. A session therefore has to be revalidated by
 * its own refresh endpoint before it is trusted past {@link CONSOLE_SESSION_FRESH_MS},
 * and a refused refresh clears it instead of letting every later page fall
 * back to the login screen.
 * @param browser - partition session holding the console cookies.
 * @param origin - console origin.
 * @param identityToken - KT Identity access token.
 * @param options - `force` revalidates a session that is still considered fresh.
 * @returns whether a usable session is stored afterwards.
 */
async function ensureConsoleSession(
  browser: Session, origin: string, identityToken: string, options: { force?: boolean } = {},
): Promise<boolean> {
  const stored = await hasRefreshCookie(browser, origin)
  if (stored && options.force !== true && Date.now() - consoleVerifiedAt < CONSOLE_SESSION_FRESH_MS) return true
  if (stored) {
    if (await refreshConsoleSession(browser, origin)) {
      consoleVerifiedAt = Date.now()
      return true
    }
    await clearConsoleCookies(browser, origin)
    consoleVerifiedAt = 0
  }
  const cooling = Date.now() < consoleRetryAt
  if (cooling && Date.now() - consoleExplicitAt < CONSOLE_EXPLICIT_RETRY_MS) return false
  consoleExplicitAt = Date.now()
  try {
    const established = await establishKitoConsoleSession(identityToken)
    await storeConsoleCookies(browser, origin, established.cookies)
    const balance = spendableFromEnsure(established.payload)
    if (balance !== undefined) cachedBalance = { at: Date.now(), balance }
    consoleVerifiedAt = Date.now()
    consoleRetryAt = 0
    return true
  } catch (error) {
    consoleRetryAt = Date.now() + 15 * 60 * 1000
    console.error('kito wallet login failed', failureDetail(error))
    return false
  }
}

/**
 * Revalidate the stored console session through its own refresh endpoint.
 * @param browser - partition session holding the console cookies.
 * @param origin - console origin.
 * @returns whether the session answered; rotated cookies are stored either way.
 */
async function refreshConsoleSession(browser: Session, origin: string): Promise<boolean> {
  const stored = await browser.cookies.get({ url: `${origin}/api/user/auth`, name: KITO_CONSOLE_REFRESH_COOKIE })
  const refreshValue = stored.find(cookie => cookie.value.length > 0)?.value
  if (refreshValue === undefined) return false
  const request = consoleRefreshRequest(KITO_WALLET_URL, refreshValue)
  try {
    const response = await kitoFetch(request.url, request.init)
    if (!response.ok) {
      await response.body?.cancel()
      return false
    }
    await storeConsoleCookies(browser, origin, consoleCookiesFrom(response))
    const balance = spendableFromEnsure(await readJson(response))
    if (balance !== undefined) cachedBalance = { at: Date.now(), balance }
    return true
  } catch (error) {
    console.error('kito wallet session refresh failed', failureDetail(error))
    return false
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

/**
 * Read the spendable USD amount through the Identity login.
 * A stored website session is reused; without one, the Identity token establishes that session once.
 * @param identityToken - KT Identity access token.
 * @returns the balance, or undefined when no source reports one.
 */
export async function readKitoAccountBalance(identityToken: string): Promise<number | undefined> {
  const now = Date.now()
  if (cachedBalance !== undefined && now - cachedBalance.at < BALANCE_TTL_MS) return cachedBalance.balance
  if (now < balanceBlockedUntil) return cachedBalance?.balance
  const fromIdentity = await readBalanceFromIdentity(identityToken)
  if (fromIdentity?.balance !== undefined) {
    cachedBalance = { at: Date.now(), balance: fromIdentity.balance }
    return fromIdentity.balance
  }
  return readKitoConsoleBalance()
}

interface IdentityBalance { readonly balance?: number }

async function readBalanceFromIdentity(identityToken: string): Promise<IdentityBalance | undefined> {
  if (identityToken.length === 0) return undefined
  const browser = session.fromPartition(WALLET_PARTITION)
  const origin = new URL(KITO_WALLET_URL).origin
  if (await hasRefreshCookie(browser, origin)) return undefined
  // Each successful ensure spends one of the account's active console sessions, so a
  // refused login waits out its cooldown instead of retrying on the next account poll.
  if (Date.now() < consoleRetryAt) return undefined
  try {
    const established = await establishKitoConsoleSession(identityToken)
    await storeConsoleCookies(browser, origin, established.cookies)
    const balance = spendableFromEnsure(established.payload)
    balanceFailureLogged = false
    return balance === undefined ? undefined : { balance }
  } catch (error) {
    consoleRetryAt = Date.now() + 15 * 60 * 1000
    balanceBlockedUntil = Date.now() + 60_000
    if (!balanceFailureLogged) {
      balanceFailureLogged = true
      console.error('kito balance login failed', failureDetail(error))
    }
    return undefined
  }
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
 */
export async function signOutKitoConsole(): Promise<void> {
  const browser = session.fromPartition(WALLET_PARTITION)
  const origin = new URL(KITO_WALLET_URL).origin
  const stored = await browser.cookies.get({ url: `${origin}/api/user/auth`, name: KITO_CONSOLE_REFRESH_COOKIE })
  const refreshValue = stored.find(cookie => cookie.value.length > 0)?.value
  if (refreshValue !== undefined) {
    const request = consoleLogoutRequest(KITO_WALLET_URL, refreshValue)
    try {
      const response = await kitoFetch(request.url, request.init)
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
  balanceFailureLogged = false
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
