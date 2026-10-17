/** Kito Harness data directory, kept apart from an official DeepSeek install at `~/.dsh`. */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Directory name under the user home when `DSH_HOME` is unset. */
export const KITO_HARNESS_HOME_DIR = '.kito-harness'

/**
 * Resolve the desktop home.
 * An explicit `DSH_HOME` wins so tests and operators can point at a scratch directory.
 * @param env - process environment.
 * @param home - user home used for the default and `~/` prefixes.
 * @returns absolute home path.
 */
export function resolveKitoHarnessHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const configured = env.DSH_HOME?.trim()
  if (configured === undefined || configured === '') return join(home, KITO_HARNESS_HOME_DIR)
  if (configured === '~') return home
  if (configured.startsWith('~/')) return join(home, configured.slice(2))
  return resolve(configured)
}

/**
 * Publish the resolved home on `DSH_HOME` when the operator did not set one.
 * The Host child inherits the environment, so sessions stay out of `~/.dsh`.
 * @param env - process environment, mutated only when `DSH_HOME` is blank.
 * @param home - user home used for the default.
 * @returns absolute home path.
 */
export function ensureKitoHarnessHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const resolved = resolveKitoHarnessHome(env, home)
  if (env.DSH_HOME?.trim()) return resolved
  env.DSH_HOME = resolved
  return resolved
}
