// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { ResourceSnapshot } from '@deepseek-ai/dsh-client-resources/client'
import { apply as resourcesApply } from '@deepseek-ai/dsh-client-resources/client'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { KitoAccountFooter, KitoAccountSection, kitoAccountLabel } from '../src/client/AccountFooter.tsx'
import {
  KITO_ACCOUNT_REFRESH, KITO_ACCOUNT_RESOURCE, kitoAccountResource, parseKitoAccount, type KitoAccountView,
} from '../src/client/account-resource.ts'
import { KITO_EXTRA_LANGUAGES, KitoLanguageDock, type KitoLanguageDockProps } from '../src/client/LanguagePicker.tsx'
import { LANGUAGE_PACKS } from '../src/client/language-packs.ts'
import { en, zh } from '../src/client/copy.ts'
import { KitoBrandMark, KitoBrandName } from '../src/client/Brand.tsx'
import { Config as KitoConfig, apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const clipboard = vi.hoisted(() => ({ writeClipboard: vi.fn(async () => true) }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({
  ...await importOriginal(),
  writeClipboard: clipboard.writeClipboard,
}))

function provideLocale(ctx: Context): void {
  ctx.provide('locale', {
    register: () => () => undefined,
    addLanguage: () => () => undefined,
    setLocale: () => undefined,
    getSnapshot: () => ({
      active: 'zh',
      locales: [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }],
      revision: 0,
    }),
    subscribe: () => () => undefined,
    bind: () => (key: string) => key === 'account' ? '账号' : key,
  } as never)
}

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'sidebar.footer.action',
  'settings.section',
  'conversation.session.header.utilities',
  'conversation.hero.options',
  'conversation.header.trailing',
] as const

async function bench() {
  const ctx = new Context()
  provideLocale(ctx)
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  await ctx.plugin({ inject: ['slots'], apply: resourcesApply }).await()
  return { ctx, slots }
}

function accountResource(account: KitoAccountView | undefined, failed = false): ResourceSnapshot<KitoAccountView> {
  return {
    status: failed ? 'failed' : account === undefined ? 'loading' : 'live',
    value: account,
    failure: failed ? new RemoteError('kito-account/unavailable', 'Offline in this fixture.', {}) : undefined,
  }
}

function accountGlobals(resource: ResourceSnapshot<KitoAccountView>): GlobalStandardProps {
  const globals = { useResource: (() => resource) as GlobalStandardProps['useResource'] }
  return { ...({} as GlobalStandardProps), ...globals } // Global Standard Props
}

describe('Kito browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('defaults and validates the account refresh interval', () => {
    expect(KitoConfig({}).accountRefreshIntervalMs).toBe(180000)
    expect(KitoConfig({ accountRefreshIntervalMs: 1000 }).accountRefreshIntervalMs).toBe(1000)
    expect(() => { KitoConfig({ accountRefreshIntervalMs: 999 }) }).toThrow()
  })

  it('declares the slot registry, language service, and shared resources', () => {
    expect(inject).toEqual(['slots', 'locale', 'resources'])
  })

  it('leaves the slots to the official occupants in an official build', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('fills the sidebar slots for a local build and removes them on teardown', async () => {
    vi.stubGlobal('dshDesktop', {})
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
    await fiber.dispose()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('keeps the brand and language picker but no Telegram account entries on a Web page', async () => {
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of [
      'sidebar.brand.mark', 'sidebar.brand.name', 'conversation.session.header.utilities',
      'conversation.hero.options', 'conversation.header.trailing',
    ] as const) {
      expect(subject.slots.entries(hole)).toHaveLength(1)
    }
    expect(subject.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(subject.slots.entries('settings.section')).toHaveLength(0)
  })

  it('shows the product name, a local marker, and the version without the commit', () => {
    vi.stubEnv('DSH_CLIENT_VERSION', '0.2.1-rc.2')
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', 'commit-for-layout-test')
    vi.stubEnv('DSH_CLIENT_GIT_DIRTY', 'true')
    const view = render(<KitoBrandName />)
    expect(view.container.textContent).toBe('Kito Harness本地0.2.1-rc.2')
    expect(view.container.textContent).not.toContain('commit-for-layout-test')
    expect(view.container.textContent).not.toContain('dirty')
    const localized = render(<KitoBrandName t={key => en[key]} />)
    expect(localized.container.textContent).toBe('Kito HarnessLocal0.2.1-rc.2')
  })

  it('shows only the product name in a packaged kito build', () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'kito')
    vi.stubEnv('DSH_CLIENT_VERSION', '0.2.1-rc.2')
    const view = render(<KitoBrandName />)
    expect(view.container.textContent).toBe('Kito Harness')
  })

  it('labels signed-in, signed-out and loading accounts without inventing a balance', () => {
    expect(kitoAccountLabel({ signedIn: true, displayName: 'Ada', balance: 2 })).toBe('Ada · $2')
    expect(kitoAccountLabel({ signedIn: true, displayName: 'Ada', balance: 2.5 })).toBe('Ada · $2.50')
    expect(kitoAccountLabel({ signedIn: true, displayName: '  A customer with a long name  ' })).toBe('A customer with a long name')
    expect(kitoAccountLabel({ signedIn: true, displayName: '   ' })).toBe('Kito')
    expect(kitoAccountLabel({ signedIn: false, balance: 499.95 })).toBe(zh.signIn)
    expect(kitoAccountLabel({ signedIn: false })).toBe(zh.signIn)
    expect(kitoAccountLabel(undefined)).toBe(zh.loading)
  })

  it('keeps the sidebar compact and account details in Settings', () => {
    clipboard.writeClipboard.mockClear()
    const account: KitoAccountView = {
      signedIn: true, displayName: 'Ada', accountNo: 'KT-DEMO-001', telegramUsername: 'ada_t', balance: 2,
    }
    const globals = accountGlobals(accountResource(account))
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const footer = render(<KitoAccountFooter {...globals} wide t={key => zh[key]} />)
    expect(footer.getByRole('button', { name: 'Ada · $2' })).toBeTruthy()
    expect(footer.queryByText('KT-DEMO-001')).toBeNull()
    expect(footer.queryByRole('button', { name: '充值记录' })).toBeNull()
    fireEvent.click(footer.getByRole('button', { name: 'Ada · $2' }))
    expect(fetchMock).toHaveBeenCalledWith('dsh-app://app/kito/open?target=wallet', { method: 'POST' })
    cleanup()
    const view = render(<KitoAccountSection {...globals} close={() => {}} t={key => zh[key]} />)
    expect(view.getByText('KT-DEMO-001')).toBeTruthy()
    expect(view.getByText('@ada_t')).toBeTruthy()
    expect(view.getByText('余额 (USD) $2')).toBeTruthy()
    for (const [name, target] of [['消费记录', 'usage'], ['充值记录', 'topups'], ['Token', 'keys']] as const) {
      fireEvent.click(view.getByRole('button', { name }))
      expect(fetchMock).toHaveBeenCalledWith(`dsh-app://app/kito/open?target=${target}`, { method: 'POST' })
    }
    expect(view.queryByRole('button', { name: 'English' })).toBeNull()
    view.getAllByRole('button', { name: '复制' })[1]?.click()
    expect(clipboard.writeClipboard).toHaveBeenCalledWith('KT-DEMO-001')
  })

  it('shows only Telegram sign-in when a signed-out payload still carries legacy balance data', () => {
    const globals = accountGlobals(accountResource({ signedIn: false, balance: 499.95 }))
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<KitoAccountFooter {...globals} wide t={key => zh[key]} />)
    expect(view.getByRole('button', { name: zh.signIn })).toBeTruthy()
    expect(view.queryByText(/余额/)).toBeNull()
    expect(view.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(view.getByRole('button', { name: zh.signIn }))
    expect(fetchMock).toHaveBeenCalledWith('dsh-app://app/kito/sign-in', { method: 'POST' })
  })

  it('hides the account row when macOS collapses the whole sidebar', () => {
    const previous = document.documentElement.dataset.platform
    document.documentElement.dataset.platform = 'darwin'
    onTestFinished(() => {
      if (previous === undefined) delete document.documentElement.dataset.platform
      else document.documentElement.dataset.platform = previous
    })
    const view = render(<KitoAccountFooter
      {...accountGlobals(accountResource({ signedIn: true, displayName: 'Ada' }))}
      wide={false} t={key => zh[key]} />)
    expect(view.container.querySelector('button')).toBeNull()
    expect(view.container.textContent).toBe('')
  })

  it('keeps one Telegram sign-in and no spendable balance without a login or model key', () => {
    const globals = accountGlobals(accountResource({ signedIn: false, balance: 3 }))
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<KitoAccountFooter {...globals} wide t={key => zh[key]} />)
    expect(view.queryByText(/余额/)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: zh.signIn }))
    expect(fetchMock).toHaveBeenCalledWith('dsh-app://app/kito/sign-in', { method: 'POST' })
  })

  it('withholds login while loading, retains stale data and retries failed reads', () => {
    const refreshed = vi.fn()
    window.addEventListener(KITO_ACCOUNT_REFRESH, refreshed)
    onTestFinished(() => { window.removeEventListener(KITO_ACCOUNT_REFRESH, refreshed) })
    const loading = render(<KitoAccountFooter {...accountGlobals(accountResource(undefined))} wide t={key => zh[key]} />)
    expect(loading.getByRole('button', { name: zh.loading }).hasAttribute('disabled')).toBe(true)
    expect(loading.queryByRole('button', { name: zh.signIn })).toBeNull()
    cleanup()
    const failed = render(<KitoAccountFooter {...accountGlobals(accountResource(undefined, true))} wide t={key => zh[key]} />)
    fireEvent.click(failed.getByRole('button', { name: zh.retry }))
    expect(refreshed).toHaveBeenCalledOnce()
    cleanup()
    const loadingSection = render(<KitoAccountSection
      {...accountGlobals(accountResource(undefined))} close={() => {}} t={key => zh[key]} />)
    expect(loadingSection.getByText(zh.loading)).toBeTruthy()
    cleanup()
    const stale = render(<KitoAccountFooter {...accountGlobals(accountResource({ signedIn: true, displayName: 'Ada', balance: 2 }, true))} wide t={key => zh[key]} />)
    expect(stale.getByRole('button', { name: 'Ada · $2' })).toBeTruthy()
    expect(stale.queryByRole('button', { name: zh.signIn })).toBeNull()
    cleanup()
    const section = render(<KitoAccountSection {...accountGlobals(accountResource(undefined, true))} close={() => {}} t={key => zh[key]} />)
    fireEvent.click(section.getByRole('button', { name: zh.retry }))
    expect(refreshed).toHaveBeenCalledTimes(2)
  })

  it('shows only Telegram sign-in in Settings when legacy signed-out balance data arrives', () => {
    const view = render(<KitoAccountSection
      {...accountGlobals(accountResource({ signedIn: false, balance: 1.5 }))}
      close={() => {}} t={key => zh[key]} />)
    expect(view.queryByText(/余额/)).toBeNull()
    expect(view.getByRole('heading', { name: zh.signedOut })).toBeTruthy()
    expect(view.getByRole('button', { name: zh.signIn })).toBeTruthy()
    expect(view.getAllByRole('button')).toHaveLength(1)
  })

  it('refreshes the shared account after signing out', async () => {
    const refreshed = vi.fn()
    window.addEventListener(KITO_ACCOUNT_REFRESH, refreshed)
    onTestFinished(() => { window.removeEventListener(KITO_ACCOUNT_REFRESH, refreshed) })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<KitoAccountSection
      {...accountGlobals(accountResource({ signedIn: true, displayName: 'Ada', balance: 2 }))}
      close={() => {}} t={key => zh[key]} />)
    expect(view.getByRole('heading', { name: 'Ada' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: zh.signOut }))
    expect(fetchMock).toHaveBeenCalledWith('dsh-app://app/kito/sign-out', { method: 'POST' })
    await waitFor(() => { expect(refreshed).toHaveBeenCalledOnce() })
  })

  it.each([503, 'network'])('refreshes after navigation failure: %s', async (failure) => {
    const refreshed = vi.fn()
    window.addEventListener(KITO_ACCOUNT_REFRESH, refreshed)
    onTestFinished(() => { window.removeEventListener(KITO_ACCOUNT_REFRESH, refreshed) })
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (failure === 503) return new Response(null, { status: 503 })
      throw new Error('offline')
    }))
    const account: KitoAccountView = { signedIn: true, displayName: 'Ada' }
    const view = render(<KitoAccountFooter {...accountGlobals(accountResource(account))} wide t={key => zh[key]} />)
    fireEvent.click(view.getByRole('button', { name: 'Ada' }))
    await waitFor(() => { expect(refreshed).toHaveBeenCalledOnce() })
  })

  it('refreshes after a sign-out transport failure', async () => {
    const refreshed = vi.fn()
    window.addEventListener(KITO_ACCOUNT_REFRESH, refreshed)
    onTestFinished(() => { window.removeEventListener(KITO_ACCOUNT_REFRESH, refreshed) })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const view = render(<KitoAccountSection
      {...accountGlobals(accountResource({ signedIn: true, displayName: 'Ada' }))}
      close={() => {}} t={key => zh[key]} />)
    fireEvent.click(view.getByRole('button', { name: zh.signOut }))
    await waitFor(() => { expect(refreshed).toHaveBeenCalledOnce() })
  })

  it('translates the shell into every language on the picker', () => {
    const ctx = new Context()
    const locale = new LocaleRuntime(ctx)
    const registered = Object.keys(LANGUAGE_PACKS).sort()
    expect(registered).toEqual(KITO_EXTRA_LANGUAGES.map(language => language.id).sort())
    const hindi = LANGUAGE_PACKS.hi
    for (const id of registered) {
      expect(Object.keys(LANGUAGE_PACKS[id]!).sort()).toEqual(Object.keys(hindi!).sort())
      for (const [namespace, dict] of Object.entries(LANGUAGE_PACKS[id]!)) {
        expect(Object.keys(dict).sort()).toEqual(Object.keys(hindi![namespace]!).sort())
        for (const [key, value] of Object.entries(dict)) {
          const source = hindi![namespace]![key]!
          const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
          expect(placeholders(value)).toEqual(placeholders(source))
          expect(value.trim().length).toBeGreaterThan(0)
        }
      }
      locale.addLanguage({ id, label: id, fallback: 'en' })
      for (const [namespace, dict] of Object.entries(LANGUAGE_PACKS[id]!)) {
        locale.register(namespace, id, dict)
      }
    }
    expect(LANGUAGE_PACKS.th!.model!['menu.model']).toBe('โมเดล')
    expect(LANGUAGE_PACKS.km!.settings!.openDocument).toBe('បើកឯកសារកំណត់')
    expect(LANGUAGE_PACKS.km!.chat!['settings.collapse.title']).toBe('ពេលបង្រួមព័ត៌មានការងារ')
    expect(LANGUAGE_PACKS.km!.settings!['general.currentVersion']).toContain('{version}')
    expect(LANGUAGE_PACKS.km!['permission.access']!['preset.workspaceWrite']).toBe('សរសេរក្នុងកន្លែងធ្វើការ')
    for (const key of Object.keys(zh)) {
      expect(LANGUAGE_PACKS.ar!['kito.account']![key]).toBeTruthy()
    }
    locale.setLocale('hi')
    expect(locale.bind('model')('empty.models')).toBe('कोई मॉडल उपलब्ध नहीं')
    expect(locale.bind('conversation')('hero.headline')).toBe('अनदेखी जगह की खोज')
    locale.setLocale('my')
    expect(locale.bind('model')('trigger.aria', { model: 'kito' })).toContain('kito')
    expect(locale.bind('model')('trigger.aria', { model: 'kito' })).not.toContain('{model}')
    expect(locale.bind('chat')('message.stepProcess.joinTwo', { first: 'က', second: 'ခ' })).toBe('က နှင့် ခ')
  })

  it('opens Hindi and Burmese from the flag button', () => {
    const setLocale = vi.fn()
    const view = render(
      <KitoLanguageDock
        setLocale={setLocale}
        readLocale={() => 'zh'}
        subscribeLocale={() => () => undefined}
        t={key => en[key]}
      />,
    )
    expect(view.queryByRole('menu')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '中文' }))
    expect(view.getByText('Common')).toBeTruthy()
    fireEvent.click(view.getByRole('menuitem', { name: /हिन्दी/ }))
    expect(setLocale).toHaveBeenCalledWith('hi')
    fireEvent.click(view.getByRole('button', { name: '中文' }))
    expect(view.getByRole('menuitem', { name: /မြန်မာ/ })).toBeTruthy()
  })

  it('adds the settings account page', async () => {
    vi.stubGlobal('dshDesktop', {})
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = slots.entries('settings.section').find(entry => entry.options.id === 'kito-account')
    expect(section?.options.order).toBe(-20)
    const label = section?.options.label
    expect(typeof label === 'function' ? label() : label).toBe('账号')
  })

  it('uses the desktop application icon at the requested size', () => {
    const source = readFileSync(join(process.cwd(), 'packages/client/ui-brand-kito/src/client/Brand.tsx'), 'utf8')
    expect(source).toContain("from './assets/icon.png'")
    const view = render(<KitoBrandMark size={24} />)
    const image = view.container.querySelector('img')
    expect(image?.getAttribute('width')).toBe('24')
    expect(image?.getAttribute('alt')).toBe('Kito Harness')
    const localized = render(<KitoBrandMark size={24} t={key => en[key]} />)
    expect(localized.container.querySelector('img')?.getAttribute('alt')).toBe('Kito Harness')
  })
})

describe('Kito account and language presentation', () => {
  it('uses the Kito fallback and does not refresh after a rejected sign-out', async () => {
    const refreshed = vi.fn()
    window.addEventListener(KITO_ACCOUNT_REFRESH, refreshed)
    onTestFinished(() => { window.removeEventListener(KITO_ACCOUNT_REFRESH, refreshed) })
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<KitoAccountSection {...accountGlobals(accountResource({ signedIn: true }))} close={() => {}} />)
    expect(view.getByRole('heading', { name: 'Kito' })).toBeTruthy()
    expect(view.queryAllByRole('button', { name: '复制' })).toHaveLength(0)
    expect(view.queryByText(/余额/)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: zh.signOut }))
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledWith('dsh-app://app/kito/sign-out', { method: 'POST' }) })
    expect(refreshed).not.toHaveBeenCalled()
  })

  it('keeps a failed signed-out account visible with a warning', () => {
    const view = render(<KitoAccountFooter
      {...accountGlobals(accountResource({ signedIn: false, balance: 2 }, true))}
      wide t={key => zh[key]} />)
    expect(view.getByRole('button', { name: zh.signIn })).toBeTruthy()
    expect(view.queryByText(/余额/)).toBeNull()
    expect(view.getAllByRole('button')).toHaveLength(1)
  })

  it('uses Telegram sign-in from Settings', () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const signedOut = render(<KitoAccountSection
      {...accountGlobals(accountResource({ signedIn: false }))} close={() => {}} t={key => zh[key]} />)
    fireEvent.click(signedOut.getByRole('button', { name: zh.signIn }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('dsh-app://app/kito/sign-in', { method: 'POST' })
  })

  it('clears copy feedback after success and ignores rejected clipboard writes', async () => {
    vi.useFakeTimers()
    onTestFinished(() => { vi.useRealTimers() })
    clipboard.writeClipboard.mockReset()
    clipboard.writeClipboard.mockImplementation(async () => true)
    const view = render(<KitoAccountSection
      {...accountGlobals(accountResource({ signedIn: true, displayName: 'Ada', accountNo: 'KT-DEMO-001', telegramUsername: 'ada_t' }))}
      close={() => {}} t={key => zh[key]} />)
    fireEvent.click(view.getAllByRole('button', { name: '复制' })[0]!)
    await vi.advanceTimersByTimeAsync(0)
    expect(view.getByRole('button', { name: '已复制' })).toBeTruthy()
    await vi.advanceTimersByTimeAsync(1200)
    expect(view.getAllByRole('button', { name: '复制' }).length).toBeGreaterThan(0)
    clipboard.writeClipboard.mockImplementation(async () => false)
    fireEvent.click(view.getAllByRole('button', { name: '复制' })[1]!)
    await vi.advanceTimersByTimeAsync(0)
    expect(view.queryByRole('button', { name: '已复制' })).toBeNull()
  })

  it('drops pending clipboard completion after unmount', async () => {
    vi.useFakeTimers()
    onTestFinished(() => { vi.useRealTimers() })
    let finish: ((ok: boolean) => void) | undefined
    clipboard.writeClipboard.mockReset()
    clipboard.writeClipboard.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve }))
    const view = render(<KitoAccountSection
      {...accountGlobals(accountResource({ signedIn: true, displayName: 'Ada', accountNo: 'KT-DEMO-001', telegramUsername: 'ada_t' }))}
      close={() => {}} t={key => zh[key]} />)
    fireEvent.click(view.getAllByRole('button', { name: '复制' })[0]!)
    view.unmount()
    finish?.(true)
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses the locale fallback and does not invent a signed-out balance', () => {
    expect(kitoAccountLabel({ signedIn: false, balance: 2 })).toBe(zh.signIn)
    const view = render(<KitoAccountFooter
      {...accountGlobals(accountResource({ signedIn: false, balance: 2 }))} wide />)
    expect(view.getByText(zh.signIn)).toBeTruthy()
    expect(view.queryByText(/\$/)).toBeNull()
  })

  it('wires slot injectors and the configured account refresh interval', async () => {
    vi.stubGlobal('dshDesktop', {})
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply: (ctx) => { apply(ctx, { accountRefreshIntervalMs: 1000 }) } })
    await fiber.await()
    onTestFinished(() => fiber.dispose())
    const setLocale = vi.spyOn(subject.ctx.locale, 'setLocale')
    for (const [name, id] of [
      ['sidebar.footer.action', 'kito-account'],
      ['settings.section', 'kito-account'],
      ['conversation.session.header.utilities', 'kito-language'],
      ['conversation.hero.options', 'kito-language'],
      ['conversation.header.trailing', 'kito-language'],
    ] as const) {
      const entry = subject.slots.entries(name).find(candidate => candidate.options.id === id)
      const controls = entry?.inject?.() as KitoLanguageDockProps | undefined
      expect(controls).toBeDefined()
      if (name === 'conversation.session.header.utilities') expect(entry?.options.order).toBe(-20)
      expect(controls?.hideWhenSession ?? false).toBe(name === 'conversation.header.trailing')
      controls?.setLocale?.('hi')
      expect(setLocale).toHaveBeenCalledWith('hi')
      expect(controls?.readLocale?.()).toBe('zh')
      const unsubscribe = controls?.subscribeLocale?.(() => {})
      expect(unsubscribe).toBeTypeOf('function')
      unsubscribe?.()
    }
  })

  it('returns no language dock without a locale setter', () => {
    const view = render(<KitoLanguageDock />)
    expect(view.container.firstChild).toBeNull()
  })

  it('dismisses and translates the language dock while cleaning subscriptions', async () => {
    let active = 'en'
    const listeners = new Set<() => void>()
    const view = render(<KitoLanguageDock
      readLocale={() => active}
      setLocale={(id) => { active = id }}
      subscribeLocale={(listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }}
    />)
    fireEvent.click(view.getByRole('button', { name: 'English' }))
    expect(view.getByRole('menu')).toBeTruthy()
    expect(view.getByText('Common')).toBeTruthy()
    fireEvent.pointerDown(view.getByRole('button', { name: 'English' }))
    expect(view.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(view.queryByRole('menu')).toBeNull()
    active = 'hi'
    for (const listener of listeners) listener()
    expect(await view.findByRole('button', { name: 'हिन्दी' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'हिन्दी' }))
    fireEvent.click(view.getByRole('menuitem', { name: /हिन्दी/ }))
    expect(view.queryByRole('menu')).toBeNull()
    view.unmount()
    expect(listeners).toHaveLength(0)
  })

  it('falls back to the first language for an unknown locale', () => {
    const view = render(<KitoLanguageDock
      readLocale={() => 'unknown'} setLocale={() => {}} subscribeLocale={() => () => undefined}
    />)
    expect(view.getByRole('button', { name: '中文' })).toBeTruthy()
  })

  it('keeps the dock usable without a locale reader', () => {
    const view = render(<KitoLanguageDock setLocale={() => {}} subscribeLocale={() => () => undefined} />)
    expect(view.getByRole('button', { name: '中文' })).toBeTruthy()
  })

  it('shows the global trailing entry only without a Session', () => {
    const view = render(<KitoLanguageDock
      hideWhenSession setLocale={() => {}} subscribeLocale={() => () => undefined}
    />)
    expect(view.getByRole('button', { name: '中文' })).toBeTruthy()
    const active = render(<KitoLanguageDock
      hideWhenSession sessionId={'session-1' as KitoLanguageDockProps['sessionId']}
      setLocale={() => {}} subscribeLocale={() => () => undefined}
    />)
    expect(active.container.firstChild).toBeNull()
  })
})

describe('Kito account resource', () => {
  it('validates optional account facts independently', () => {
    expect(parseKitoAccount({
      signedIn: false, displayName: '', accountNo: 'KT-DEMO-001', telegramUsername: 'ada_t', balance: 0,
    })).toEqual({
      signedIn: false, displayName: '', accountNo: 'KT-DEMO-001', telegramUsername: 'ada_t', balance: 0,
    })
    for (const payload of [null, {}, { signedIn: 'true' },
      { signedIn: true, displayName: 3 }, { signedIn: true, accountNo: null },
      { signedIn: true, telegramUsername: false }, { signedIn: true, balance: '2' }, { signedIn: true, balance: Number.NaN }]) {
      expect(() => parseKitoAccount(payload)).toThrow('Invalid Kito account response.')
    }
  })

  it('rejects an unknown address without reading the Desktop route', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const iterator = kitoAccountResource(1000).open('dsh-resource://kitoaccount/other', { signal: new AbortController().signal })[Symbol.asyncIterator]()
    expect(await iterator.next()).toMatchObject({ done: false, value: { ok: false, error: { code: 'kito-account/invalid-address' } } })
    expect((await iterator.next()).done).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not start reading an already aborted resource', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const stream = kitoAccountResource(1000).open(KITO_ACCOUNT_RESOURCE, { signal: controller.signal })
    expect((await stream[Symbol.asyncIterator]().next()).done).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops when a successful read is aborted before publication', async () => {
    const controller = new AbortController()
    const body = Promise.withResolvers<unknown>()
    const json = vi.fn(() => body.promise)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json })))
    const stream = kitoAccountResource(1000).open(KITO_ACCOUNT_RESOURCE, { signal: controller.signal })
    const pending = stream[Symbol.asyncIterator]().next()
    onTestFinished(() => { controller.abort(); body.resolve({ signedIn: false }) })
    await vi.waitFor(() => { expect(json).toHaveBeenCalled() })
    controller.abort()
    body.resolve({ signedIn: false })
    expect((await pending).done).toBe(true)
  })

  it('stops after a published account when the resource is aborted', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ signedIn: false }))))
    const stream = kitoAccountResource(1000).open(KITO_ACCOUNT_RESOURCE, { signal: controller.signal })
    const iterator = stream[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toMatchObject({ ok: true, value: { signedIn: false } })
    controller.abort()
    expect((await iterator.next()).done).toBe(true)
  })

  it('refreshes immediately when a refresh arrives during a read', async () => {
    const controller = new AbortController()
    const first = Promise.withResolvers<Response>()
    let reads = 0
    const fetchMock = vi.fn(() => {
      reads += 1
      return reads === 1 ? first.promise : Promise.resolve(new Response(JSON.stringify({ signedIn: false })))
    })
    vi.stubGlobal('fetch', fetchMock)
    const stream = kitoAccountResource(60000).open(KITO_ACCOUNT_RESOURCE, { signal: controller.signal })
    const iterator = stream[Symbol.asyncIterator]()
    const firstFrame = iterator.next()
    window.dispatchEvent(new Event(KITO_ACCOUNT_REFRESH))
    first.resolve(new Response(JSON.stringify({ signedIn: false })))
    expect((await firstFrame).value).toMatchObject({ ok: true, value: { signedIn: false } })
    expect((await iterator.next()).value).toMatchObject({ ok: true, value: { signedIn: false } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    controller.abort()
    expect((await iterator.next()).done).toBe(true)
  })

  it('fires the configured refresh timer', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    onTestFinished(() => { controller.abort(); vi.useRealTimers() })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ signedIn: false })))
    vi.stubGlobal('fetch', fetchMock)
    const stream = kitoAccountResource(1000).open(KITO_ACCOUNT_RESOURCE, { signal: controller.signal })
    const iterator = stream[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toMatchObject({ ok: true, value: { signedIn: false } })
    const pending = iterator.next()
    await vi.advanceTimersByTimeAsync(1000)
    expect((await pending).value).toMatchObject({ ok: true, value: { signedIn: false } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    controller.abort()
    expect((await iterator.next()).done).toBe(true)
  })

  it('shares refresh, keeps the last good account on failure and aborts after the last release', async () => {
    vi.stubGlobal('dshDesktop', {})
    const account: KitoAccountView = { signedIn: true, displayName: 'Ada', balance: 2 }
    let available = true
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal)
      return available ? new Response(JSON.stringify(account)) : new Response(null, { status: 503 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const source = subject.ctx.resources.source(KITO_ACCOUNT_RESOURCE)
    const stop = source.subscribe(() => {})
    onTestFinished(async () => { stop(); await fiber.dispose() })
    await waitFor(() => { expect(source.getSnapshot().value).toEqual(account) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    available = false
    window.dispatchEvent(new Event(KITO_ACCOUNT_REFRESH))
    await waitFor(() => { expect(source.getSnapshot().status).toBe('failed') })
    expect(source.getSnapshot().value).toEqual(account)
    available = true
    window.dispatchEvent(new Event(KITO_ACCOUNT_REFRESH))
    await waitFor(() => { expect(source.getSnapshot().status).toBe('live') })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    stop()
    expect(signals.at(-1)?.aborted).toBe(true)
    await fiber.dispose()
    expect(source.getSnapshot().status).toBe('none')
  })

  it('cancels an in-flight read and removes window listeners', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const controller = new AbortController()
    let readSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      readSignal = init?.signal ?? undefined
      readSignal?.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    })))
    const stream = kitoAccountResource(1000).open(KITO_ACCOUNT_RESOURCE, { signal: controller.signal })
    const pending = stream[Symbol.asyncIterator]().next()
    onTestFinished(() => { controller.abort(); add.mockRestore(); remove.mockRestore() })
    expect(readSignal).toBeDefined()
    controller.abort()
    expect((await pending).done).toBe(true)
    expect(readSignal?.aborted).toBe(true)
    expect(remove).toHaveBeenCalledWith('focus', expect.any(Function))
    expect(remove).toHaveBeenCalledWith(KITO_ACCOUNT_REFRESH, expect.any(Function))
    const calls = (spy: typeof add) => spy.mock.calls.filter(([name]) => name === 'focus' || name === KITO_ACCOUNT_REFRESH).length
    expect(calls(remove)).toBe(calls(add))
  })

  it('clears repeated refresh wakeups and closes the pending timer', async () => {
    vi.useFakeTimers()
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const controller = new AbortController()
    onTestFinished(() => { controller.abort(); vi.useRealTimers(); add.mockRestore(); remove.mockRestore() })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ signedIn: false }))))
    const stream = kitoAccountResource(60000).open(KITO_ACCOUNT_RESOURCE, { signal: controller.signal })
    const iterator = stream[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toMatchObject({ ok: true, value: { signedIn: false } })
    const pending = iterator.next()
    expect(vi.getTimerCount()).toBe(1)
    window.dispatchEvent(new Event(KITO_ACCOUNT_REFRESH))
    window.dispatchEvent(new Event(KITO_ACCOUNT_REFRESH))
    expect((await pending).value).toMatchObject({ ok: true, value: { signedIn: false } })
    const after = iterator.next()
    controller.abort()
    expect((await after).done).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(remove).toHaveBeenCalledWith('focus', expect.any(Function))
    expect(remove).toHaveBeenCalledWith(KITO_ACCOUNT_REFRESH, expect.any(Function))
  })
})
