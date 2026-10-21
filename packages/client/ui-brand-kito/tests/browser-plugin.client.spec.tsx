// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { KitoAccountFooter, KitoAccountSection, kitoAccountLabel } from '../src/client/AccountFooter.tsx'
import { KITO_EXTRA_LANGUAGES, KitoLanguageDock, languageDockRight, trailingClusterLeft } from '../src/client/LanguagePicker.tsx'
import { LANGUAGE_PACKS } from '../src/client/language-packs.ts'
import { zh } from '../src/client/copy.ts'
import { KitoBrandMark, KitoBrandName } from '../src/client/Brand.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const clipboard = vi.hoisted(() => ({ writeClipboard: vi.fn(async () => true) }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => clipboard)

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
  'shell.overlay',
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
  return { ctx, slots }
}

describe('Kito browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the slot registry and the shared language service', () => {
    expect(inject).toEqual(['slots', 'locale'])
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
    for (const hole of ['sidebar.brand.mark', 'sidebar.brand.name', 'shell.overlay'] as const) {
      expect(subject.slots.entries(hole)).toHaveLength(1)
    }
    expect(subject.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(subject.slots.entries('settings.section')).toHaveLength(0)
  })

  it('shows the product name, a local marker, and the version without the commit', () => {
    vi.stubEnv('DSH_CLIENT_VERSION', '0.2.1-rc.2')
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', 'ef44f8e')
    vi.stubEnv('DSH_CLIENT_GIT_DIRTY', 'true')
    const view = render(<KitoBrandName />)
    expect(view.container.textContent).toBe('Kito Harness本地0.2.1-rc.2')
    expect(view.container.textContent).not.toContain('ef44f8e')
    expect(view.container.textContent).not.toContain('dirty')
  })

  it('shows only the product name in a packaged kito build', () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'kito')
    vi.stubEnv('DSH_CLIENT_VERSION', '0.2.1-rc.2')
    const view = render(<KitoBrandName />)
    expect(view.container.textContent).toBe('Kito Harness')
  })

  it('labels a signed-in account with the Telegram name and shared balance', () => {
    expect(kitoAccountLabel({ signedIn: true, displayName: 'Ada', balance: 2 })).toBe('Ada · $2')
    expect(kitoAccountLabel({ signedIn: true, displayName: 'Ada', balance: 2.5 })).toBe('Ada · $2.50')
    expect(kitoAccountLabel({ signedIn: true, displayName: 'Ada' })).toBe('Ada')
    expect(kitoAccountLabel({ signedIn: false })).toBe('用 Telegram 登录')
    expect(kitoAccountLabel(undefined)).toBe('账号')
  })

  it('copies the KT account number and Telegram username under the balance', async () => {
    clipboard.writeClipboard.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      signedIn: true,
      displayName: 'Ada',
      accountNo: 'KT251018ABCD',
      telegramUsername: 'ada_t',
      balance: 2,
    }))))
    const view = render(<KitoAccountFooter wide t={key => zh[key]} />)
    expect(await view.findByText('KT251018ABCD')).toBeTruthy()
    expect(view.getByText('@ada_t')).toBeTruthy()
    expect(view.getByText('余额 (USD) $2')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '消费记录' }))
    expect(fetch).toHaveBeenCalledWith('dsh-app://app/kito/open?target=usage', { method: 'POST' })
    fireEvent.click(view.getByRole('button', { name: '充值记录' }))
    expect(fetch).toHaveBeenCalledWith('dsh-app://app/kito/open?target=topups', { method: 'POST' })
    fireEvent.click(view.getByRole('button', { name: 'Token' }))
    expect(fetch).toHaveBeenCalledWith('dsh-app://app/kito/open?target=keys', { method: 'POST' })
    expect(view.queryByRole('button', { name: 'English' })).toBeNull()
    view.getAllByRole('button', { name: '复制' })[1]?.click()
    expect(clipboard.writeClipboard).toHaveBeenCalledWith('KT251018ABCD')
  })

  it('shows the spendable balance and a Telegram sign-in when only the model key is stored', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/kito/account')
      ? new Response(JSON.stringify({ signedIn: false, keyConfigured: true, balance: 499.95 }))
      : new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<KitoAccountFooter wide t={key => zh[key]} />)
    expect(await view.findByText('余额 (USD) $499.95')).toBeTruthy()
    expect(view.getByText(zh.signInHint)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: zh.signIn }))
    expect(fetchMock).toHaveBeenCalledWith('dsh-app://app/kito/sign-in', { method: 'POST' })
    cleanup()
    const narrow = render(<KitoAccountFooter wide={false} t={key => zh[key]} />)
    await waitFor(() => {
      expect(narrow.getByRole('button', { name: 'K' }).getAttribute('title')).toBe(`${zh.signIn} · $499.95`)
    })
  })

  it('keeps one sign-in button and no balance when neither a login nor a model key is stored', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ signedIn: false, balance: 3 }))))
    const view = render(<KitoAccountFooter wide t={key => zh[key]} />)
    expect(await view.findByRole('button', { name: zh.signIn })).toBeTruthy()
    expect(view.queryByText(zh.signInHint)).toBeNull()
    expect(view.queryByText(/余额/)).toBeNull()
  })

  it('shows the model-key balance on the settings page and refreshes after signing out', async () => {
    let account: object = { signedIn: false, keyConfigured: true, balance: 1.5 }
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/kito/account')
      ? new Response(JSON.stringify(account))
      : new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const keyOnly = render(<KitoAccountSection close={() => {}} t={key => zh[key]} />)
    expect(await keyOnly.findByText('余额 (USD) $1.50')).toBeTruthy()
    expect(keyOnly.getByRole('heading', { name: zh.signedOut })).toBeTruthy()
    cleanup()
    account = { signedIn: true, displayName: 'Ada', balance: 2 }
    const view = render(<KitoAccountSection close={() => {}} t={key => zh[key]} />)
    expect(await view.findByRole('heading', { name: 'Ada' })).toBeTruthy()
    const accountReads = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/kito/account')).length
    const before = accountReads()
    account = { signedIn: false }
    fireEvent.click(view.getByRole('button', { name: zh.signOut }))
    expect(fetchMock).toHaveBeenCalledWith('dsh-app://app/kito/sign-out', { method: 'POST' })
    await waitFor(() => { expect(accountReads()).toBe(before + 1) })
    expect(await view.findByRole('heading', { name: zh.signedOut })).toBeTruthy()
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

  it('keeps the language button to the left of the session file and Finder buttons', () => {
    const header = document.createElement('div')
    header.setAttribute('data-window-drag', '')
    const title = document.createElement('div')
    title.style.flexGrow = '1'
    const finder = document.createElement('div')
    const corner = document.createElement('div')
    corner.setAttribute('data-conversation-header-corner', '')
    header.append(title, finder, corner)
    document.body.append(header)
    const box = (left: number, width: number): DOMRect => ({
      left, right: left + width, width, height: 28, top: 0, bottom: 28, x: left, y: 0, toJSON() { return {} },
    }) as DOMRect
    vi.spyOn(title, 'getBoundingClientRect').mockReturnValue(box(0, 700))
    vi.spyOn(finder, 'getBoundingClientRect').mockReturnValue(box(700, 140))
    vi.spyOn(corner, 'getBoundingClientRect').mockReturnValue(box(848, 32))
    expect(trailingClusterLeft(corner)).toBe(700)
    expect(languageDockRight(1200, 700)).toBe('508px')
    vi.spyOn(corner, 'getBoundingClientRect').mockReturnValue(box(0, 0))
    expect(trailingClusterLeft(corner)).toBe(700)
    document.body.removeChild(header)
  })

  it('opens Hindi and Burmese from the flag button without covering the header', () => {
    const setLocale = vi.fn()
    const view = render(
      <KitoLanguageDock
        setLocale={setLocale}
        readLocale={() => 'zh'}
        subscribeLocale={() => () => undefined}
      />,
    )
    expect(view.queryByRole('menu')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '中文' }))
    fireEvent.click(view.getByRole('menuitem', { name: /हिन्दी/ }))
    expect(setLocale).toHaveBeenCalledWith('hi')
    fireEvent.click(view.getByRole('button', { name: '中文' }))
    expect(view.getByRole('menuitem', { name: /မြန်မာ/ })).toBeTruthy()
  })

  it('adds the settings account page', async () => {
    vi.stubGlobal('dshDesktop', {})
    const ctx = new Context()
    provideLocale(ctx)
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: {
        'sidebar.brand.mark': { kind: 'single', scope: 'root' },
        'sidebar.brand.name': { kind: 'single', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = slots.entries('settings.section' as never).find(entry => entry.options.id === 'kito-account')
    expect(section?.options.order).toBe(-20)
    const label = section?.options.label
    expect(typeof label === 'function' ? label() : label).toBe('账号')
  })

  it('uses the desktop application icon at the requested size', () => {
    const source = readFileSync(join(process.cwd(), 'packages/client/ui-brand-kito/src/client/Brand.tsx'), 'utf8')
    expect(source).toContain('apps/desktop/resources/icon.png')
    const view = render(<KitoBrandMark size={24} />)
    const image = view.container.querySelector('img')
    expect(image?.getAttribute('width')).toBe('24')
    expect(image?.getAttribute('alt')).toBe('Kito Harness')
  })
})
