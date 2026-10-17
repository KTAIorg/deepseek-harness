/** Kito Harness occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { KitoAccountFooter, KitoAccountSection } from './AccountFooter.tsx'
import { KitoBrandMark, KitoBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill the sidebar brand slots unless this client was built as the official
 * DeepSeek profile. The conversation hero stays on its declaring package.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE === 'official') return
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, KitoBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, KitoBrandName)
    }))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'kito-account', order: 10,
  }, KitoAccountFooter))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'kito-account', order: -20, label: () => '账号',
  }, KitoAccountSection))
}
