import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureKitoHarnessHome, KITO_HARNESS_HOME_DIR, resolveKitoHarnessHome } from '../src/kito-home.ts'

describe('Kito Harness home', () => {
  it('uses ~/.kito-harness when DSH_HOME is unset and publishes that path', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(ensureKitoHarnessHome(env, '/Users/ada')).toBe('/Users/ada/.kito-harness')
    expect(env.DSH_HOME).toBe('/Users/ada/.kito-harness')
    expect(KITO_HARNESS_HOME_DIR).toBe('.kito-harness')
  })

  it('keeps an explicit DSH_HOME, including a home-relative path', () => {
    const env = { DSH_HOME: '~/scratch' }
    expect(resolveKitoHarnessHome(env, '/Users/ada')).toBe(join('/Users/ada', 'scratch'))
    expect(ensureKitoHarnessHome(env, '/Users/ada')).toBe(join('/Users/ada', 'scratch'))
    expect(env.DSH_HOME).toBe('~/scratch')
    expect(resolveKitoHarnessHome({ DSH_HOME: '/tmp/explicit' })).toBe(resolve('/tmp/explicit'))
    expect(resolveKitoHarnessHome({}, homedir())).toBe(join(homedir(), '.kito-harness'))
  })
})
