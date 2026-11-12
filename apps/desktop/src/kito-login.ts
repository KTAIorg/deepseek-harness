/** Pure login transitions for the Kito welcome window. */

/** How long a second push of the same confirmation must wait. Matches Identity. */
export const PUSH_COOLDOWN_MS = 30_000

/** Recent accounts kept on this computer. */
export const MAX_RECENT_ACCOUNTS = 3

/** Which welcome surface is showing. */
export type LoginScreen = 'recent' | 'username' | 'waiting' | 'failed'

/** Why a login attempt stopped. */
export type LoginFailure = 'expired' | 'denied' | 'consumed' | 'network' | 'storage' | 'rate-limited' | 'busy' | 'protocol'

/** Display-only record of a previous successful login. No token. */
export interface RecentAccount {
  readonly accountNo: string
  readonly displayName?: string
  readonly telegramUsername?: string
  readonly avatarUrl?: string
  readonly lastLoginAt: string
}

/**
 * Normalize a typed Telegram or KT hint the same way Identity does.
 * @param value - raw field text.
 * @returns the hint to send, or empty when nothing remains.
 */
export function normalizeTelegramHint(value: string): string {
  let hint = value.trim().toLowerCase()
  if (hint.startsWith('telegram:')) hint = hint.slice('telegram:'.length).trim()
  if (hint.startsWith('kt:')) hint = hint.slice('kt:'.length).trim()
  if (hint.startsWith('@')) hint = hint.slice(1).trim()
  return hint
}

/**
 * Put a successful login first and keep at most {@link MAX_RECENT_ACCOUNTS}.
 * @param current - stored rows.
 * @param next - the account that just signed in.
 * @param now - timestamp for the new row.
 * @returns the next stored list.
 */
export function rememberRecentAccount(
  current: readonly RecentAccount[],
  next: Omit<RecentAccount, 'lastLoginAt'>,
  now: string,
): RecentAccount[] {
  const previous = current.find(item => item.accountNo === next.accountNo)
  const rest = current.filter(item => item.accountNo !== next.accountNo)
  return [{
    accountNo: next.accountNo,
    lastLoginAt: now,
    ...(previous?.displayName === undefined ? {} : { displayName: previous.displayName }),
    ...(previous?.telegramUsername === undefined ? {} : { telegramUsername: previous.telegramUsername }),
    ...(previous?.avatarUrl === undefined ? {} : { avatarUrl: previous.avatarUrl }),
    ...(next.displayName === undefined ? {} : { displayName: next.displayName }),
    ...(next.telegramUsername === undefined ? {} : { telegramUsername: next.telegramUsername }),
    ...(next.avatarUrl === undefined ? {} : { avatarUrl: next.avatarUrl }),
  }, ...rest].slice(0, MAX_RECENT_ACCOUNTS)
}

/**
 * Drop one local row. An in-flight confirmation is a separate attempt.
 * @param current - stored rows.
 * @param accountNo - row to remove.
 * @returns the remaining rows.
 */
export function forgetRecentAccount(current: readonly RecentAccount[], accountNo: string): RecentAccount[] {
  return current.filter(item => item.accountNo !== accountNo)
}

/**
 * Classify one device-session poll status.
 * @param status - status field from Identity.
 * @returns whether to keep waiting, exchange the token, or stop.
 */
export function classifyPoll(status: string): 'wait' | 'exchange' | LoginFailure {
  if (status === 'pending' || status === '') return 'wait'
  if (status === 'approved' || status === 'confirmed') return 'exchange'
  if (status === 'denied') return 'denied'
  if (status === 'expired') return 'expired'
  if (status === 'consumed') return 'consumed'
  return 'protocol'
}

/**
 * Classify one failed status poll.
 * The first few 429 and 5xx answers stay on the waiting screen.
 * @param status - HTTP status.
 * @param failures - consecutive transport failures including this one.
 * @returns retry, or the failure that ends the attempt.
 */
export function classifyTransport(status: number, failures: number): 'retry' | 'rate-limited' | 'network' {
  if (status === 429) return failures >= 5 ? 'rate-limited' : 'retry'
  if (status >= 500) return failures >= 5 ? 'network' : 'retry'
  if (status === 404) return 'network'
  return 'network'
}

/**
 * Whether a resend may leave the client.
 * @param now - current epoch milliseconds.
 * @param resendAt - earliest allowed resend, absent before the first push.
 * @returns true when the cooldown has elapsed.
 */
export function resendAllowed(now: number, resendAt: number | undefined): boolean {
  return resendAt === undefined || now >= resendAt
}

/**
 * Pick the welcome surface from the attempt and the local list.
 * @param input.recentCount - stored accounts.
 * @param input.phase - current attempt phase, absent before one starts.
 * @param input.showForm - the person asked for a different account.
 * @returns the surface to render.
 */
export function loginScreen(input: {
  recentCount: number
  phase?: string
  showForm: boolean
}): LoginScreen {
  const phase = input.phase
  if (phase === 'failed' || phase === 'expired') return 'failed'
  if (phase === 'initializing' || phase === 'waiting-browser' || phase === 'exchanging' || phase === 'committing') {
    return 'waiting'
  }
  if (input.showForm || input.recentCount === 0) return 'username'
  return 'recent'
}
