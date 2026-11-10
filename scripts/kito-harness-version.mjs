/**
 * Read the release version of Kito Harness.
 *
 * Kito Harness numbers its releases apart from DeepSeek Harness. Every
 * `package.json` keeps the dsh version of the merged upstream release, and
 * `kt/kito-harness/version.json` holds the version the Kito application,
 * its installers, its update feed, and its `kito` client build publish
 * ([decision](../docs/development/adr/0005-kito-harness-version-line.md)).
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..')

/** Repository-relative file that holds the Kito Harness release version. */
export const KITO_HARNESS_VERSION_FILE = 'kt/kito-harness/version.json'

/** A release or prerelease version without build metadata, which the updater cannot order. */
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u

/**
 * Read the Kito Harness release version.
 * @param {string} [root] - Repository root; defaults to the root that contains this script.
 * @returns {string} The `version` field of `kt/kito-harness/version.json`.
 */
export function kitoHarnessVersion(root = REPOSITORY_ROOT) {
  const path = join(root, KITO_HARNESS_VERSION_FILE)
  let record
  try {
    record = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read the Kito Harness version from ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const version = typeof record === 'object' && record !== null ? record.version : undefined
  if (typeof version !== 'string' || !VERSION.test(version)) {
    throw new Error(`${path} has an invalid version ${JSON.stringify(version)}`)
  }
  return version
}
