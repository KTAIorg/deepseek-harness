/** Sidebar and settings account: name, KT account number, Telegram username, balance, and language. */
import { useEffect, useState } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import { zh, type KitoAccountCopyKey } from './copy.ts'
import css from './Brand.module.css'

interface KitoAccountView {
  readonly signedIn: boolean
  readonly displayName?: string
  readonly accountNo?: string
  readonly telegramUsername?: string
  readonly balance?: number
}

/** Injected by the brand plugin from the shared locale service. */
export interface KitoLocaleControls {
  readonly setLocale?: ((id: string) => void) | undefined
  readonly readLocale?: (() => string) | undefined
  readonly subscribeLocale?: ((listener: () => void) => () => void) | undefined
  readonly t?: ((key: KitoAccountCopyKey) => string) | undefined
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
 * @param label - optional localized fallback for the signed-out and loading states.
 * @returns the signed-in label, a sign-in label, or a loading label.
 */
export function kitoAccountLabel(
  view: KitoAccountView | undefined,
  label: (key: KitoAccountCopyKey) => string = key => zh[key],
): string {
  if (view === undefined) return label('account')
  if (!view.signedIn) return label('signIn')
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
    const timer = setInterval(load, 3 * 60 * 1000)
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

type ConsoleTarget = 'wallet' | 'topups' | 'usage' | 'keys'

const CONSOLE_LINKS = [
  ['wallet', 'topup'],
  ['topups', 'topups'],
  ['usage', 'usage'],
  ['keys', 'tokens'],
] as const

/**
 * Open Telegram login, or one ktapi.cc console page once the account is known.
 * @param account - latest summary. A missing summary is still loading and must not start login.
 * @param target - console page. Signed-out clicks always start login.
 */
function openConsole(account: KitoAccountView | undefined, target: ConsoleTarget): void {
  if (account === undefined) return
  const path = account.signedIn ? `dsh-app://app/kito/open?target=${target}` : 'dsh-app://app/kito/sign-in'
  void fetch(path, { method: 'POST' })
}

function CopyLine({ label, value, copyLabel, copiedLabel }: {
  label: string
  value: string
  copyLabel: string
  copiedLabel: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={css.copyRow}>
      <span className={css.copyLabel}>{label}</span>
      <span className={css.copyValue} title={value}>{value}</span>
      <button
        type="button"
        className={css.copyButton}
        onClick={() => {
          void writeClipboard(value).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => { setCopied(false) }, 1200)
          })
        }}
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  )
}

function BalanceLine({ balance, label }: { balance: number; label: (key: KitoAccountCopyKey) => string }) {
  return (
    <div className={css.balanceLine}>
      <span className={css.copyValue}>{label('balance')} {formatKitoBalance(balance)}</span>
    </div>
  )
}

function AccountLinks({ account, label, buttonClass }: {
  account: KitoAccountView
  label: (key: KitoAccountCopyKey) => string
  buttonClass: string | undefined
}) {
  return (
    <div className={buttonClass === css.panelButton ? css.panelActions : css.accountActions}>
      {CONSOLE_LINKS.map(([target, key]) => (
        <button key={target} type="button" className={buttonClass} onClick={() => { openConsole(account, target) }}>
          {label(key)}
        </button>
      ))}
    </div>
  )
}

function AccountFacts({ account, label }: { account: KitoAccountView; label: (key: KitoAccountCopyKey) => string }) {
  const name = account.displayName?.trim()
  const telegram = account.telegramUsername?.trim()
  return (
    <div className={css.copies}>
      {name && <CopyLine label={label('nickname')} value={name} copyLabel={label('copy')} copiedLabel={label('copied')} />}
      {account.accountNo && (
        <CopyLine label={label('accountNo')} value={account.accountNo} copyLabel={label('copy')} copiedLabel={label('copied')} />
      )}
      {telegram && (
        <CopyLine label={label('telegram')} value={`@${telegram}`} copyLabel={label('copy')} copiedLabel={label('copied')} />
      )}
    </div>
  )
}

/**
 * Show the signed-in name, the KT account number, and the language switch.
 * @param props - sidebar width plus the shared locale controls.
 * @returns the footer action.
 */
export function KitoAccountFooter({ wide, ...controls }: SidebarFooterActionOwnerProps & KitoLocaleControls) {
  const account = useKitoAccount()
  const label = (key: KitoAccountCopyKey): string => controls.t?.(key) ?? zh[key]
  const signedIn = account?.signedIn === true
  const title = kitoAccountLabel(account, label)
  if (!wide) {
    return (
      <div className={css.account}>
        <button type="button" className={css.accountButton} onClick={() => { openConsole(account, 'wallet') }} title={title}>K</button>
      </div>
    )
  }
  return (
    <div className={css.account}>
      {signedIn && account !== undefined
        ? <AccountFacts account={account} label={label} />
        : (
          <button type="button" className={css.accountButton} onClick={() => { openConsole(account, 'wallet') }} title={title}>
            {title}
          </button>
        )}
      {signedIn && account !== undefined && typeof account.balance === 'number' && (
        <BalanceLine balance={account.balance} label={label} />
      )}
      {signedIn && account !== undefined && <AccountLinks account={account} label={label} buttonClass={css.accountButton} />}
    </div>
  )
}

/**
 * Settings account page. A stored Telegram login shows the nickname and the copyable KT identifiers.
 * @param props - settings shell close action plus the shared locale controls.
 * @returns the account section.
 */
export function KitoAccountSection({ t }: SettingsSectionOwnerProps & KitoLocaleControls) {
  const account = useKitoAccount()
  const label = (key: KitoAccountCopyKey): string => t?.(key) ?? zh[key]
  const signedIn = account?.signedIn === true
  const name = account?.displayName?.trim() || 'Kito'
  return (
    <section className={css.panel} aria-label={label('account')}>
      <h2 className={css.panelTitle}>{account === undefined ? label('account') : signedIn ? name : label('signedOut')}</h2>
      <p className={css.panelStatus}>
        {account === undefined ? label('loading') : signedIn ? label('signedIn') : label('signInHint')}
      </p>
      {signedIn && account !== undefined && <AccountFacts account={account} label={label} />}
      {signedIn && account !== undefined && typeof account.balance === 'number' && (
        <BalanceLine balance={account.balance} label={label} />
      )}
      {account !== undefined && (
        signedIn
          ? (
            <>
              <AccountLinks account={account} label={label} buttonClass={css.panelButton} />
              <button type="button" className={css.panelButton} onClick={() => { void fetch('dsh-app://app/kito/sign-out', { method: 'POST' }) }}>
                {label('signOut')}
              </button>
            </>
          )
          : (
            <button type="button" className={css.panelButton} onClick={() => { openConsole(account, 'wallet') }}>
              {label('signIn')}
            </button>
          )
      )}
    </section>
  )
}
