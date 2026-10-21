import { afterEach, describe, expect, it, vi } from 'vitest'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { selectChatModels } from '../src/live-catalog.ts'
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

  it('loads the account model list from the provider endpoint', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      data: [
        { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', supported_endpoint_types: ['openai'] },
        { id: 'claude-only', supported_endpoint_types: ['anthropic'] },
        { id: 'k3-latest' },
      ],
    }))
    vi.stubGlobal('fetch', fetchImpl)
    const profiles = resolveProfiles({
      kito: {
        displayName: 'Kito',
        apiKeyEnv: 'KITO_NEWAPI_API_KEY',
        api: 'openai-completions',
        baseURL: 'https://ktapi.cc/v1',
        liveModels: true,
        compat: { thinkingFormat: 'deepseek', supportsDeveloperRole: false },
      },
    })
    const adapter = new PiAiAdapter({
      profiles: () => profiles,
      resolveApiKey: () => Promise.resolve('sk-test'),
      auth: memoryAuth(),
    })
    const models = await adapter.listModels('kito')
    expect(models.map(model => model.id)).toEqual(['deepseek-v4.1-flash', 'k3-latest'])
    expect(models[0]?.name).toBe('DeepSeek V4.1 Flash')
    const resolved = await adapter.resolveModel('kito', 'deepseek-v4.1-flash')
    expect(resolved.id).toBe('deepseek-v4.1-flash')
    expect(resolved.reasoning?.efforts.map(effort => effort.id)).toEqual(['off', 'high'])
    await adapter.listModels('kito')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('https://ktapi.cc/v1/models', expect.anything())
  })
})
