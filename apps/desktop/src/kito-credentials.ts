/** Read one stored credential without sending it over the Host RPC. The credentials remote refuses to return secret values. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FAILSAFE_SCHEMA, load } from 'js-yaml'
import { resolveKitoHarnessHome } from './kito-home.ts'

/**
 * Read one reference from `$DSH_HOME/.credentials.yaml`.
 * Failsafe YAML keeps every scalar as text, so a numeric-looking token is not coerced.
 * @param ref - credential reference name.
 * @param home - harness home. Defaults to `DSH_HOME` or `~/.kito-harness`.
 * @returns the stored value, or undefined when the file or reference is absent.
 */
export async function readStoredCredential(ref: string, home = resolveKitoHarnessHome()): Promise<string | undefined> {
  const filename = join(home, '.credentials.yaml')
  let text: string
  try {
    text = await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let document: unknown
  try {
    document = load(text, { schema: FAILSAFE_SCHEMA })
  } catch {
    // Parser text quotes the offending line, and that line is the secret.
    console.error('kito credentials document could not be read')
    return undefined
  }
  if (!isRecord(document)) return undefined
  const refs = isRecord(document.refs) ? document.refs : document.version === undefined ? document : undefined
  if (!isRecord(refs)) return undefined
  const value = refs[ref]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
