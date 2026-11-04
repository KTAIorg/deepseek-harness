/** Keeps the stored KT Identity login usable by exchanging the saved device refresh token. */
import type { KitoIdentityRefresh } from './kito-identity.ts'

export interface KitoIdentityRefresherDeps {
  /** Reads `KITO_IDENTITY_REFRESH_TOKEN`; undefined when no sign-in stored one. */
  readonly readRefreshToken: () => Promise<string | undefined>
  /** Calls KT Identity; undefined means it rejected the refresh token. */
  readonly refresh: (refreshToken: string) => Promise<KitoIdentityRefresh | undefined>
  /** Stores the renewed `KITO_IDENTITY_TOKEN`. */
  readonly saveToken: (token: string) => Promise<{ ok: boolean }>
  /** Stores a rotated `KITO_IDENTITY_REFRESH_TOKEN`. */
  readonly saveRefreshToken: (token: string) => Promise<{ ok: boolean }>
}

/**
 * Build the account route's renewal action. Concurrent callers share one request. A refresh token
 * that KT Identity rejected is not sent again until a sign-in stores a different one.
 * Network and server failures propagate so the caller keeps its current state.
 * @param deps - credential reads and writes plus the Identity call.
 * @returns a function resolving to the renewed Identity token, or undefined when none can be issued.
 */
export function createKitoIdentityRefresher(deps: KitoIdentityRefresherDeps): () => Promise<string | undefined> {
  let inflight: Promise<string | undefined> | undefined
  let rejected: string | undefined
  const run = async (): Promise<string | undefined> => {
    const refreshToken = await deps.readRefreshToken()
    if (refreshToken === undefined || refreshToken === rejected) return undefined
    const renewed = await deps.refresh(refreshToken)
    if (renewed === undefined) {
      rejected = refreshToken
      return undefined
    }
    const saved = await deps.saveToken(renewed.token)
    if (!saved.ok) console.error('kito identity refresh could not store the renewed token')
    if (renewed.refreshToken !== undefined && renewed.refreshToken !== refreshToken) {
      const rotated = await deps.saveRefreshToken(renewed.refreshToken)
      if (!rotated.ok) console.error('kito identity refresh could not store the rotated refresh token')
    }
    return renewed.token
  }
  return () => {
    inflight ??= run().finally(() => { inflight = undefined })
    return inflight
  }
}
