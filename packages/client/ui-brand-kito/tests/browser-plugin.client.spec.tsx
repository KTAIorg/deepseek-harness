// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { kitoAccountLabel } from '../src/client/AccountFooter.tsx'
import { KitoBrandMark, KitoBrandName } from '../src/client/Brand.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
] as const

async function bench() {
  const ctx = new Context()
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

  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('leaves the slots to the official occupants in an official build', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('fills the sidebar slots for a local build and removes them on teardown', async () => {
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
    await fiber.dispose()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
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

  it('adds the settings account page', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: {
        'sidebar.brand.mark': { kind: 'single', scope: 'root' },
        'sidebar.brand.name': { kind: 'single', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = slots.entries('settings.section' as never).find(entry => entry.options.id === 'kito-account')
    expect(section?.options.order).toBe(-20)
    expect(section?.options.label?.()).toBe('账号')
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
