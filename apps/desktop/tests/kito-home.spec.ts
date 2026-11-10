import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureKitoHarnessHome, KITO_HARNESS_HOME_DIR, resolveKitoHarnessHome } from '../src/kito-home.ts'

describe('Kito Harness home', () => {
  it('uses ~/.kito-harness when KITO_HARNESS_HOME is unset and publishes that path', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(ensureKitoHarnessHome(env, '/Users/ada')).toBe('/Users/ada/.kito-harness')
    expect(env.DSH_HOME).toBe('/Users/ada/.kito-harness')
    expect(KITO_HARNESS_HOME_DIR).toBe('.kito-harness')
    expect(resolveKitoHarnessHome({ KITO_HARNESS_HOME: '  ' }, '/Users/ada')).toBe('/Users/ada/.kito-harness')
    expect(resolveKitoHarnessHome({}, homedir())).toBe(join(homedir(), '.kito-harness'))
  })

  it('relocates the home with KITO_HARNESS_HOME, including a home-relative path', () => {
    const env: NodeJS.ProcessEnv = { KITO_HARNESS_HOME: '~/scratch' }
    expect(resolveKitoHarnessHome(env, '/Users/ada')).toBe(join('/Users/ada', 'scratch'))
    expect(ensureKitoHarnessHome(env, '/Users/ada')).toBe(join('/Users/ada', 'scratch'))
    expect(env.DSH_HOME).toBe(join('/Users/ada', 'scratch'))
    expect(resolveKitoHarnessHome({ KITO_HARNESS_HOME: '~' }, '/Users/ada')).toBe('/Users/ada')
    expect(resolveKitoHarnessHome({ KITO_HARNESS_HOME: '/tmp/explicit' })).toBe(resolve('/tmp/explicit'))
  })

  it('does not use an inherited DeepSeek Harness home and replaces it for the Host', () => {
    const env: NodeJS.ProcessEnv = { DSH_HOME: '/Users/ada/.dsh' }
    expect(resolveKitoHarnessHome(env, '/Users/ada')).toBe('/Users/ada/.kito-harness')
    expect(ensureKitoHarnessHome(env, '/Users/ada')).toBe('/Users/ada/.kito-harness')
    expect(env.DSH_HOME).toBe('/Users/ada/.kito-harness')
    const relocated: NodeJS.ProcessEnv = { DSH_HOME: '/Users/ada/.dsh', KITO_HARNESS_HOME: '/tmp/kito' }
    expect(ensureKitoHarnessHome(relocated, '/Users/ada')).toBe(resolve('/tmp/kito'))
    expect(relocated.DSH_HOME).toBe(resolve('/tmp/kito'))
  })
})
