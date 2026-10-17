import { describe, expect, it } from 'vitest'
import { resolveKtapiHost } from '../src/kito-http.ts'

describe('Kito HTTP', () => {
  it('leaves hosts outside ktapi.cc on the system resolver', async () => {
    await expect(resolveKtapiHost('login.ktyun.cc')).resolves.toBeUndefined()
  })
})
