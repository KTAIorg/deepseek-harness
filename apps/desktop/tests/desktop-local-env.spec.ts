import { describe, expect, it } from 'vitest'
import { applyEnvFile } from '../scripts/desktop-local-env.ts'

describe('desktop local environment', () => {
  it('fills a missing DSN and leaves an exported value in place', () => {
    const environment: NodeJS.ProcessEnv = { DSH_SENTRY_DSN: 'from-shell' }
    applyEnvFile([
      '# local collection',
      'DSH_SENTRY_DSN="from-file"',
      'DSH_SENTRY_ENVIRONMENT=development',
      'NOT A LINE',
    ].join('\n'), environment)
    expect(environment.DSH_SENTRY_DSN).toBe('from-shell')
    expect(environment.DSH_SENTRY_ENVIRONMENT).toBe('development')
    expect(environment['NOT A LINE']).toBeUndefined()
  })
})
