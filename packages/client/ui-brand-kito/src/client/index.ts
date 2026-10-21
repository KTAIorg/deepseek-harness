/** Kito Harness occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { KitoAccountFooter, KitoAccountSection } from './AccountFooter.tsx'
import { KITO_EXTRA_LANGUAGES, KitoLanguageDock } from './LanguagePicker.tsx'
import { LANGUAGE_PACKS } from './language-packs.ts'
import { KitoBrandMark, KitoBrandName } from './Brand.tsx'
import { en, zh } from './copy.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'kito.account': keyof typeof zh
  }
}

/** Required services: the UI slot registry and the shared language preference. */
export const inject = ['slots', 'locale']

const ACCOUNT_NS = 'kito.account' as const

function localeControls(ctx: ClientContext) {
  return {
    setLocale: (id: string) => { ctx.locale.setLocale(id) },
    readLocale: () => ctx.locale.getSnapshot().active,
    subscribeLocale: (listener: () => void) => ctx.locale.subscribe(listener),
  }
}

/**
 * Whether this page runs inside the Kito Harness desktop shell, whose preload publishes `dshDesktop`.
 * The account entries read the shell's `dsh-app://app/kito/*` routes. A Web deployment has no such
 * routes; its gateway authenticates the person before the page loads.
 * @returns true inside the desktop shell.
 */
export function insideDesktopShell(): boolean {
  return 'dshDesktop' in globalThis
}

/**
 * Fill the sidebar brand slots unless this client was built as the official
 * DeepSeek profile. The conversation hero stays on its declaring package.
 * The Telegram account footer and settings page are registered only inside the desktop shell.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE === 'official') return
  ctx.effect(() => ctx.locale.register(ACCOUNT_NS, { zh, en }), 'ui-brand-kito: account copy')
  ctx.effect(() => {
    const remove = KITO_EXTRA_LANGUAGES.map(language => ctx.locale.addLanguage(language))
    return () => { for (const dispose of remove) dispose() }
  }, 'ui-brand-kito: customer languages')
  ctx.effect(() => {
    const remove: Array<() => void> = []
    for (const [locale, namespaces] of Object.entries(LANGUAGE_PACKS)) {
      for (const [namespace, dict] of Object.entries(namespaces)) {
        remove.push(ctx.locale.register(namespace, locale, dict))
      }
    }
    return () => { for (const dispose of remove) dispose() }
  }, 'ui-brand-kito: language packs')
  const controls = localeControls(ctx)
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, KitoBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, KitoBrandName)
    }))
  if (insideDesktopShell()) {
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action', id: 'kito-account', order: 10, locale: ACCOUNT_NS,
      inject: () => controls,
    }, KitoAccountFooter))
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'kito-account', order: -20, locale: ACCOUNT_NS,
      label: () => ctx.locale.bind(ACCOUNT_NS)('account'),
      inject: () => controls,
    }, KitoAccountSection))
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'kito-language', order: 20, locale: ACCOUNT_NS,
    inject: () => controls,
  }, KitoLanguageDock))
}
