import assert from 'node:assert/strict'
import test from 'node:test'

import { passwordLogin, pollDeviceLogin, startDeviceLogin } from '../src/identity.js'

const account = {
  data: {
    token: 'identity-token',
    account: { id: 'acc-1', accountNo: '10001', displayName: 'Ada' },
    session: { id: 'sess-1', tokenType: 'Bearer', expiresAt: '2099-01-01T00:00:00Z' },
  },
}

test('password login posts credentials and unwraps data', async () => {
  /** @type {RequestInit | undefined} */
  let init
  const session = await passwordLogin({
    loginName: ' ada ',
    password: 'secret',
    baseUrl: 'https://identity.test',
  }, async (url, options) => {
    init = options
    assert.equal(url, 'https://identity.test/identity/v1/auth/login')
    return new Response(JSON.stringify(account), { status: 200 })
  })
  assert.equal(JSON.parse(String(init?.body)).loginName, 'ada')
  assert.equal(session.account.id, 'acc-1')
  assert.equal(session.token, 'identity-token')
})

test('password login surfaces the server message', async () => {
  await assert.rejects(
    passwordLogin({ loginName: 'ada', password: 'no', baseUrl: 'https://identity.test' }, async () => new Response(
      JSON.stringify({ message: 'bad credentials' }),
      { status: 401 },
    )),
    /bad credentials/,
  )
})

test('device login uses the registered Kito client and exchanges after approval', async () => {
  /** @type {string[]} */
  const urls = []
  const session = await pollDeviceLogin({
    sessionId: 'sess',
    opaqueCode: 'opaque',
    baseUrl: 'https://identity.test',
    timeoutMs: 5_000,
    intervalMs: 1,
  }, async (url, options) => {
    urls.push(String(url))
    if (String(url).endsWith('/token')) {
      assert.equal(JSON.parse(String(options?.body)).client_id, 'kito-desktop')
      return new Response(JSON.stringify({
        access_token: 'access',
        subject: 'acc-1',
        username: '10001',
        refresh_token: 'refresh',
      }), { status: 200 })
    }
    return new Response(JSON.stringify({ status: 'approved' }), { status: 200 })
  })
  assert.equal(session.token, 'access')
  assert.equal(session.device?.refreshToken, 'refresh')
  assert.equal(urls[0], 'https://identity.test/identity/v1/device/sessions/sess')
})

test('device start sends kito_desktop', async () => {
  /** @type {RequestInit | undefined} */
  let init
  const challenge = await startDeviceLogin({ baseUrl: 'https://identity.test', deviceLabel: 'desk' }, async (_url, options) => {
    init = options
    return new Response(JSON.stringify({
      session_id: 'sess',
      user_code: 'ABCD',
      opaque_code: 'opaque',
      login_url: 'https://login.test/go',
      expires_at: '2099-01-01T00:00:00Z',
      interval: 2,
    }), { status: 200 })
  })
  assert.equal(JSON.parse(String(init?.body)).client_type, 'kito_desktop')
  assert.equal(challenge.userCode, 'ABCD')
  assert.equal(challenge.interval, 2)
})
