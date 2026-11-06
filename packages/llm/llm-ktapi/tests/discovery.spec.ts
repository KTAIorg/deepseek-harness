import { describe, expect, it } from 'vitest'
import { endpointsOf, fetchKtapiCatalog, groupsFromPricing } from '../src/discovery.ts'

const listing = {
  data: [
    { id: 'DeepSeek Latest' },
    { id: 'deepseek-latest' },
    { id: 'deepseek-v4-flash' },
  ],
}

const pricing = {
  data: [
    { model_name: 'DeepSeek-Latest', model_ratio: 0.075, completion_ratio: 4, enable_groups: ['ktai', 'default'] },
    { model_name: 'deepseek-v4-flash', model_ratio: 0.07, enable_groups: ['ktai'] },
  ],
}

function stub(handler: (url: string) => Response): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    return handler(url)
  }) as typeof fetch
  return { fetchImpl, urls }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('ktapi catalog discovery', () => {
  it('joins the account listing with the shared pricing', async () => {
    const { fetchImpl, urls } = stub(url => (url.endsWith('/v1/models') ? json(listing) : json(pricing)))
    const snapshot = await fetchKtapiCatalog({ apiKey: 'sk-test', fetchImpl, baseUrl: 'https://ktapi.example' })

    expect(snapshot.models.map(model => model.id)).toEqual(['deepseek-latest', 'deepseek-v4-flash'])
    expect(snapshot.models[0]).toMatchObject({ defaultVisible: true, inputRatio: 0.075, outputRatio: 0.3 })
    expect(snapshot.groups).toEqual(['default', 'ktai'])
    expect(urls.sort()).toEqual(['https://ktapi.example/api/pricing', 'https://ktapi.example/v1/models'])
  })

  it('sends the relay key as a bearer token', async () => {
    let authorization: string | undefined
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/v1/models')) {
        authorization = (init?.headers as Record<string, string> | undefined)?.authorization
        return json(listing)
      }
      return json(pricing)
    }) as typeof fetch
    await fetchKtapiCatalog({ apiKey: 'sk-test', fetchImpl, baseUrl: 'https://ktapi.example' })
    expect(authorization).toBe('Bearer sk-test')
  })

  it('reports a refused credential instead of an empty catalog', async () => {
    const { fetchImpl } = stub(url =>
      url.endsWith('/v1/models') ? json({ error: { message: 'Invalid token' } }, 401) : json(pricing))
    await expect(fetchKtapiCatalog({ apiKey: 'sk-stale', fetchImpl, baseUrl: 'https://ktapi.example' }))
      .rejects.toThrow(/401/)
  })

  it('keeps the catalog when pricing is unavailable', async () => {
    const { fetchImpl } = stub(url => (url.endsWith('/v1/models') ? json(listing) : new Response('nope', { status: 500 })))
    const snapshot = await fetchKtapiCatalog({ apiKey: 'sk-test', fetchImpl, baseUrl: 'https://ktapi.example' })
    expect(snapshot.models.map(model => model.id)).toEqual(['deepseek-latest', 'deepseek-v4-flash'])
    expect(snapshot.models[0]?.inputRatio).toBeUndefined()
    expect(snapshot.groups).toEqual([])
  })

  it('fails when the listing cannot be read', async () => {
    const { fetchImpl } = stub(() => json({ message: 'boom' }, 500))
    await expect(fetchKtapiCatalog({ apiKey: 'sk-test', fetchImpl, baseUrl: 'https://ktapi.example' }))
      .rejects.toThrow(/answered 500/)
  })

  it('rejects a blank relay key before any request', async () => {
    const { fetchImpl, urls } = stub(() => json(listing))
    await expect(fetchKtapiCatalog({ apiKey: '  ', fetchImpl })).rejects.toThrow(/relay key/)
    expect(urls).toHaveLength(0)
  })

  it('joins the models endpoint once whether or not the base URL carries /v1', () => {
    expect(endpointsOf('https://ktapi.cc/v1')).toEqual({
      origin: 'https://ktapi.cc',
      models: 'https://ktapi.cc/v1',
    })
    expect(endpointsOf('https://ktapi.cc')).toEqual({
      origin: 'https://ktapi.cc',
      models: 'https://ktapi.cc/v1',
    })
    expect(endpointsOf('https://ktapi.cc/v1/')).toEqual({
      origin: 'https://ktapi.cc',
      models: 'https://ktapi.cc/v1',
    })
    expect(endpointsOf(undefined)).toEqual({ origin: 'https://ktapi.cc', models: 'https://ktapi.cc/v1' })
  })

  it('reads every group the pricing payload enables', () => {
    expect(groupsFromPricing(pricing)).toEqual(['default', 'ktai'])
    expect(groupsFromPricing(undefined)).toEqual([])
    expect(groupsFromPricing({ data: [{ enable_groups: 'ktai' }] })).toEqual([])
  })
})
