import { afterEach, describe, expect, it, vi } from 'vitest'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { fetchLiveCatalog, selectChatModels } from '../src/live-catalog.ts'
import { memoryAuth } from './auth-double.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('live model catalog', () => {
  it('keeps chat models and drops protocols this client cannot call', () => {
    expect(selectChatModels({
      data: [
        { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', supported_endpoint_types: ['openai'] },
        { id: 'embed-only', supported_endpoint_types: ['embedding'] },
        { id: 'k3-latest' },
      ],
    }).map(model => model.id)).toEqual(['deepseek-v4.1-flash', 'k3-latest'])
  })

  it('loads the account model list and maps each row\'s declared reasoning levels', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      data: [
        {
          id: 'deepseek-v4.1-flash',
          name: 'DeepSeek V4.1 Flash',
          supported_endpoint_types: ['openai'],
          reasoning: { efforts: ['off', 'low', 'high', 'max'], default: 'high' },
        },
        { id: 'claude-only', supported_endpoint_types: ['anthropic'] },
        { id: 'k3-latest' },
        { id: 'plain-no-reasoning', reasoning: { efforts: [] } },
      ],
    }))
    vi.stubGlobal('fetch', fetchImpl)
    const profiles = resolveProfiles({
      kito: {
        displayName: 'Kito',
        apiKeyEnv: 'KITO_IDENTITY_TOKEN',
        api: 'openai-completions',
        baseURL: 'https://ktapi.cc/v1',
        liveModels: true,
        headers: { 'X-Kito-Token-Name': 'kito' },
        compat: { thinkingFormat: 'deepseek', supportsDeveloperRole: false },
      },
    })
    const adapter = new PiAiAdapter({
      profiles: () => profiles,
      resolveApiKey: () => Promise.resolve('sk-test'),
      auth: memoryAuth(),
    })
    const models = await adapter.listModels('kito')
    expect(models.map(model => model.id)).toEqual(['deepseek-v4.1-flash', 'k3-latest', 'plain-no-reasoning'])
    expect(models[0]?.name).toBe('DeepSeek V4.1 Flash')
    const resolved = await adapter.resolveModel('kito', 'deepseek-v4.1-flash')
    expect(resolved.id).toBe('deepseek-v4.1-flash')
    expect(resolved.reasoning?.efforts.map(effort => effort.id)).toEqual(['off', 'low', 'high', 'max'])
    // A row without a reasoning object, and a row with an empty efforts list,
    // both materialize as non-reasoning: no fabricated effort selector.
    const unlisted = await adapter.resolveModel('kito', 'k3-latest')
    expect(unlisted.reasoning).toBeUndefined()
    const nonReasoning = await adapter.resolveModel('kito', 'plain-no-reasoning')
    expect(nonReasoning.reasoning).toBeUndefined()
    await adapter.listModels('kito')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('https://ktapi.cc/v1/models', expect.objectContaining({
      headers: expect.objectContaining({
        authorization: 'Bearer sk-test',
        'X-Kito-Token-Name': 'kito',
      }),
    }))
  })

  it('sends deployment headers but never lets them replace the discovery-owned names', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [{ id: 'k3-latest' }] }))
    await fetchLiveCatalog('https://ktapi.cc/v1', 'sk-test', {
      headers: { Authorization: 'Bearer attacker', ACCEPT: 'text/html', 'X-Deploy-Trace': 'on' },
      fetchImpl,
    })
    expect(fetchImpl).toHaveBeenCalledWith('https://ktapi.cc/v1/models', expect.objectContaining({
      headers: expect.objectContaining({
        authorization: 'Bearer sk-test',
        accept: 'application/json',
        'user-agent': 'Kito/2.0',
        'X-Deploy-Trace': 'on',
      }),
    }))
  })
})
