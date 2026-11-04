/** Compact sidebar account summary and the detailed Telegram account Settings page. */
import { useEffect, useRef, useState } from 'react'
import {
  IconLoadingOutlineMedium, IconPaperPlaneOutlineMedium, IconUserOutlineMedium,
  IconWarningOutlineMedium, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ResourceSnapshot } from '@deepseek-ai/dsh-client-resources/client'
import { zh, type KitoAccountCopyKey } from './copy.ts'
import { KITO_ACCOUNT_RESOURCE, refreshKitoAccount, type KitoAccountView } from './account-resource.ts'
import css from './Brand.module.css'

/** Injected by the brand plugin from the shared locale service. */
export interface KitoLocaleControls {
  readonly setLocale?: ((id: string) => void) | undefined
  readonly readLocale?: (() => string) | undefined
  readonly subscribeLocale?: ((listener: () => void) => () => void) | undefined
  readonly t?: ((key: KitoAccountCopyKey) => string) | undefined
}

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
 * @param view - account summary from the shared resource, absent before the first successful read.
 * @param label - optional localized fallback for the signed-out and loading states.
 * @returns the current account label, including a spendable balance only when it is usable.
 */
export function kitoAccountLabel(
  view: KitoAccountView | undefined,
  label: (key: KitoAccountCopyKey) => string = key => zh[key],
): string {
  if (view === undefined) return label('loading')
  if (!view.signedIn) return label('signIn')
  const name = view.displayName?.trim() || 'Kito'
  return typeof view.balance === 'number' ? `${name} · ${formatKitoBalance(view.balance)}` : name
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
 * @param account - latest successfully read account.
 * @param target - console page. Signed-out clicks start Telegram login.
 */
function openConsole(account: KitoAccountView, target: ConsoleTarget): void {
  const path = account.signedIn ? `dsh-app://app/kito/open?target=${target}` : 'dsh-app://app/kito/sign-in'
  void fetch(path, { method: 'POST' }).then(
    (response) => { if (!response.ok) refreshKitoAccount() },
    () => { refreshKitoAccount() },
  )
}

/** Sign out, then read the cleared state; a transport failure retains the account for retry. */
function signOut(): void {
  void fetch('dsh-app://app/kito/sign-out', { method: 'POST' })
    .then((response) => { if (response.ok) refreshKitoAccount() }, () => { refreshKitoAccount() })
}

function spendableBalance(account: KitoAccountView | undefined): number | undefined {
  if (account === undefined || !account.signedIn) return undefined
  return account.balance
}

function CopyLine({ label, value, copyLabel, copiedLabel }: {
  label: string
  value: string
  copyLabel: string
  copiedLabel: string
}) {
  const [copied, setCopied] = useState(false)
  const mounted = useRef(true)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current !== undefined) window.clearTimeout(timer.current)
    }
  }, [])
  return (
    <div className={css.copyRow}>
      <span className={css.copyLabel}>{label}</span>
      <span className={css.copyValue} title={value}>{value}</span>
      <button
        type="button"
        className={css.copyButton}
        onClick={() => {
          void writeClipboard(value).then((ok) => {
            if (!ok || !mounted.current) return
            setCopied(true)
            timer.current = window.setTimeout(() => { setCopied(false) }, 1200)
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

function AccountLinks({ account, label }: {
  account: KitoAccountView
  label: (key: KitoAccountCopyKey) => string
}) {
  return (
    <div className={css.panelActions}>
      {CONSOLE_LINKS.map(([target, key]) => (
        <button key={target} type="button" className={css.panelButton} onClick={() => { openConsole(account, target) }}>
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

type FooterAccountState = 'loading' | 'unavailable' | 'signed-in' | 'signed-out'

function footerAccountState(resource: ResourceSnapshot<KitoAccountView>): FooterAccountState {
  const account = resource.value
  if (account === undefined) return resource.status === 'failed' ? 'unavailable' : 'loading'
  return account.signedIn ? 'signed-in' : 'signed-out'
}

function FooterIcon({ state }: { state: FooterAccountState }) {
  if (state === 'loading') return <IconLoadingOutlineMedium size={16} />
  if (state === 'unavailable') return <IconWarningOutlineMedium size={16} />
  if (state === 'signed-in') return <IconUserOutlineMedium size={16} />
  return <IconPaperPlaneOutlineMedium size={16} />
}

/**
 * Keep one compact account entry above More; details and sign-out stay in Settings.
 * @param props - sidebar geometry, resource hook and shared locale controls.
 * @returns the account footer, or null when macOS hides the whole collapsed column.
 */
export function KitoAccountFooter({ wide, useResource, ...controls }: PropsRuntime<'sidebar.footer.action'> & KitoLocaleControls) {
  const resource = useResource<'kitoaccount'>(KITO_ACCOUNT_RESOURCE)
  if (!wide && document.documentElement.dataset.platform === 'darwin') return null
  const account = resource.value
  const label = (key: KitoAccountCopyKey): string => controls.t?.(key) ?? zh[key]
  const state = footerAccountState(resource)
  const title = state === 'unavailable' ? label('accountUnavailable') : kitoAccountLabel(account, label)
  const hint = resource.status === 'failed' && account !== undefined ? `${title} · ${label('accountUnavailable')}` : title
  return (
    <div className={css.account} data-wide={wide} data-account-state={state}>
      <Tooltip label={hint} side="right" portal>
        <button
          type="button"
          className={css.accountButton}
          aria-label={state === 'unavailable' ? label('retry') : title}
          disabled={state === 'loading'}
          onClick={() => {
            if (state === 'unavailable') { refreshKitoAccount(); return }
            /* v8 ignore next -- Loading disables the only undefined-account action. */
            if (account !== undefined) openConsole(account, 'wallet')
          }}
        >
          <span className={css.accountIcon}><FooterIcon state={state} /></span>
          {wide && <span className={css.accountName}>{title}</span>}
          {wide && resource.status === 'failed' && account !== undefined && <IconWarningOutlineMedium size={14} />}
        </button>
      </Tooltip>
    </div>
  )
}

/**
 * Show the detailed Telegram identity, shared balance, console operations and sign-out.
 * @param props - Settings shell actions, shared account resource and locale controls.
 * @returns the account Settings section, retaining the last good data through refresh failures.
 */
export function KitoAccountSection({ useResource, t }: PropsRuntime<'settings.section'> & KitoLocaleControls) {
  const resource = useResource<'kitoaccount'>(KITO_ACCOUNT_RESOURCE)
  const account = resource.value
  const label = (key: KitoAccountCopyKey): string => t?.(key) ?? zh[key]
  const signedIn = account?.signedIn === true
  const balance = spendableBalance(account)
  const name = account?.displayName?.trim() || 'Kito'
  return (
    <section className={css.panel} aria-label={label('account')}>
      <h2 className={css.panelTitle}>
        {account === undefined ? label('account') : signedIn ? name : label('signedOut')}
      </h2>
      <p className={css.panelStatus} role="status">
        {resource.status === 'failed' ? label('accountUnavailable')
          : account === undefined ? label('loading') : signedIn ? label('signedIn') : label('signInHint')}
      </p>
      {resource.status === 'failed' && (
        <button type="button" className={css.panelButton} onClick={refreshKitoAccount}>{label('retry')}</button>
      )}
      {signedIn && <AccountFacts account={account} label={label} />}
      {balance !== undefined && <BalanceLine balance={balance} label={label} />}
      {account !== undefined && (
        signedIn
          ? (
            <>
              <AccountLinks account={account} label={label} />
              <button type="button" className={css.panelButton} onClick={signOut}>
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
