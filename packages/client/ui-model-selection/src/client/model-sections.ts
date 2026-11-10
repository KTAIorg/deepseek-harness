/** Composer model picker sections: vendor grouping, alias folding, and search ordering. */

import type { ModelCatalogModel, ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ModelUsage } from './model-usage.ts'
import { modelOfUsageKey, modelUsageKey, providerOfUsageKey } from './model-usage.ts'

/** Vendor families the picker groups by; `other` catches ids no rule recognizes. */
export type ModelVendorKey = 'deepseek' | 'anthropic' | 'openai' | 'xai' | 'google' | 'moonshot' | 'qwen' | 'zai' | 'composer' | 'other'

/** Brand nouns shown as section headings; the same text in every UI language. */
export const MODEL_VENDOR_NAMES: Readonly<Record<ModelVendorKey, string>> = {
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  xai: 'xAI',
  google: 'Google',
  moonshot: 'Moonshot',
  qwen: 'Qwen',
  zai: 'Z.ai',
  composer: 'Composer',
  other: 'Other',
}

/** How many recent and frequent shortcut rows each section shows. */
const SHORTCUT_LIMIT = 5
/** Catalog id prefixes that name the vendor rather than the model. */
const VENDOR_PREFIXES = ['anthropic/', 'openai/', 'moonshotai/', 'qwen/', 'z-ai/'] as const
/** Upstream-mirror prefixes folded into the same model row. */
const MIRROR_PREFIX = 'sub2api-'
/**
 * Ids whose payload is not a chat model. They cannot serve the composer's
 * conversation, so the picker never offers them.
 */
const NON_CHAT_ID = /(^|[-_/.])(image|dall-e|imagen|flux|seedream|embedding|embed|tts|whisper|transcribe)([-_/.]|$)/i

/** Acronym segments that stay uppercase in a derived display name. */
const DISPLAY_ACRONYMS: Readonly<Record<string, string>> = { gpt: 'GPT', glm: 'GLM', ai: 'AI' }
/** Function words that stay lowercase inside a derived name. */
const DISPLAY_STOP_WORDS = new Set(['for', 'of', 'the', 'and', 'in', 'on', 'to', 'via'])
/**
 * A two-part version written with a hyphen after a word (`opus-4-8`). Each part
 * is at most two digits, so a date (`2025-11-01`) or a size (`2-22m`) does not match.
 */
const HYPHENATED_VERSION = /(?<=[a-z][-_])(\d{1,2})-(\d{1,2})(?=$|[-_])/gi

/**
 * Derive a readable name from a catalog id that repeats itself as its name.
 * `moonshotai/kimi-k3.1-pro` reads as `Kimi K3.1 Pro`, `gpt-5.6` as `GPT-5.6`,
 * and `claude-opus-4-8` as `Claude Opus 4.8`.
 * @param modelId - catalog model id.
 * @returns a display name; the original id when no word survives.
 */
export function displayNameOf(modelId: string): string {
  const segments = normalizedModelId(modelId).replace(HYPHENATED_VERSION, '$1.$2')
    .split(/[-_]+/).filter(segment => segment.length > 0)
  if (segments.length === 0) return modelId
  const words = segments.map((segment, at) => {
    const lower = segment.toLowerCase()
    const acronym = DISPLAY_ACRONYMS[lower]
    if (acronym !== undefined) return acronym
    if (at > 0 && DISPLAY_STOP_WORDS.has(lower)) return lower
    return segment.charAt(0).toUpperCase() + segment.slice(1)
  })
  // A version number attaches to the acronym it belongs to (`GPT-5.6`), while a
  // plain word keeps the space (`Claude Opus 4.8`).
  return words.reduce((name, word) => {
    const previous = name.slice(name.lastIndexOf(' ') + 1)
    const glue = /^\d/.test(word) && Object.values(DISPLAY_ACRONYMS).includes(previous) ? '-' : ' '
    return name + glue + word
  })
}

/** One selectable row: the catalog entry submitted on selection plus folded alias ids. */
export interface ModelChoice {
  /** Catalog provider id (for a Kito gateway this is `kito`). */
  readonly provider: string
  /** Provider display name from the catalog. */
  readonly providerName: string
  /** Canonical catalog entry; selecting the row submits this exact id. */
  readonly model: ModelCatalogModel
  /** Readable label: the catalog name, or a name derived from the id when it repeats it. */
  readonly displayName: string
  /** Other catalog ids that name the same model and are hidden behind this row. */
  readonly aliases: readonly string[]
}

/** Section kinds the composer picker renders. */
export type ModelSectionKind = 'recent' | 'frequent' | 'vendor' | 'results'

/** One rendered section; `label` is set for vendor groups only. */
export interface ModelSection {
  readonly kind: ModelSectionKind
  /** Stable React key and DOM id part. */
  readonly id: string
  /** Vendor heading text for `vendor` sections. */
  readonly label?: string
  /** Vendor family of a `vendor` section; drives its brand mark. */
  readonly vendor?: ModelVendorKey
  readonly choices: readonly ModelChoice[]
}

/**
 * Build the usage-history key for one provider and catalog model id.
 * @param provider - catalog provider id.
 * @param model - catalog model id.
 * @returns the key {@link modelUsageKey} builds for the same pair.
 */
export function choiceKey(provider: string, model: string): string {
  return modelUsageKey(provider, model)
}

/**
 * Strip the vendor or upstream-mirror prefix from a catalog id, so
 * `openai/gpt-5.6` and `sub2api-gpt-5.6` fold into the same `gpt-5.6` row.
 * @param model - catalog model id.
 * @returns the id without its prefix; the id itself when it carries none.
 */
export function normalizedModelId(model: string): string {
  let id = model
  for (const prefix of VENDOR_PREFIXES) {
    if (id.startsWith(prefix)) {
      id = id.slice(prefix.length)
      break
    }
  }
  return id.startsWith(MIRROR_PREFIX) ? id.slice(MIRROR_PREFIX.length) : id
}

/**
 * Classify a catalog model id into the vendor family the picker groups it under.
 * @param model - catalog model id.
 * @returns the family its prefix names, or `other` when no rule recognizes the id.
 */
export function vendorKeyOf(model: string): ModelVendorKey {
  const id = normalizedModelId(model).toLowerCase()
  if (id.startsWith('deepseek')) return 'deepseek'
  if (id.startsWith('claude')) return 'anthropic'
  if (id.startsWith('gpt') || /^o[1-4](-|$)/.test(id)) return 'openai'
  if (id.startsWith('grok')) return 'xai'
  if (id.startsWith('gemini')) return 'google'
  if (id.startsWith('kimi') || id.startsWith('k3') || id.startsWith('k2p') || id.startsWith('k2.')) return 'moonshot'
  if (id.startsWith('qwen')) return 'qwen'
  if (id.startsWith('glm')) return 'zai'
  if (id.startsWith('composer')) return 'composer'
  return 'other'
}

/**
 * Whether a catalog model id can serve the composer's chat conversation.
 * @param model - catalog model id.
 * @returns false for image, embedding, and speech ids; true otherwise.
 */
export function isChatModel(model: string): boolean {
  return !NON_CHAT_ID.test(normalizedModelId(model))
}

function compareToken(left: string, right: string): number {
  if (left === right) return 0
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (left === 'latest') return 1
  if (right === 'latest') return -1
  if (leftNumeric && rightNumeric) return Number(left) - Number(right)
  if (leftNumeric !== rightNumeric) return leftNumeric ? 1 : -1
  return left.localeCompare(right)
}

/**
 * Compare two model ids as version sequences: numeric segments compare by value
 * and sort after word segments, `latest` outranks every segment, and a shorter
 * id is the base model that sorts before its variants.
 * @param left - model id to place.
 * @param right - model id to compare against.
 * @returns positive when `left` is the newer version, negative when it is older,
 *   and zero when both ids name the same version.
 */
export function compareModelVersions(left: string, right: string): number {
  const leftTokens = normalizedModelId(left).toLowerCase().split(/[-._/]+/)
  const rightTokens = normalizedModelId(right).toLowerCase().split(/[-._/]+/)
  for (let at = 0; at < Math.max(leftTokens.length, rightTokens.length); at += 1) {
    const leftToken = leftTokens[at]
    const rightToken = rightTokens[at]
    // A shorter id is the base model; it sorts before its variants.
    if (leftToken === undefined) return -1
    if (rightToken === undefined) return 1
    const order = compareToken(leftToken, rightToken)
    if (order !== 0) return order
  }
  return 0
}

function foldProvider(group: ModelProviderGroup): ModelChoice[] {
  const folded = new Map<string, { canonical: ModelCatalogModel; aliases: string[] }>()
  for (const model of group.models) {
    if (!isChatModel(model.id)) continue
    const canonicalId = normalizedModelId(model.id)
    const existing = folded.get(canonicalId)
    if (existing === undefined) {
      folded.set(canonicalId, { canonical: model, aliases: [] })
      continue
    }
    // The bare id (no vendor prefix) is the row's submitted id; otherwise the
    // shortest spelling wins so the row reads as the model's own name.
    if (model.id === canonicalId || model.id.length < existing.canonical.id.length) {
      existing.aliases.push(existing.canonical.id)
      existing.canonical = model
    } else {
      existing.aliases.push(model.id)
    }
  }
  return [...folded.values()].map(({ canonical, aliases }) => ({
    provider: group.id,
    providerName: group.name,
    model: canonical,
    displayName: canonical.name.trim() === canonical.id || canonical.name.trim() === ''
      ? displayNameOf(canonical.id)
      : canonical.name,
    aliases: aliases.toSorted(),
  }))
}

/**
 * Flatten the catalog into picker rows: vendor-prefixed and mirror ids fold into
 * one row per model, and non-chat ids are removed.
 * @param groups - provider groups from the shared catalog.
 * @returns every selectable row, preserving catalog order inside each provider.
 */
export function modelChoices(groups: readonly ModelProviderGroup[]): ModelChoice[] {
  return groups.flatMap(group => foldProvider(group))
}

/**
 * Convert one picker row into its local usage-history key.
 * @param choice - one folded row.
 * @returns the key the row's selections are recorded under.
 */
export function usageKeyOf(choice: ModelChoice): string {
  return modelUsageKey(choice.provider, choice.model.id)
}

/**
 * Whether a saved selection names this row, through the row's own catalog id or
 * one of its folded aliases.
 * @param choice - one folded row.
 * @param provider - saved selection provider.
 * @param model - saved model id, which may be an alias of the row's id.
 * @returns whether both the provider and the model name this row.
 */
export function choiceMatches(choice: ModelChoice, provider: string, model: string): boolean {
  return choice.provider === provider && (choice.model.id === model || choice.aliases.includes(model))
}

function matchScore(text: string, query: string): number | undefined {
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  if (haystack.startsWith(needle)) return 3
  for (let at = haystack.indexOf(needle); at > 0; at = haystack.indexOf(needle, at + 1)) {
    if (/[-._/\s]/.test(haystack[at - 1] ?? '')) return 2
  }
  // Ordered subsequence: every query character appears in order.
  let cursor = 0
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1
    if (cursor === needle.length) return 1
  }
  return undefined
}

function scoreChoice(choice: ModelChoice, query: string): number | undefined {
  const scores = [choice.displayName, choice.model.id].map(text => matchScore(text, query))
  const defined = scores.filter((score): score is number => score !== undefined)
  return defined.length === 0 ? undefined : Math.max(...defined)
}

/**
 * Rank rows for a typed query by name or id: prefix matches first, then word
 * prefixes, then ordered subsequences; equal scores keep name order.
 * @param choices - rows to filter.
 * @param query - typed text; surrounding whitespace is ignored.
 * @returns matching rows in display order.
 */
export function searchChoices(choices: readonly ModelChoice[], query: string): ModelChoice[] {
  const needle = query.trim()
  if (needle === '') return [...choices]
  return choices
    .flatMap((choice) => {
      const score = scoreChoice(choice, needle)
      return score === undefined ? [] : [{ choice, score }]
    })
    .toSorted((left, right) => right.score - left.score
      || compareModelVersions(right.choice.model.id, left.choice.model.id)
      || left.choice.displayName.localeCompare(right.choice.displayName))
    .map(item => item.choice)
}

function sortChoices(choices: ModelChoice[]): ModelChoice[] {
  const providerRank = (choice: ModelChoice): number => choice.provider === 'deepseek-account'
    ? 0
    : choice.provider === 'deepseek-official' ? 1 : 2
  return choices.toSorted((left, right) =>
    providerRank(left) - providerRank(right)
    || compareModelVersions(right.model.id, left.model.id)
    || left.displayName.localeCompare(right.displayName))
}

function entryFor(choices: readonly ModelChoice[], key: string): ModelChoice | undefined {
  const provider = providerOfUsageKey(key)
  const model = modelOfUsageKey(key)
  return choices.find(choice => choiceMatches(choice, provider, model))
}

/**
 * Build the picker's sections: recent selections, frequent selections, then one
 * group per vendor. A query collapses the result into one ranked section.
 * @param choices - rows from {@link modelChoices}.
 * @param usage - local selection history.
 * @param query - search text; empty shows the grouped default view.
 * @returns the sections to render, in order.
 */
export function buildModelSections(
  choices: readonly ModelChoice[],
  usage: ModelUsage,
  query: string,
): ModelSection[] {
  if (query.trim() !== '') {
    return [{ kind: 'results', id: 'results', choices: searchChoices(choices, query) }]
  }
  const sections: ModelSection[] = []
  const recent = usage.recents
    .map(key => entryFor(choices, key))
    .filter((choice): choice is ModelChoice => choice !== undefined)
    .slice(0, SHORTCUT_LIMIT)
  if (recent.length > 0) sections.push({ kind: 'recent', id: 'recent', choices: recent })

  const recentKeys = new Set(recent.map(usageKeyOf))
  const frequent = Object.entries(usage.counts)
    .toSorted((left, right) => right[1] - left[1])
    .flatMap(([key]) => {
      const choice = entryFor(choices, key)
      return choice === undefined || recentKeys.has(usageKeyOf(choice)) ? [] : [choice]
    })
    .slice(0, SHORTCUT_LIMIT)
  if (frequent.length > 0) sections.push({ kind: 'frequent', id: 'frequent', choices: frequent })

  const byVendor = new Map<ModelVendorKey, ModelChoice[]>()
  for (const choice of choices) {
    const vendor = vendorKeyOf(choice.model.id)
    const bucket = byVendor.get(vendor)
    if (bucket === undefined) byVendor.set(vendor, [choice])
    else bucket.push(choice)
  }
  // The vendor used most recently leads; ties fall back to row count then name.
  const vendorRank = (bucket: readonly ModelChoice[]): number => {
    const positions = bucket.map(choice => usage.recents.indexOf(usageKeyOf(choice))).filter(at => at >= 0)
    return positions.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...positions)
  }
  const usageWeight = (bucket: readonly ModelChoice[]): number =>
    bucket.reduce((total, choice) => total + (usage.counts[usageKeyOf(choice)] ?? 0), 0)
  const vendors = [...byVendor.entries()].toSorted((left, right) =>
    vendorRank(left[1]) - vendorRank(right[1])
    || usageWeight(right[1]) - usageWeight(left[1])
    || MODEL_VENDOR_NAMES[left[0]].localeCompare(MODEL_VENDOR_NAMES[right[0]]))
  for (const [vendor, bucket] of vendors) {
    sections.push({
      kind: 'vendor',
      id: `vendor:${vendor}`,
      label: MODEL_VENDOR_NAMES[vendor],
      vendor,
      choices: sortChoices(bucket),
    })
  }
  return sections
}
