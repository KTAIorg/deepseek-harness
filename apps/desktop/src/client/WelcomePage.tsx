/** Desktop welcome presentation; account and credential operations stay in the preload. */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives/src/Toast.tsx'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives/src/StateDot.tsx'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import type { RecentAccount } from '../kito-login.ts'
import { normalizeTelegramHint } from '../kito-login.ts'
import { formatDesktopMessage } from '../locale.ts'
import type { WelcomeApi } from '../welcome-api.ts'

type Page = 'entry' | 'key'
type WelcomeAttempt = NonNullable<AccountView['attempt']> & {
  readonly userCode?: string
  readonly deeplink?: string
  readonly hint?: string
  readonly resendAt?: number
  readonly push?: 'accepted' | 'rate-limited' | 'busy'
  readonly failure?: 'denied' | 'consumed' | 'expired' | 'network' | 'storage'
}

/**
 * Render the standalone welcome flow using shell-owned operations and localized copy.
 * Offers QR scan, one-click Telegram launch, and username push simultaneously on one page.
 * @param props.api - isolated preload API; no account credentials reach the renderer.
 * @returns welcome pages with QR, direct Telegram jump, and username push controls.
 */
export function Welcome({ api }: { api: WelcomeApi }) {
  const { messages: m } = api
  const [expiryNotice, setExpiryNotice] = useState(false)
  const [page, setPage] = useState<Page>('entry')
  const pageRef = useRef<Page>('entry')
  const visiblePage = useRef<Page>('entry')
  const [attempt, setAttempt] = useState<WelcomeAttempt | null>(null)
  const attemptRef = useRef<WelcomeAttempt | null>(null)
  const [starting, setStarting] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<{ status: 'idle' | 'busy' | 'copied' | 'failed' }>({ status: 'idle' })
  const copyState = copyFeedback.status
  const [draft, setDraft] = useState('')
  const [username, setUsername] = useState('')
  const [hintError, setHintError] = useState('')
  const [recent, setRecent] = useState<readonly RecentAccount[]>([])
  const [clock, setClock] = useState(() => Date.now())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  const revision = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const userInput = useRef<HTMLInputElement>(null)
  const keyButton = useRef<HTMLButtonElement>(null)
  const focusEntry = useRef(false)

  function navigate(next: Page) {
    pageRef.current = next
    setPage(next)
  }

  function applyAccountState(state: AccountView & { attempt: WelcomeAttempt | null }) {
    attemptRef.current = state.attempt
    setAttempt(state.attempt)
    setStarting(false)
    setPushing(false)
    setCopyFeedback({ status: 'idle' })
  }

  useEffect(() => {
    mounted.current = true
    document.documentElement.lang = api.id
    document.title = m.welcomeTitle
    const takeNotice = (): void => {
      void api.takeNotice().then((notice) => {
        if (mounted.current && notice === 'session-expired') setExpiryNotice(true)
      }).catch((_closedChannel: unknown) => {
        // A closed Welcome IPC channel must not interrupt the sign-in page.
      })
    }
    takeNotice()
    void api.recentAccounts().then((rows) => { if (mounted.current) setRecent(rows) }).catch(() => undefined)
    const stop = api.onAccountState((state) => {
      revision.current++
      takeNotice()
      applyAccountState(state)
    })
    const initial = ++revision.current
    setStarting(true)
    void api.startSignIn().then((state) => {
      if (!mounted.current || revision.current !== initial) return
      if (state.attempt !== null) applyAccountState(state)
      else setStarting(false)
    }).catch(() => {
      if (mounted.current && revision.current === initial) setStarting(false)
    })
    return () => { mounted.current = false; stop() }
  }, [api, m.welcomeTitle])

  useEffect(() => {
    if (page === 'entry' && visiblePage.current !== 'entry') void api.analytics?.('auth_page_view', {})
    visiblePage.current = page
    if (page === 'key') input.current?.focus()
    else if (focusEntry.current) {
      focusEntry.current = false
      keyButton.current?.focus()
    }
  }, [page, api])

  useEffect(() => {
    if (copyState !== 'copied' && copyState !== 'failed') return
    const timer = setTimeout(() => { setCopyFeedback({ status: 'idle' }) }, 2000)
    return () => { clearTimeout(timer) }
  }, [copyFeedback])

  useEffect(() => {
    if (attempt?.resendAt === undefined) return
    setClock(Date.now())
    const timer = setInterval(() => { setClock(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [attempt?.resendAt])

  async function saveKey(event: FormEvent) {
    event.preventDefault()
    if (busyRef.current) return
    void api.analytics?.('api_key_save_click', {})
    const value = draft.trim()
    if (!/^[\x21-\x7e]+$/.test(value) || /^[A-Z][A-Z0-9_]*=[^=]/.test(value)
      || ((value.startsWith('"') || value.startsWith("'") || value.charCodeAt(0) === 96) && value.at(-1) === value[0])) {
      setError(value === '' ? m.welcomeKeyBlank : m.welcomeKeyInvalid)
      input.current?.focus()
      return
    }
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const result = await api.saveApiKey(value)
      if (!mounted.current) return
      if (result.ok) setDraft('')
      else setError(m.welcomeKeyFailed)
    } catch {
      if (mounted.current) setError(m.welcomeKeyFailed)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function skip() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await api.skip()
      if (mounted.current) setDraft('')
    } catch {
      if (mounted.current) setError(m.welcomeContinueFailed)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function refreshChallenge() {
    setHintError('')
    setStarting(true)
    const current = ++revision.current
    try {
      const state = await api.startSignIn()
      if (mounted.current && revision.current === current) applyAccountState(state)
    } catch {
      if (mounted.current && revision.current === current) setStarting(false)
    }
  }

  async function openTelegram() {
    setHintError('')
    void api.analytics?.('auth_page_click', { button_name: 'sign_in' })
    const current = attemptRef.current
    const waitingId = current?.phase === 'waiting-browser' ? current.id : undefined
    try {
      await api.openSignIn(waitingId)
    } catch {
      // Errors surface via the waiting state pushed by the main process.
    }
  }

  async function pushTo(raw: string) {
    const hint = normalizeTelegramHint(raw)
    if (hint === '') {
      setHintError(m.welcomeHintBlank)
      userInput.current?.focus()
      return
    }
    setHintError('')
    setPushing(true)
    const current = ++revision.current
    const waitingId = attemptRef.current?.phase === 'waiting-browser' ? attemptRef.current.id : undefined
    try {
      const state = await api.pushSignIn(waitingId, hint)
      if (mounted.current && revision.current === current) applyAccountState(state)
    } catch {
      if (mounted.current && revision.current === current) setPushing(false)
    }
  }

  async function copyLink() {
    const current = attemptRef.current
    if (current?.phase !== 'waiting-browser' || (copyState === 'busy' || copyState === 'copied')) return
    setCopyFeedback({ status: 'busy' })
    try {
      await api.copySignInLink(current.id)
      if (mounted.current && attemptRef.current === current) setCopyFeedback({ status: 'copied' })
    } catch {
      if (mounted.current && attemptRef.current === current) setCopyFeedback({ status: 'failed' })
    }
  }

  const phase = starting ? 'initializing' : attempt?.phase ?? 'idle'
  const waiting = phase === 'waiting-browser'
  const exchanging = phase === 'exchanging' || phase === 'committing' || phase === 'succeeded'
  const failed = phase === 'expired' || phase === 'failed'
  const qrUrl = waiting ? attempt?.authorizeUrl : undefined
  const normalizedDraft = normalizeTelegramHint(username)
  const cooldownSeconds = attempt?.resendAt !== undefined && attempt.hint !== undefined && attempt.hint === normalizedDraft
    ? Math.max(0, Math.ceil((attempt.resendAt - clock) / 1000))
    : 0
  const sendDisabled = pushing || cooldownSeconds > 0
  const sendLabel = pushing
    ? m.welcomeSending
    : cooldownSeconds > 0
      ? formatDesktopMessage(m.welcomePushCooldown, { seconds: String(cooldownSeconds) })
      : m.welcomeSend
  const failedTitle = phase === 'expired'
    ? m.welcomeAuthExpired
    : attempt?.failure === 'denied'
      ? m.welcomeDenied
      : m.welcomeAuthFailed
  const pushFeedback = ((): { tone: 'success' | 'warn'; text: string } | undefined => {
    if (!waiting || attempt?.push === undefined) return undefined
    if (attempt.push === 'accepted' && attempt.hint !== undefined) {
      return {
        tone: 'success',
        text: attempt.userCode
          ? formatDesktopMessage(m.welcomePushSentWithCode, { hint: `@${attempt.hint}`, code: attempt.userCode })
          : m.welcomePushSent,
      }
    }
    return attempt.push === 'rate-limited'
      ? { tone: 'warn', text: m.welcomePushRateLimited }
      : { tone: 'warn', text: m.welcomePushBusy }
  })()
  const heading = page === 'entry' ? 'welcome-heading' : 'key-title'

  return <>
    {expiryNotice && <Toast text={m.welcomeSessionExpired} onDone={() => { setExpiryNotice(false) }} />}
    <div className="titlebar" aria-hidden="true" />
    <main className="welcome" aria-labelledby={heading}>
      <img className="brand" src="assets/welcome-brand.svg" alt={m.welcomeBrand} width="472" height="32" />

      {page === 'entry' && !exchanging && (
        <div className="entry-stack">
          <div id="tagline" className="tagline">
            <h1 id="welcome-heading"><span>{m.welcomeTaglineBefore}</span><em>{m.welcomeTaglineBrand}</em><span>{m.welcomeTaglineAfter}</span></h1>
            <p id="welcome-description">{m.welcomeDescription}</p>
          </div>

          <section className="qr-section" aria-label={m.welcomeQrScanHint}>
            <div className={`qr-card${qrUrl ? '' : ' qr-card-empty'}`}>
              {qrUrl ? (
                <QRCodeSVG value={qrUrl} size={136} level="M" bgColor="#ffffff" fgColor="#0f1115" />
              ) : starting ? (
                <div className="qr-placeholder">
                  <StateDot state="ongoing" size={18} />
                  <span>{m.welcomeQrGenerating}</span>
                </div>
              ) : (
                <div className="qr-placeholder">
                  <span className="qr-status">{failed ? failedTitle : m.welcomeQrGenerating}</span>
                  <button id="auth-retry" type="button" className="qr-retry" onClick={() => { void refreshChallenge() }}>
                    {m.welcomeQrRefresh}
                  </button>
                </div>
              )}
            </div>

            {waiting ? (
              <div className="qr-meta">
                {attempt?.userCode && (
                  <span id="auth-code" className="auth-code">{formatDesktopMessage(m.welcomeCodeLabel, { code: attempt.userCode })}</span>
                )}
                <button
                  id="auth-copy"
                  className="text-link"
                  type="button"
                  disabled={copyState === 'busy' || copyState === 'copied'}
                  onClick={() => { void copyLink() }}
                >
                  {copyState === 'copied' ? m.welcomeAuthCopied : copyState === 'failed' ? m.welcomeAuthCopyFailed : m.welcomeAuthCopyLink}
                </button>
                <button id="auth-refresh" className="text-link" type="button" onClick={() => { void refreshChallenge() }}>
                  {m.welcomeQrRefresh}
                </button>
              </div>
            ) : (
              <p className="qr-caption">{failed ? m.welcomeAuthExpiredDescription : m.welcomeQrScanHint}</p>
            )}
          </section>

          <div id="entry-actions" className="actions-primary">
            <button id="sign-in" className="primary" type="button" onClick={() => { void openTelegram() }}>
              {m.welcomeOpenTelegram}
            </button>
            <button ref={keyButton} id="api-key" className="secondary" type="button" hidden onClick={() => { void api.analytics?.('auth_page_click', { button_name: 'api-key' }); navigate('key') }}>{m.welcomeApiKey}</button>
          </div>

          <section className="push-section" aria-label={m.welcomeOrPush}>
            <div className="push-divider"><span>{m.welcomeOrPush}</span></div>

            {recent.length > 0 && (
              <div id="recent-accounts" className="recent-list" aria-label={m.welcomeRecentQuick}>
                {recent.map(account => (
                  <button
                    key={account.accountNo}
                    type="button"
                    className="recent-chip"
                    disabled={pushing}
                    onClick={() => {
                      const label = account.telegramUsername ? `@${account.telegramUsername}` : account.accountNo
                      setUsername(label)
                      void pushTo(account.accountNo)
                    }}
                  >
                    <span className="recent-avatar" aria-hidden="true">{(account.displayName ?? account.telegramUsername ?? account.accountNo).trim().slice(0, 1).toUpperCase()}</span>
                    <span className="recent-name">{account.displayName ?? (account.telegramUsername ? `@${account.telegramUsername}` : account.accountNo)}</span>
                  </button>
                ))}
              </div>
            )}

            <form
              id="telegram-form"
              className="push-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                void pushTo(username)
              }}
            >
              <label className="visually-hidden" htmlFor="telegram-user">{m.welcomeHintPlaceholder}</label>
              <div className="push-row">
                <input
                  ref={userInput}
                  id="telegram-user"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={m.welcomeHintPlaceholder}
                  aria-describedby="hint-note hint-error"
                  aria-invalid={hintError !== ''}
                  value={username}
                  onChange={(event) => { setUsername(event.target.value); setHintError('') }}
                />
                <button id="push-send" className="secondary push-send" type="submit" disabled={sendDisabled}>
                  {sendLabel}
                </button>
              </div>
              <p id="hint-note" className="hint-note" hidden={hintError !== '' || pushFeedback !== undefined}>{m.welcomeHintNote}</p>
              <p id="hint-error" className="hint-error" role="alert" hidden={hintError === ''}>{hintError}</p>
              {hintError === '' && pushFeedback !== undefined && (
                <p id="hint-status" className={`hint-status hint-status-${pushFeedback.tone}`} aria-live="polite">
                  {pushFeedback.text}
                </p>
              )}
            </form>
          </section>
        </div>
      )}

      {page === 'entry' && exchanging && (
        <section id="auth-page" className="key-heading auth-exchanging" aria-live="polite">
          <StateDot state="ongoing" size={20} />
          <h1 id="auth-status">{m.welcomeAuthExchanging}</h1>
        </section>
      )}

      <form id="key-form" className="key-form" hidden={page !== 'key'} noValidate onSubmit={(event) => { void saveKey(event) }} aria-busy={busy}>
        <header className="key-heading"><h1 id="key-title">{m.welcomeKeyTitle}</h1><p id="key-description">{m.welcomeKeyDescription}</p></header>
        <div className="key-field">
          <label className="visually-hidden" htmlFor="key-input">{m.welcomeKeyPlaceholder}</label>
          <input ref={input} id="key-input" type="password" autoComplete="new-password" autoCapitalize="off" spellCheck={false} required
            aria-describedby="key-description key-error" aria-invalid={error !== ''} placeholder={m.welcomeKeyPlaceholder}
            value={draft} disabled={busy} onChange={(event) => { setDraft(event.target.value); setError('') }} />
          <p id="key-error" className="key-error" role="alert" hidden={error === ''}>{error}</p>
        </div>
      </form>
      <div id="key-actions" className="actions" hidden={page !== 'key'}>
        <button id="save-key" className="primary" type="submit" form="key-form" disabled={busy || draft.trim() === ''}>{m.welcomeKeySave}</button>
        <button id="skip-key" className="secondary" type="button" disabled={busy} onClick={() => { void skip() }}>{m.welcomeKeyLater}</button>
        <button id="back-to-login" className="back" type="button" disabled={busy} onClick={() => {
          if (busyRef.current) return
          setDraft(''); setError(''); focusEntry.current = true; navigate('entry')
        }}>{m.welcomeKeyBack}</button>
      </div>
    </main>
  </>
}
