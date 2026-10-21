/**
 * One-click link from KT Desktop. Independent Telegram sign-in stays on the welcome window.
 * The URL only carries a loopback port and a nonce. Tokens stay on each side.
 */

import {
  ensureKitoApiKey,
  finishKitoDeviceLogin,
  startKitoDeviceLogin,
} from './kito-identity.ts'

export interface DesktopLoginSource {
  readonly accountId: string
  readonly displayName: string
  readonly allowSwitch: boolean
}

export interface DesktopLoginDeps {
  fetchImpl?: typeof fetch
  currentAccountId: () => Promise<string | undefined>
  saveIdentity: (token: string) => Promise<{ ok: boolean }>
  saveKey: (key: string) => Promise<{ ok: boolean }>
  onSuccess: () => void
}

function callbackUrl(port: string, request: string, suffix = ''): string {
  return `http://127.0.0.1:${port}/kito/${request}${suffix}`
}

/** @returns the loopback target, or undefined when the URL is not a desktop login. */
export function parseKitoDesktopLogin(raw: string): { port: string; request: string } | undefined {
  let url: URL
  try { url = new URL(raw) } catch { return undefined }
  if (url.protocol !== 'kito-harness:' || url.hostname !== 'desktop-login') return undefined
  const port = url.searchParams.get('port') ?? ''
  const request = url.searchParams.get('request') ?? ''
  if (!/^\d{1,5}$/.test(port) || Number(port) === 0 || Number(port) > 65535) return undefined
  if (!/^[a-f0-9]{64}$/.test(request)) return undefined
  return { port, request }
}

async function post(fetchImpl: typeof fetch, url: string, body: unknown): Promise<Response> {
  return fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
  })
}

/**
 * Finish a KT Desktop handoff.
 * Same account reuses the saved session. A different account waits for an explicit switch.
 * @returns how the handoff ended.
 */
export async function runKitoDesktopLink(raw: string, deps: DesktopLoginDeps): Promise<'signed_in' | 'reused' | 'account_conflict'> {
  const target = parseKitoDesktopLogin(raw)
  if (!target) throw new Error('kito desktop login url rejected')
  const fetchImpl = deps.fetchImpl ?? fetch
  try {
    return await finishDesktopLink(target, deps, fetchImpl)
  } catch (error) {
    await post(fetchImpl, callbackUrl(target.port, target.request, '/complete'), { status: 'failed' }).catch(() => undefined)
    throw error
  }
}

async function finishDesktopLink(
  target: { port: string; request: string },
  deps: DesktopLoginDeps,
  fetchImpl: typeof fetch,
): Promise<'signed_in' | 'reused' | 'account_conflict'> {
  const sourceResponse = await fetchImpl(callbackUrl(target.port, target.request), {
    headers: { accept: 'application/json' },
    redirect: 'error',
  })
  if (!sourceResponse.ok) throw new Error('kito desktop login source rejected')
  const source = await sourceResponse.json() as DesktopLoginSource
  if (!source?.accountId) throw new Error('kito desktop login source rejected')
  const current = await deps.currentAccountId()
  if (current && current !== source.accountId && !source.allowSwitch) {
    await post(fetchImpl, callbackUrl(target.port, target.request, '/complete'), {
      status: 'account_conflict',
      accountId: current,
    })
    return 'account_conflict'
  }
  if (current === source.accountId) {
    const commit = await post(fetchImpl, callbackUrl(target.port, target.request, '/commit'), {
      accountId: source.accountId,
      status: 'reused',
    })
    if (!commit.ok) throw new Error('kito desktop login commit rejected')
    const complete = await post(fetchImpl, callbackUrl(target.port, target.request, '/complete'), {
      status: 'reused',
      accountId: source.accountId,
      accountName: source.displayName,
    })
    if (!complete.ok) throw new Error('kito desktop login complete rejected')
    deps.onSuccess()
    return 'reused'
  }
  const challenge = await startKitoDeviceLogin({ fetchImpl })
  const approved = await post(fetchImpl, callbackUrl(target.port, target.request, '/approve'), {
    sessionId: challenge.sessionId,
    userCode: challenge.userCode,
  })
  if (!approved.ok) throw new Error('kito desktop login approve rejected')
  const session = await finishKitoDeviceLogin({
    fetchImpl,
    sessionId: challenge.sessionId,
    opaqueCode: challenge.opaqueCode,
  })
  if (session.accountId !== source.accountId) throw new Error('kito desktop login account mismatch')
  const key = await ensureKitoApiKey(session.token, { fetchImpl })
  const savedIdentity = await deps.saveIdentity(session.token)
  const savedKey = await deps.saveKey(key)
  if (!savedIdentity.ok || !savedKey.ok) throw new Error('kito desktop login save failed')
  const commit = await post(fetchImpl, callbackUrl(target.port, target.request, '/commit'), {
    accountId: source.accountId,
    status: 'signed_in',
  })
  if (!commit.ok) throw new Error('kito desktop login commit rejected')
  const complete = await post(fetchImpl, callbackUrl(target.port, target.request, '/complete'), {
    status: 'signed_in',
    accountId: source.accountId,
    accountName: source.displayName,
  })
  if (!complete.ok) throw new Error('kito desktop login complete rejected')
  deps.onSuccess()
  return 'signed_in'
}
