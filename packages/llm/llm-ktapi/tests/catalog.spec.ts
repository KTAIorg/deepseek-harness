import { describe, expect, it } from 'vitest'
import {
  buildKtapiCatalog,
  contextFromTags,
  DEFAULT_CONTEXT,
  foldListing,
  modelFoldKey,
  normalizeModelId,
  parsePricingPayload,
  pickDefaultVisibleKeys,
} from '../src/catalog.ts'

const listing = [
  { id: 'DeepSeek Latest' },
  { id: 'DeepSeek-Latest' },
  { id: 'deepseek/deepseek-latest' },
  { id: 'deepseek-latest' },
  { id: 'deepseek-v4-flash' },
  { id: 'grok-latest' },
  { id: 'some-other-model' },
]

const pricing = {
  data: [
    // The gateway prices each listed id on its own; the display spelling here
    // costs 250 times the request id.
    { model_name: 'DeepSeek-Latest', model_ratio: 37.5, completion_ratio: 1 },
    { model_name: 'deepseek-latest', model_ratio: 0.075, completion_ratio: 4, enable_groups: ['ktai', 'default'], tags: '128K' },
    { model_name: 'deepseek-v4-flash', model_ratio: 0.07, completion_ratio: 2, enable_groups: ['ktai'] },
  ],
}

/** Every Claude id ktapi listed on 2026-11-10: 17 models under 60 ids. */
const claudeIds = [
  ...[
    'claude-fable-5', 'claude-fable-5-1', 'claude-fable-5-2', 'claude-fable-5.1',
    'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-haiku-4.5', 'claude-haiku-5-5', 'claude-haiku-5.5',
    'claude-opus-4-5', 'claude-opus-4-5-20251101', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8',
    'claude-opus-4.5', 'claude-opus-4.6', 'claude-opus-4.7', 'claude-opus-4.8',
    'claude-opus-5', 'claude-opus-5-5', 'claude-opus-5.5',
    'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-6', 'claude-sonnet-4.5', 'claude-sonnet-4.6',
    'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-sonnet-5.5',
  ].flatMap(id => [`anthropic/${id}`, id]),
  'anthropic/claudecode opus 4.8',
  'anthropic/claudecode opus 5',
]

const ids = (listed: readonly string[]): { id: string }[] => listed.map(id => ({ id }))

describe('ktapi catalog', () => {
  it('folds every spelling of one model into one entry that sends a listed id', () => {
    const folded = foldListing(listing)
    expect([...folded.keys()]).toEqual(['deepseek-latest', 'deepseek-v4-flash', 'grok-latest', 'some-other-model'])
    expect(folded.get('deepseek-latest')).toMatchObject({
      id: 'deepseek-latest',
      name: 'DeepSeek Latest',
      aliases: ['deepseek/deepseek-latest', 'DeepSeek Latest', 'DeepSeek-Latest'],
    })
    expect(normalizeModelId(' DeepSeek  Latest ')).toBe('deepseek-latest')
    expect(normalizeModelId('deepseek/deepseek-v4-pro')).toBe('deepseek-v4-pro')
    expect(normalizeModelId('MiniMax_M2.7')).toBe('minimax-m2.7')
  })

  it('sends the listed spelling when the gateway lists no normalized id', () => {
    const folded = foldListing(ids(['openai/gpt-oss-120b', 'DeepSeek Chat', 'DeepSeek-Chat', 'deepseek/deepseek-chat']))
    expect([...folded.values()].map(entry => entry.id)).toEqual(['openai/gpt-oss-120b', 'deepseek/deepseek-chat'])
    expect(folded.get('deepseek-chat')).toMatchObject({ name: 'DeepSeek Chat', aliases: ['DeepSeek Chat', 'DeepSeek-Chat'] })
  })

  it('folds dotted and hyphenated versions and dated snapshots of the Claude listing', () => {
    expect(modelFoldKey('anthropic/claude-opus-4.8')).toBe('claude-opus-4-8')
    expect(modelFoldKey('gpt-5.2-2025-12-11')).toBe('gpt-5-2-2025-12-11')
    const expected = [
      'anthropic/claudecode opus 4.8', 'anthropic/claudecode opus 5',
      'claude-fable-5', 'claude-fable-5-1', 'claude-fable-5-2',
      'claude-haiku-4-5', 'claude-haiku-5-5',
      'claude-opus-4-5', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-opus-5-5',
      'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-sonnet-5', 'claude-sonnet-5-5',
    ]
    const catalog = buildKtapiCatalog(ids(claudeIds), undefined)
    expect(catalog.map(entry => entry.id)).toEqual(expected)
    // The request id depends on the listed ids, not on the order the gateway lists them.
    expect(buildKtapiCatalog(ids(claudeIds.toReversed()), undefined).map(entry => entry.id)).toEqual(expected)
    expect(catalog.find(entry => entry.id === 'claude-opus-4-5')?.aliases).toEqual([
      'claude-opus-4.5',
      'anthropic/claude-opus-4-5',
      'anthropic/claude-opus-4.5',
      'claude-opus-4-5-20251101',
      'anthropic/claude-opus-4-5-20251101',
    ])
    expect(catalog.find(entry => entry.id === 'anthropic/claudecode opus 4.8'))
      .toMatchObject({ name: 'claudecode opus 4.8', aliases: [] })
  })

  it('keeps dated snapshots apart when the listing carries no undated id for them', () => {
    const folded = foldListing(ids(['gpt-5.2-2025-12-11', 'gpt-5.2-2025-08-07', 'gpt-5.4-2026-03-05', 'openai/gpt-5.4']))
    expect([...folded.values()].map(entry => [entry.id, entry.aliases])).toEqual([
      ['gpt-5.2-2025-12-11', []],
      ['gpt-5.2-2025-08-07', []],
      ['openai/gpt-5.4', ['gpt-5.4-2026-03-05']],
    ])
  })

  it('lists one id once', () => {
    expect(foldListing(ids(['grok-4.6', 'grok-4.6'])).get('grok-4-6')).toMatchObject({ id: 'grok-4.6', aliases: [] })
  })

  it('prefers deepseek-latest over the preview id in the DeepSeek group', () => {
    const pickedWithPreview = pickDefaultVisibleKeys(['deepseek-latest', 'deepseek-v4-flash-vision-exp'])
    expect([...pickedWithPreview.keys()]).toEqual(['deepseek-latest'])
  })

  it('picks at most one curated entry per group, whichever way the listing writes the version', () => {
    const picked = pickDefaultVisibleKeys(['deepseek-latest', 'deepseek-v4-flash', 'grok-latest', 'gpt-5-6'])
    expect([...picked]).toEqual([['grok-latest', 0], ['gpt-5-6', 1], ['deepseek-latest', 3]])
  })

  it('reads a context window from the size tag', () => {
    expect(contextFromTags('128K')).toBe(128_000)
    expect(contextFromTags('1M')).toBe(1_000_000)
    expect(contextFromTags(undefined)).toBe(DEFAULT_CONTEXT)
    expect(contextFromTags('vision')).toBe(DEFAULT_CONTEXT)
  })

  it('attaches the pricing of the request id and orders curated picks first', () => {
    const catalog = buildKtapiCatalog(listing, pricing)
    expect(catalog.map(entry => entry.id)).toEqual([
      'grok-latest',
      'deepseek-latest',
      'deepseek-v4-flash',
      'some-other-model',
    ])
    const latest = catalog.find(entry => entry.id === 'deepseek-latest')
    expect(latest).toMatchObject({
      name: 'DeepSeek Latest',
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

  it('leaves an entry unpriced when only another spelling of it is priced', () => {
    const catalog = buildKtapiCatalog(ids(['deepseek-chat', 'DeepSeek-Chat']), {
      data: [{ model_name: 'DeepSeek-Chat', model_ratio: 37.5, completion_ratio: 1 }],
    })
    expect(catalog).toHaveLength(1)
    expect(catalog[0]).toMatchObject({ id: 'deepseek-chat', aliases: ['DeepSeek-Chat'] })
    expect(catalog[0]?.inputRatio).toBeUndefined()
  })

  it('reads pricing rows from each payload form and skips unusable rows', () => {
    const rows = [
      { name: 'by-name', model_ratio: '2' },
      { model_name: 'by-name', model_ratio: 9 },
      { model_name: '  ' },
      { model_ratio: 1 },
      { model_name: 'no-ratio', enable_groups: [], tags: '1M' },
      'not a row',
    ]
    const expected = [
      ['by-name', { inputRatio: 2, outputRatio: 2 }],
      ['no-ratio', { contextWindow: 1_000_000 }],
    ]
    expect([...parsePricingPayload(rows)]).toEqual(expected)
    expect([...parsePricingPayload({ data: rows })]).toEqual(expected)
    expect([...parsePricingPayload({ data: { items: rows } })]).toEqual(expected)
  })

  it('keeps the listing visible when pricing is missing or malformed', () => {
    expect(buildKtapiCatalog(listing, undefined).map(entry => entry.id)).toContain('deepseek-latest')
    expect(buildKtapiCatalog(listing, { data: 'not rows' }).length).toBe(4)
    expect(parsePricingPayload(null).size).toBe(0)
  })

  it('keeps the reasoning capability the gateway declares for the request id', () => {
    const catalog = buildKtapiCatalog([
      { id: 'deepseek/deepseek-latest', reasoning: { efforts: false } },
      { id: 'deepseek-latest', name: 'Latest', reasoning: { efforts: { low: 'low', high: 'high' }, defaultEffort: 'high' } },
      { id: 'plain-model' },
    ], undefined)
    expect(catalog.find(entry => entry.id === 'deepseek-latest'))
      .toMatchObject({ name: 'Latest', reasoning: { efforts: { low: 'low', high: 'high' }, defaultEffort: 'high' } })
    expect(catalog.find(entry => entry.id === 'plain-model')?.reasoning).toBeUndefined()
  })

  it('ignores listing rows whose id normalizes to nothing', () => {
    expect([...foldListing([{ id: '   ' }, { id: 'ok' }]).keys()]).toEqual(['ok'])
  })
})
