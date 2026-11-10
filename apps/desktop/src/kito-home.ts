/** Kito Harness data directory, kept apart from a DeepSeek Harness home (`DSH_HOME`, default `~/.dsh`). */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Directory name under the user home when `KITO_HARNESS_HOME` is unset. */
export const KITO_HARNESS_HOME_DIR = '.kito-harness'

/**
 * Resolve the desktop home.
 * `KITO_HARNESS_HOME` relocates it. `DSH_HOME` is not read: it names a DeepSeek
 * Harness home, and a Kito launch that inherits it must not prepare its profile there.
 * @param env - process environment.
 * @param home - user home used for the default and `~/` prefixes.
 * @returns absolute home path.
 */
export function resolveKitoHarnessHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const configured = env.KITO_HARNESS_HOME?.trim()
  if (configured === undefined || configured === '') return join(home, KITO_HARNESS_HOME_DIR)
  if (configured === '~') return home
  if (configured.startsWith('~/')) return join(home, configured.slice(2))
  return resolve(configured)
}

/**
 * Publish the resolved home on `DSH_HOME`, replacing an inherited value.
 * The Host child and the Harness packages read `DSH_HOME`, so sessions,
 * credentials, and the desktop profile all land in the Kito home.
 * @param env - process environment; its `DSH_HOME` is overwritten.
 * @param home - user home used for the default.
 * @returns absolute home path.
 */
export function ensureKitoHarnessHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const resolved = resolveKitoHarnessHome(env, home)
  env.DSH_HOME = resolved
  return resolved
}
