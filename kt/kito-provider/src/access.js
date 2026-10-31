import { passwordLogin, pollDeviceLogin, startDeviceLogin } from './identity.js'

export const KITO_IDENTITY_TOKEN_REF = 'KITO_IDENTITY_TOKEN'

/**
 * Sign in with KT Identity. The bearer is the only relay credential stored locally;
 * NewAPI resolves the managed relay token server-side on each model call.
 *
 * @param {{
 *   method: 'password' | 'telegram',
 *   loginName?: string,
 *   password?: string,
 *   baseUrl?: string,
 *   signal?: AbortSignal,
 *   notify?: (notice: { message: string, url?: string, code?: string }) => void,
 *   fetchImpl?: typeof fetch,
 * }} input
 */
export async function establishKitoAccess(input) {
  const fetchImpl = input.fetchImpl ?? fetch
  const identity = input.method === 'password'
    ? await passwordLogin({
        loginName: input.loginName ?? '',
        password: input.password ?? '',
        baseUrl: input.baseUrl,
        signal: input.signal,
      }, fetchImpl)
    : await telegramLogin(input, fetchImpl)
  return {
    identityToken: identity.token,
    grant: {
      accountId: identity.account.id,
      accountNo: identity.account.accountNo,
      accessToken: identity.token,
      ...(identity.device?.refreshToken ? { refreshToken: identity.device.refreshToken } : {}),
      ...(identity.session.expiresAt ? { expiresAt: identity.session.expiresAt } : {}),
    },
  }
}

/**
 * @param {{ baseUrl?: string, signal?: AbortSignal, notify?: (notice: { message: string, url?: string, code?: string }) => void }} input
 * @param {typeof fetch} fetchImpl
 */
async function telegramLogin(input, fetchImpl) {
  const challenge = await startDeviceLogin({ baseUrl: input.baseUrl, signal: input.signal }, fetchImpl)
  input.notify?.({
    message: '在 Telegram 确认登录',
    url: challenge.loginUrl,
    code: challenge.userCode,
  })
  return pollDeviceLogin({
    sessionId: challenge.sessionId,
    opaqueCode: challenge.opaqueCode,
    baseUrl: input.baseUrl,
    signal: input.signal,
    intervalMs: challenge.interval * 1000,
  }, fetchImpl)
}
