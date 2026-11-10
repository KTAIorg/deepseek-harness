// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'
import {
  buildModelSections, choiceMatches, compareModelVersions, isChatModel, modelChoices, searchChoices,
  vendorKeyOf,
} from '../src/client/model-sections.ts'
import {
  loadModelUsage, modelOfUsageKey, modelUsageKey, MODEL_COUNT_LIMIT, MODEL_RECENT_LIMIT,
  providerOfUsageKey, rememberModelUse,
} from '../src/client/model-usage.ts'

const group = (models: readonly (readonly [string, string])[]): ModelProviderGroup => ({
  id: 'kito',
  name: 'Kito',
  models: models.map(([id, name]) => ({ id, name, reasoning: { efforts: [] } })),
})

afterEach(() => { localStorage.clear() })

describe('model vendor grouping', () => {
  it('maps prefixed and bare ids to one vendor family', () => {
    expect(vendorKeyOf('anthropic/claude-opus-5')).toBe('anthropic')
    expect(vendorKeyOf('claude-opus-5')).toBe('anthropic')
    expect(vendorKeyOf('openai/gpt-5.4')).toBe('openai')
    expect(vendorKeyOf('gpt-5.2')).toBe('openai')
    expect(vendorKeyOf('sub2api-grok-4.5')).toBe('xai')
    expect(vendorKeyOf('grok-4.5')).toBe('xai')
    expect(vendorKeyOf('gemini-2.5-pro')).toBe('google')
    expect(vendorKeyOf('moonshotai/kimi-k3')).toBe('moonshot')
    expect(vendorKeyOf('k3.1-pro')).toBe('moonshot')
    expect(vendorKeyOf('qwen/qwen3.7-max')).toBe('qwen')
    expect(vendorKeyOf('z-ai/glm-5.3')).toBe('zai')
    expect(vendorKeyOf('composer-2.5')).toBe('composer')
    expect(vendorKeyOf('something-else')).toBe('other')
  })

  it('drops ids that cannot serve a chat conversation', () => {
    expect(isChatModel('gpt-image-1.5')).toBe(false)
    expect(isChatModel('gemini-3.1-flash-image')).toBe(false)
    expect(isChatModel('gpt-5.4')).toBe(true)
    expect(isChatModel('claude-opus-5')).toBe(true)
  })

  it('folds prefixed and mirror ids into one row with the bare id submitted', () => {
    const choices = modelChoices([group([
      ['gpt-5.6', 'GPT-5.6'],
      ['openai/gpt-5.6', 'GPT-5.6'],
      ['sub2api-grok-4.6', 'Grok 4.6'],
      ['grok-4.6', 'Grok 4.6'],
      ['gpt-image-1.5', 'GPT Image'],
    ])])
    const ids = choices.map(choice => choice.model.id)
    expect(ids).toEqual(['gpt-5.6', 'grok-4.6'])
    expect(choices[0]?.aliases).toEqual(['openai/gpt-5.6'])
    expect(choices[1]?.aliases).toEqual(['sub2api-grok-4.6'])
  })

  it('derives a readable name from an id that repeats itself as its name', () => {
    const names = (ids: readonly string[]): string[] =>
      modelChoices([group(ids.map(id => [id, id] as const))]).map(choice => choice.displayName)
    expect(names(['claude-opus-4-8', 'gpt-5-1', 'gpt-5.6', 'moonshotai/kimi-k3.1-pro']))
      .toEqual(['Claude Opus 4.8', 'GPT-5.1', 'GPT-5.6', 'Kimi K3.1 Pro'])
    // Only a two-part version after a word reads as one number; dates, sizes, and `v4-1` keep their parts.
    expect(names(['claude-haiku-4-5-20251001', 'o3-2025-04-16', 'llama-prompt-guard-2-22m', 'deepseek-v4-1-flash']))
      .toEqual(['Claude Haiku 4.5 20251001', 'O3 2025 04 16', 'Llama Prompt Guard 2 22m', 'Deepseek V4 1 Flash'])
  })

  it('orders newer versions and latest tags before older releases', () => {
    expect(compareModelVersions('claude-opus-5', 'claude-opus-4.8')).toBeGreaterThan(0)
    expect(compareModelVersions('claude-opus-latest', 'claude-opus-5')).toBeGreaterThan(0)
    expect(compareModelVersions('gpt-5.6', 'gpt-5.6-luna')).toBeLessThan(0)
    expect(compareModelVersions('gpt-5.4', 'gpt-5.4')).toBe(0)
  })
})

describe('model picker sections', () => {
  const choices = modelChoices([group([
    ['gpt-5.6', 'GPT-5.6'],
    ['openai/gpt-5.6', 'GPT-5.6'],
    ['gpt-5.4', 'GPT-5.4'],
    ['claude-opus-5', 'Claude Opus 5'],
    ['anthropic/claude-opus-5', 'Claude Opus 5'],
    ['claude-opus-4.8', 'Claude Opus 4.8'],
    ['k3.1-pro', 'Kimi K3.1 Pro'],
    ['grok-4.6', 'Grok 4.6'],
    ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
  ])])

  it('pins recent selections, then frequent ones without repeating a recent row', () => {
    const usage = {
      recents: [modelUsageKey('kito', 'claude-opus-5'), modelUsageKey('kito', 'gpt-5.6')],
      counts: {
        [modelUsageKey('kito', 'gpt-5.6')]: 4,
        [modelUsageKey('kito', 'claude-opus-5')]: 3,
        [modelUsageKey('kito', 'k3.1-pro')]: 2,
      },
    }
    const sections = buildModelSections(choices, usage, '')
    expect(sections[0]?.kind).toBe('recent')
    expect(sections[0]?.choices.map(choice => choice.model.id)).toEqual(['claude-opus-5', 'gpt-5.6'])
    expect(sections[1]?.kind).toBe('frequent')
    expect(sections[1]?.choices.map(choice => choice.model.id)).toEqual(['k3.1-pro'])
    const vendors = sections.filter(section => section.kind === 'vendor')
    expect(vendors.map(section => section.label)).toEqual(['Anthropic', 'OpenAI', 'Moonshot', 'Google', 'xAI'])
    expect(vendors[1]?.choices.map(choice => choice.model.id)).toEqual(['gpt-5.6', 'gpt-5.4'])
  })

  it('collapses to one ranked section while searching, prefix hits first', () => {
    const sections = buildModelSections(choices, { recents: [], counts: {} }, 'gpt')
    expect(sections).toHaveLength(1)
    expect(sections[0]?.kind).toBe('results')
    expect(sections[0]?.choices.map(choice => choice.model.id)).toEqual(['gpt-5.6', 'gpt-5.4'])
    expect(searchChoices(choices, 'opus').map(choice => choice.model.id))
      .toEqual(['claude-opus-5', 'claude-opus-4.8'])
    expect(searchChoices(choices, 'zzz')).toEqual([])
  })

  it('matches a saved selection through a folded alias id', () => {
    const folded = choices.find(choice => choice.model.id === 'claude-opus-5')
    expect(folded).toBeDefined()
    expect(choiceMatches(folded!, 'kito', 'claude-opus-5')).toBe(true)
    expect(choiceMatches(folded!, 'kito', 'anthropic/claude-opus-5')).toBe(true)
    expect(choiceMatches(folded!, 'other', 'claude-opus-5')).toBe(false)
  })
})

describe('model usage history', () => {
  it('round-trips usage keys whose model id contains a slash', () => {
    const key = modelUsageKey('kito', 'anthropic/claude-opus-5')
    expect(providerOfUsageKey(key)).toBe('kito')
    expect(modelOfUsageKey(key)).toBe('anthropic/claude-opus-5')
  })

  it('promotes the latest selection and bounds the recent list', () => {
    let usage = loadModelUsage()
    expect(usage).toEqual({ recents: [], counts: {} })
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) usage = rememberModelUse(usage, modelUsageKey('kito', id))
    expect(usage.recents).toHaveLength(MODEL_RECENT_LIMIT)
    expect(usage.recents[0]).toBe(modelUsageKey('kito', 'f'))
    usage = rememberModelUse(usage, modelUsageKey('kito', 'a'))
    expect(usage.recents[0]).toBe(modelUsageKey('kito', 'a'))
    expect(usage.recents.filter(key => key === modelUsageKey('kito', 'a'))).toHaveLength(1)
    expect(usage.counts[modelUsageKey('kito', 'a')]).toBe(2)
    expect(loadModelUsage().recents).toEqual(usage.recents)
  })

  it('trims the counted map to its most used rows, dropping the oldest tie', () => {
    let usage = loadModelUsage()
    for (let repeat = 0; repeat < 3; repeat += 1) usage = rememberModelUse(usage, modelUsageKey('kito', 'keep'))
    for (let index = 0; index < MODEL_COUNT_LIMIT + 5; index += 1) {
      usage = rememberModelUse(usage, modelUsageKey('kito', `m${String(index)}`))
    }
    expect(Object.keys(usage.counts)).toHaveLength(MODEL_COUNT_LIMIT)
    // A repeated row outlives the cap; single-use rows leave oldest first.
    expect(usage.counts[modelUsageKey('kito', 'keep')]).toBe(3)
    expect(usage.counts[modelUsageKey('kito', 'm0')]).toBeUndefined()
    expect(usage.counts[modelUsageKey('kito', `m${String(MODEL_COUNT_LIMIT + 4)}`)]).toBe(1)
  })

  it('ignores an unreadable stored value', () => {
    localStorage.setItem('dsh.model-selection.usage.v1', '{"recents":"nope"}')
    expect(loadModelUsage()).toEqual({ recents: [], counts: {} })
    localStorage.setItem('dsh.model-selection.usage.v1', 'not json')
    expect(loadModelUsage()).toEqual({ recents: [], counts: {} })
  })
})
