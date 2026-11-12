/** Recent Kito logins stored on this computer. Display fields only. */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { forgetRecentAccount, rememberRecentAccount, type RecentAccount } from './kito-login.ts'

/**
 * Read the local recent-account list.
 * @param home - Kito harness home.
 * @returns at most three rows, or none when the file is missing or unreadable.
 */
export async function readRecentAccounts(home: string): Promise<RecentAccount[]> {
  try {
    const parsed = JSON.parse(await readFile(join(home, 'recent-accounts.json'), 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentAccount).slice(0, 3)
  } catch {
    return []
  }
}

/**
 * Remember one successful login.
 * @param home - Kito harness home.
 * @param next - display fields from the account profile.
 * @returns the stored list.
 */
export async function storeRecentAccount(home: string, next: Omit<RecentAccount, 'lastLoginAt'>): Promise<RecentAccount[]> {
  const list = rememberRecentAccount(await readRecentAccounts(home), next, new Date().toISOString())
  await writeRecentAccounts(home, list)
  return list
}

/**
 * Remove one local row. This does not cancel a confirmation already sent.
 * @param home - Kito harness home.
 * @param accountNo - row to drop.
 * @returns the remaining rows.
 */
export async function dropRecentAccount(home: string, accountNo: string): Promise<RecentAccount[]> {
  const list = forgetRecentAccount(await readRecentAccounts(home), accountNo)
  await writeRecentAccounts(home, list)
  return list
}

async function writeRecentAccounts(home: string, list: readonly RecentAccount[]): Promise<void> {
  await mkdir(home, { recursive: true })
  await writeFile(join(home, 'recent-accounts.json'), `${JSON.stringify(list)}\n`)
}

function isRecentAccount(value: unknown): value is RecentAccount {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.accountNo === 'string' && row.accountNo !== '' && typeof row.lastLoginAt === 'string'
}
