/** Open the ktapi.cc wallet with the console session ktapi.cc already uses. */

import { BrowserWindow, session, type Session } from 'electron'
import { readStoredCredential } from './kito-credentials.ts'
import { failureDetail, kitoFetch, readJson } from './kito-http.ts'
import { accountUsageRequest, criticalRetryDelayMs, KITO_CONSOLE_PAGES, KITO_NEWAPI_KEY_REF, KITO_WALLET_URL, newapiBaseUrl, spendableFromEnsure, usdFromAccountUsage, type KitoConsolePage } from './kito-identity.ts'
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
let cachedBalance: { readonly at: number; readonly balance: number } | undefined
let balanceBlockedUntil = 0
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
    if (current.webContents.getURL() !== target) await current.loadURL(target)
    return
  }
  const browser = session.fromPartition(WALLET_PARTITION)
  const origin = new URL(target).origin
  if (!await hasRefreshCookie(browser, origin) && Date.now() >= consoleRetryAt) {
    try {
      const established = await establishKitoConsoleSession(identityToken)
      await storeConsoleCookies(browser, origin, established.cookies)
      const balance = spendableFromEnsure(established.payload)
      if (balance !== undefined) cachedBalance = { at: Date.now(), balance }
    } catch (error) {
      consoleRetryAt = Date.now() + 15 * 60 * 1000
      console.error('kito wallet login failed', failureDetail(error))
    }
  }
  if (!await hasRefreshCookie(browser, origin)) {
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
  await window.loadURL(target)
}

/**
 * Show the recharge page.
 * @param identityToken - KT Identity access token.
 */
export function openKitoWallet(identityToken: string): Promise<void> {
  return openKitoConsole(identityToken, 'wallet')
}

/**
 * Read the spendable USD amount from the stored relay key.
 * The website session is only a fallback, so the sidebar balance does not wait for the recharge window.
 * @returns the balance, or undefined when neither source reports one.
 */
export async function readKitoAccountBalance(): Promise<number | undefined> {
  const now = Date.now()
  if (cachedBalance !== undefined && now - cachedBalance.at < BALANCE_TTL_MS) return cachedBalance.balance
  if (now < balanceBlockedUntil) return cachedBalance?.balance
  const fromKey = await readBalanceFromApiKey()
  if (fromKey?.limited === true) {
    balanceBlockedUntil = Date.now() + fromKey.retryAfterMs
    return cachedBalance?.balance
  }
  if (fromKey?.balance !== undefined) {
    cachedBalance = { at: Date.now(), balance: fromKey.balance }
    return fromKey.balance
  }
  return readKitoConsoleBalance()
}

interface ApiKeyBalance { readonly balance?: number; readonly limited?: boolean; readonly retryAfterMs: number }

async function readBalanceFromApiKey(): Promise<ApiKeyBalance | undefined> {
  const apiKey = await readStoredCredential(KITO_NEWAPI_KEY_REF)
  if (apiKey === undefined) return undefined
  try {
    const request = accountUsageRequest(newapiBaseUrl(), apiKey)
    const response = await kitoFetch(request.url, request.init)
    if (response.status === 429) {
      await response.body?.cancel()
      return { limited: true, retryAfterMs: criticalRetryDelayMs(response.headers.get('retry-after')) }
    }
    const payload = await readJson(response)
    if (!response.ok) return undefined
    const balance = usdFromAccountUsage(payload)
    return balance === undefined ? undefined : { balance, retryAfterMs: 0 }
  } catch (error) {
    console.error('kito balance read failed', failureDetail(error))
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
  for (const cookie of await browser.cookies.get({ url: origin })) {
    await browser.cookies.remove(new URL(cookie.path || '/', origin).href, cookie.name)
  }
  consoleRetryAt = 0
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
