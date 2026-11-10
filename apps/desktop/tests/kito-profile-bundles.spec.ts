import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { KITO_BUNDLE, RETIRED_KITO_BUNDLE, renameRetiredKitoBundle } from '../src/kito-profile-bundles.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { DesktopProjectManager } from '../src/project-manager.ts'
import { runtimeFixture } from './runtime-fixture.ts'

const roots: string[] = []
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kito-profile-bundles-'))
  roots.push(root)
  return root
}
function profileWith(bundles: readonly string[], extra: Record<string, unknown> = {}): string {
  const dir = temporaryRoot()
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', ...extra, dsh: { profile: { bundles } } }))
  return dir
}
function manifestOf(dir: string): { dependencies?: Record<string, string>; dsh: { profile: { bundles: string[] } } } {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as ReturnType<typeof manifestOf>
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('retired Kito bundle name', () => {
  it('keeps the Kito bundle outside the DeepSeek Harness package scope', () => {
    expect(KITO_BUNDLE.startsWith('@deepseek-ai/')).toBe(false)
    expect(RETIRED_KITO_BUNDLE).toBe('@deepseek-ai/dsh-llm-ktapi')
  })

  it('renames the retired entry in place and leaves user bundles and other fields as written', () => {
    const dir = profileWith(['@deepseek-ai/dsh-base', RETIRED_KITO_BUNDLE, '@local/user-plugin'], { dependencies: { '@local/user-plugin': 'link:../x' } })
    renameRetiredKitoBundle(dir)
    expect(manifestOf(dir).dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', KITO_BUNDLE, '@local/user-plugin'])
    expect(manifestOf(dir).dependencies).toEqual({ '@local/user-plugin': 'link:../x' })
  })

  it('keeps one entry when the profile lists both names', () => {
    const dir = profileWith([RETIRED_KITO_BUNDLE, '@local/user-plugin', KITO_BUNDLE, RETIRED_KITO_BUNDLE])
    renameRetiredKitoBundle(dir)
    expect(manifestOf(dir).dsh.profile.bundles).toEqual([KITO_BUNDLE, '@local/user-plugin'])
  })

  it('does not rewrite a profile without the retired name', () => {
    const dir = profileWith(['@deepseek-ai/dsh-base', KITO_BUNDLE])
    const path = join(dir, 'package.json')
    const before = readFileSync(path, 'utf8')
    utimesSync(path, new Date(0), new Date(0))
    renameRetiredKitoBundle(dir)
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(statSync(path).mtimeMs).toBe(0)
  })

  it('upgrades a profile written by a release that used the retired name when the application prepares a launch', async () => {
    const root = temporaryRoot()
    const dsh = join(root, 'resources', 'dsh')
    runtimeFixture(dsh)
    const manager = new DesktopProjectManager(resolveDesktopPaths(join(root, '.kito-harness')), { dsh })
    await manager.applyRelease()
    const path = join(manager.paths.profile, 'package.json')
    const written = manifestOf(manager.paths.profile)
    expect(written.dsh.profile.bundles).toContain(KITO_BUNDLE)
    const earlier = written.dsh.profile.bundles.map(bundle => bundle === KITO_BUNDLE ? RETIRED_KITO_BUNDLE : bundle)
    writeFileSync(path, JSON.stringify({ ...written, dsh: { profile: { bundles: [...earlier, '@local/user-plugin'] } } }))

    await manager.applyRelease()

    expect(manifestOf(manager.paths.profile).dsh.profile.bundles).toEqual([...written.dsh.profile.bundles, '@local/user-plugin'])
  })
})
