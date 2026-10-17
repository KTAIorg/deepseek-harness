import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'

import { establishKitoAccess, KITO_NEWAPI_KEY_REF } from './access.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'kito-provider'

/** Credential store and the human sign-in seam. Both ship in dsh-base. */
export const inject = ['authorization', 'credentials']

export { KITO_NEWAPI_KEY_REF } from './access.js'

/**
 * Register Kito sign-in. Password and Telegram both end in the same NewAPI key
 * the `kito` model route reads through `KITO_NEWAPI_API_KEY`.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(() => ctx.authorization.registerFlow({
    key: credentialKey('kito-provider', 'kito-newapi'),
    label: 'Kito',
    methods: [
      { id: 'telegram', label: 'Telegram' },
      { id: 'password', label: '账号密码' },
    ],
    async run(session) {
      const loginName = session.method === 'password'
        ? await session.prompt({ kind: 'text', message: 'KT 账号' })
        : undefined
      const password = session.method === 'password'
        ? await session.prompt({ kind: 'secret', message: '密码' })
        : undefined
      const access = await establishKitoAccess({
        method: session.method === 'password' ? 'password' : 'telegram',
        loginName,
        password,
        signal: session.signal,
        notify: notice => session.notify(notice),
      })
      await ctx.credentials.set(credentialRef(KITO_NEWAPI_KEY_REF), access.apiKey)
      await session.commit({ kind: 'grant', payload: access.grant })
    },
  }))
}
