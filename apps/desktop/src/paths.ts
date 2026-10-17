/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { ensureKitoHarnessHome } from './kito-home.ts'

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path under the Kito Harness home.
 * @param dshHome - explicit home; otherwise `DSH_HOME` or `~/.kito-harness`.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(dshHome: string = ensureKitoHarnessHome()): DesktopPaths {
  return {
    profile: join(dshHome, 'profiles', 'desktop'),
    lock: join(dshHome, 'profiles', 'desktop', 'lock'),
  }
}
