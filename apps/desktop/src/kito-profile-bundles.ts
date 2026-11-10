/**
 * Bundle names that Kito Harness writes into the Desktop profile.
 * The names stay outside DeepSeek Harness's package scope; see
 * docs/development/adr/0004-kito-names-apart-from-deepseek-harness.md.
 */

import { readProfileManifest, writeProfileBundles } from '@deepseek-ai/dsh-app-boot'

/**
 * Bundle that makes the account-derived ktapi model route part of every Kito
 * desktop profile. It ships inside the application, so resolving it needs no
 * network and no user configuration.
 */
export const KITO_BUNDLE = '@kito/dsh-llm-ktapi'

/** Name under which releases through 0.2.2-rc.10 shipped {@link KITO_BUNDLE} and wrote it into the profile. */
export const RETIRED_KITO_BUNDLE = '@deepseek-ai/dsh-llm-ktapi'

/**
 * Replace the retired bundle name in an initialized profile with {@link KITO_BUNDLE}.
 *
 * Earlier releases wrote the retired name themselves, and this application no
 * longer ships a package under it, so a profile keeping it would list a bundle
 * that cannot resolve. The entry keeps its position; a profile that lists both
 * names keeps the earlier of the two entries. Every other bundle and manifest
 * field stays as written, and a profile without the retired name is not
 * rewritten.
 * @param profileDir - initialized profile directory.
 */
export function renameRetiredKitoBundle(profileDir: string): void {
  const manifest = readProfileManifest('dsh', profileDir)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (!bundles.includes(RETIRED_KITO_BUNDLE)) return
  const renamed = bundles.map(bundle => bundle === RETIRED_KITO_BUNDLE ? KITO_BUNDLE : bundle)
  const first = renamed.indexOf(KITO_BUNDLE)
  writeProfileBundles(profileDir, manifest, renamed.filter((bundle, index) => bundle !== KITO_BUNDLE || index === first))
}
