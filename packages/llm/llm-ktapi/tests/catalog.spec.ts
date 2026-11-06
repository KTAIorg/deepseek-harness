import { describe, expect, it } from 'vitest'
import {
  buildKtapiCatalog,
  contextFromTags,
  DEFAULT_CONTEXT,
  normalizeModelId,
  parseModelsPayload,
  parsePricingPayload,
  pickDefaultVisibleModelIds,
} from '../src/catalog.ts'

const listing = {
  data: [
    { id: 'DeepSeek Latest', object: 'model' },
    { id: 'DeepSeek-Latest', object: 'model' },
    { id: 'deepseek/deepseek-latest', object: 'model' },
    { id: 'deepseek-v4-flash', object: 'model' },
    { id: 'grok-latest', object: 'model' },
    { id: 'some-other-model', object: 'model' },
  ],
}

const pricing = {
  data: [
    { model_name: 'DeepSeek-Latest', model_ratio: 0.075, completion_ratio: 4, enable_groups: ['ktai', 'default'], tags: '128K' },
    { model_name: 'deepseek-v4-flash', model_ratio: 0.07, completion_ratio: 2, enable_groups: ['ktai'] },
  ],
}

describe('ktapi catalog', () => {
  it('folds every spelling of one model into a single request id', () => {
    const listed = parseModelsPayload(listing)
    expect([...listed.keys()]).toEqual([
      'deepseek-latest',
      'deepseek-v4-flash',
      'grok-latest',
      'some-other-model',
    ])
    expect(normalizeModelId(' DeepSeek  Latest ')).toBe('deepseek-latest')
    expect(normalizeModelId('deepseek/deepseek-v4-pro')).toBe('deepseek-v4-pro')
    expect(normalizeModelId('MiniMax_M2.7')).toBe('minimax-m2.7')
  })

  it('prefers deepseek-latest over the preview id in the DeepSeek group', () => {
    const pickedWithPreview = pickDefaultVisibleModelIds(['deepseek-latest', 'deepseek-v4-flash-vision-exp'])
    expect([...pickedWithPreview]).toEqual(['deepseek-latest'])
  })

  it('picks at most one curated id per group', () => {
    const picked = pickDefaultVisibleModelIds(['deepseek-latest', 'deepseek-v4-flash', 'grok-latest'])
    expect([...picked].sort()).toEqual(['deepseek-latest', 'grok-latest'])
  })

  it('reads a context window from the size tag', () => {
    expect(contextFromTags('128K')).toBe(128_000)
    expect(contextFromTags('1M')).toBe(1_000_000)
    expect(contextFromTags(undefined)).toBe(DEFAULT_CONTEXT)
    expect(contextFromTags('vision')).toBe(DEFAULT_CONTEXT)
  })

  it('attaches pricing and orders curated picks first', () => {
    const catalog = buildKtapiCatalog(listing, pricing)
    expect(catalog.map(entry => entry.id)).toEqual([
      'grok-latest',
      'deepseek-latest',
      'deepseek-v4-flash',
      'some-other-model',
    ])
    const latest = catalog.find(entry => entry.id === 'deepseek-latest')
    expect(latest).toMatchObject({
      name: 'DeepSeek-Latest',
      contextWindow: 128_000,
      inputRatio: 0.075,
      outputRatio: 0.3,
      groups: ['ktai', 'default'],
      defaultVisible: true,
    })
    const unpriced = catalog.find(entry => entry.id === 'some-other-model')
    expect(unpriced).toMatchObject({ contextWindow: DEFAULT_CONTEXT, defaultVisible: false })
    expect(unpriced?.inputRatio).toBeUndefined()
  })

  it('keeps the listing visible when pricing is missing or malformed', () => {
    expect(buildKtapiCatalog(listing, undefined).map(entry => entry.id)).toContain('deepseek-latest')
    expect(buildKtapiCatalog(listing, { data: 'not rows' }).length).toBe(4)
    expect(parsePricingPayload(null).size).toBe(0)
  })

  it('ignores listing rows without an id', () => {
    expect([...parseModelsPayload({ data: [{ id: '  ' }, { id: 'ok' }, {}] }).keys()]).toEqual(['ok'])
  })
})
