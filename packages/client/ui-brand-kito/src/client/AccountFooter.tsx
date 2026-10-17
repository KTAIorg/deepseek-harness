/** Sidebar and settings account: Telegram name, shared Kito balance, and top-up. */
import { useEffect, useState } from 'react'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './Brand.module.css'

interface KitoAccountView {
  readonly signedIn: boolean
  readonly displayName?: string
  readonly balance?: number
}

/** Window event the desktop shell dispatches after Telegram login is stored. */
const KITO_ACCOUNT_REFRESH = 'kito-account'

/**
 * Format the shared spendable amount the way the Kito title bar does.
 * @param balance - USD amount from NewAPI quota.
 * @returns a short decimal, or the integer when there are no cents.
 */
export function formatKitoBalance(balance: number): string {
  const amount = Number.isInteger(balance) ? String(balance) : balance.toFixed(2)
  return `$${amount}`
}

/**
 * @param view - account summary from the desktop shell. Undefined while the first read is in flight.
 * @returns the signed-in label, a sign-in label, or a loading label.
 */
export function kitoAccountLabel(view: KitoAccountView | undefined): string {
  if (view === undefined) return '账号'
  if (!view.signedIn) return '用 Telegram 登录'
  const name = view.displayName?.trim() || 'Kito'
  return typeof view.balance === 'number' ? `${name} · ${formatKitoBalance(view.balance)}` : name
}

/** Read the desktop account route. Tests replace global fetch. */
async function readAccount(): Promise<KitoAccountView> {
  const response = await fetch('dsh-app://app/kito/account')
  if (!response.ok) return { signedIn: false }
  const payload: unknown = await response.json()
  if (typeof payload !== 'object' || payload === null || !('signedIn' in payload)) return { signedIn: false }
  return payload as KitoAccountView
}

/** Keep the Telegram account in sync with the desktop shell. */
function useKitoAccount(): KitoAccountView | undefined {
  const [account, setAccount] = useState<KitoAccountView>()
  useEffect(() => {
    let active = true
    const load = (): void => {
      void readAccount().then((next) => { if (active) setAccount(next) }).catch(() => { if (active) setAccount({ signedIn: false }) })
    }
    load()
    const timer = setInterval(load, 20_000)
    window.addEventListener('focus', load)
    window.addEventListener(KITO_ACCOUNT_REFRESH, load)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', load)
      window.removeEventListener(KITO_ACCOUNT_REFRESH, load)
    }
  }, [])
  return account
}

/**
 * Open Telegram login, or the shared wallet once the account is known.
 * @param account - latest summary. A missing summary is still loading and must not start login.
 */
function openAccount(account: KitoAccountView | undefined): void {
  if (account === undefined) return
  void fetch(account.signedIn ? 'dsh-app://app/kito/topup' : 'dsh-app://app/kito/sign-in', { method: 'POST' })
}

/**
 * Show the signed-in Telegram name and balance, and open the shared wallet.
 * @param props - sidebar width. The rail keeps a compact control.
 * @returns the footer action.
 */
export function KitoAccountFooter({ wide }: SidebarFooterActionOwnerProps) {
  const account = useKitoAccount()
  const label = kitoAccountLabel(account)
  return (
    <div className={css.account}>
      <button type="button" onClick={() => { openAccount(account) }} title={wide ? '充值记入同一条 Kito 余额' : label}>
        {wide ? label : 'K'}
      </button>
    </div>
  )
}

/**
 * Settings account page. A stored Telegram login shows the nickname instead of asking to log in again.
 * @param _props - settings shell close action. This page stays inside the panel.
 * @returns the account section.
 */
export function KitoAccountSection(_props: SettingsSectionOwnerProps) {
  const account = useKitoAccount()
  const signedIn = account?.signedIn === true
  const name = account?.displayName?.trim() || 'Kito'
  return (
    <section className={css.panel} aria-label="账号">
      <h2 className={css.panelTitle}>{account === undefined ? '账号' : signedIn ? name : '尚未登录'}</h2>
      <p className={css.panelStatus}>
        {account === undefined ? '正在读取账号' : signedIn ? '已登录' : '登录后显示 Telegram 昵称'}
      </p>
      {signedIn && typeof account.balance === 'number' && (
        <p className={css.panelStatus}>余额 (USD) {formatKitoBalance(account.balance)}</p>
      )}
      {account !== undefined && (
        <div className={css.panelActions}>
          <button type="button" className={css.panelButton} onClick={() => { openAccount(account) }}>
            {signedIn ? '充值' : '用 Telegram 登录'}
          </button>
          {signedIn && (
            <button type="button" className={css.panelButton} onClick={() => { void fetch('dsh-app://app/kito/sign-out', { method: 'POST' }) }}>
              退出
            </button>
          )}
        </div>
      )}
    </section>
  )
}
