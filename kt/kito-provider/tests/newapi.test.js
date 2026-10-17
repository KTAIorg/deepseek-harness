import assert from 'node:assert/strict'
import test from 'node:test'

import { establishKitoAccess } from '../src/access.js'
import { ensureManagedToken } from '../src/newapi.js'

test('dedicated ensure prefixes a bare key', async () => {
  const token = await ensureManagedToken('identity-token', {
    baseUrl: 'https://api.test',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.test/api/iam/token/ensure')
      assert.equal(/** @type {HeadersInit} */ (options?.headers) && new Headers(options?.headers).get('authorization'), 'Bearer identity-token')
      return new Response(JSON.stringify({ key: 'abc', created: true }), { status: 200 })
    },
  })
  assert.equal(token.key, 'sk-abc')
})

test('a missing dedicated endpoint falls back to the session token', async () => {
  /** @type {string[]} */
  const urls = []
  const token = await ensureManagedToken('identity-token', {
    baseUrl: 'https://api.test',
    fetchImpl: async (url, options) => {
      urls.push(`${options?.method} ${url}`)
      if (String(url).endsWith('/api/iam/token/ensure')) return new Response('missing', { status: 404 })
      if (String(url).endsWith('/api/iam/ensure')) {
        return new Response(JSON.stringify({ data: { id: 7 } }), {
          status: 200,
          headers: { 'set-cookie': 'session=one; Path=/' },
        })
      }
      if (String(url).includes('/api/token/?')) {
        return new Response(JSON.stringify({ data: [{ id: 3, name: 'kito' }] }), { status: 200 })
      }
      if (String(url).endsWith('/api/token/3/key')) {
        return new Response(JSON.stringify({ key: 'sk-ready' }), { status: 200 })
      }
      return new Response('unexpected', { status: 500 })
    },
  })
  assert.equal(token.key, 'sk-ready')
  assert.ok(urls.some(item => item.startsWith('POST https://api.test/api/iam/ensure')))
})

test('password sign-in stores the relay key and keeps the bearer in the grant', async () => {
  const access = await establishKitoAccess({
    method: 'password',
    loginName: 'ada',
    password: 'secret',
    baseUrl: 'https://identity.test',
    newapiBaseUrl: 'https://api.test',
    fetchImpl: async url => {
      if (String(url).includes('/identity/')) {
        return new Response(JSON.stringify({
          token: 'identity-token',
          account: { id: 'acc-1', accountNo: '10001' },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ key: 'relay' }), { status: 200 })
    },
  })
  assert.equal(access.apiKey, 'sk-relay')
  assert.equal(access.grant.accountId, 'acc-1')
  assert.equal(access.grant.accessToken, 'identity-token')
  assert.equal('apiKey' in access.grant, false)
})
