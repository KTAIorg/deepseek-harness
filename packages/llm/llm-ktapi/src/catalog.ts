/**
 * ktapi model catalog: folding the gateway's listing into one entry per model,
 * marking the curated Kito picks, and attaching the pricing a selector shows.
 *
 * The listing itself is read by the shared pi-ai live-catalog reader, so this
 * module starts from rows that already passed the chat-capability filter and
 * carry whatever reasoning capability the gateway declared for them. What is
 * left here is ktapi's own concern: the gateway lists one model under several
 * ids. Some differ in spelling (`DeepSeek Latest`, `deepseek/deepseek-latest`,
 * `deepseek-latest`), some in how the version is written (`claude-opus-4.8`,
 * `claude-opus-4-8`), and a dated snapshot (`claude-opus-4-5-20251101`) sits
 * beside the undated id that names it. A catalog keyed by the raw listing shows
 * one model up to six times, so every such group folds into one entry.
 *
 * An entry's request id is always an id the gateway listed. The gateway routes
 * and prices each listed id on its own, so an id rebuilt from another spelling
 * may name nothing there, and a price read from another spelling may not be the
 * price charged.
 */

import type { LiveCatalogModel, LiveModelReasoning } from '@deepseek-ai/dsh-llm-pi-ai/host'

/** Context window assumed when the pricing row carries no size tag. */
export const DEFAULT_CONTEXT = 131_072
/** Output cap assumed when the pricing row carries no size tag. */
export const DEFAULT_OUTPUT = 32_768

/**
 * Curated Kito defaults for new accounts, in product priority order.
 *
 * Each group contributes at most one entry: the first alias the account's own
 * listing carries. The table is shared with the Kito coding client so both
 * products show the same picker.
 */
export const KTAI_DEFAULT_VISIBLE_PICKS: readonly (readonly string[])[] = [
  ['grok-4.6', 'grok-4.5', 'grok-latest', 'grok'],
  ['gpt-5.6', 'openai/gpt-5.6', 'gpt-5.5', 'openai/gpt-5.5', 'gpt-5.4', 'openai/gpt-5.4', 'gpt-5.4-mini'],
  [
    'k3',
    'k3-latest',
    'kimi-k3',
    'moonshotai/kimi-k3',
    'kimi-for-coding',
    'kimi-k2.7-code',
    'moonshotai/kimi-k2.7-code',
    'kimi-k2.6',
    'moonshotai/kimi-k2.6',
    'kimi-k2.5',
    'moonshotai/kimi-k2.5',
  ],
  [
    // `deepseek-latest` leads the group: it is the route's default model, and a
    // preview entry ahead of it would make the picker open on an experimental id.
    'deepseek-latest',
    'deepseek/deepseek-latest',
    'deepseek-v4-flash',
    'deepseek/deepseek-v4-flash',
    'deepseek-v4-pro',
    'deepseek/deepseek-v4-pro',
    'deepseek-v4-flash-vision-exp',
    'deepseek/deepseek-v4-flash-vision-exp',
  ],
  ['MiniMax-M2.7', 'minimax/minimax-m2.7', 'MiniMax-M3', 'minimax/minimax-m3', 'MiniMax-M2.5', 'MiniMax-M2.1'],
]

/** One selectable model: every listed id of it folded into one entry. */
export interface KtapiModel {
  /** Request id sent to the gateway; always one of the ids the listing carries. */
  readonly id: string
  /** Name shown in the selector. */
  readonly name: string
  /** Other listed ids of the same model, which this entry stands for. */
  readonly aliases: readonly string[]
  /** Context window in tokens. */
  readonly contextWindow: number
  /** Output cap in tokens. */
  readonly maxTokens: number
  /** Whether the curated table picks this entry for new accounts. */
  readonly defaultVisible: boolean
  /** Input price per million tokens, when the pricing row of the request id reports a ratio. */
  readonly inputRatio?: number
  /** Output price per million tokens, when the pricing row of the request id reports a ratio. */
  readonly outputRatio?: number
  /** Groups the request id is enabled for, as its pricing row declares them. */
  readonly groups?: readonly string[]
  /** Reasoning capability the gateway declared for the request id, when it declared one. */
  readonly reasoning?: LiveModelReasoning
}

type JsonRecord = Record<string, unknown>

/** Dated snapshot suffix of a fold key: `-20251101` or `-2025-11-01`. */
const SNAPSHOT_SUFFIX = /-20\d{2}-?(?:0[1-9]|1[0-2])-?(?:0[1-9]|[12]\d|3[01])$/u

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined
}

function asRows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter((row): row is JsonRecord => asRecord(row) !== undefined)
  const data = asRecord(value)?.data
  if (Array.isArray(data)) return data.filter((row): row is JsonRecord => asRecord(row) !== undefined)
  const items = asRecord(data)?.items
  if (Array.isArray(items)) return items.filter((row): row is JsonRecord => asRecord(row) !== undefined)
  return []
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Reduce one spelling of a model id to the form spellings are compared in.
 * The result is a comparison form, not a request id: the gateway may not list it.
 * @param raw - an id or display name as the gateway spells it.
 * @returns the lowercase id with vendor prefixes, spaces, and underscores folded to hyphens.
 */
export function normalizeModelId(raw: string): string {
  const trimmed = raw.trim()
  const withoutVendor = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed
  return withoutVendor
    .toLowerCase()
    .replace(/[\s_]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
}

/**
 * Key shared by every listed id of one model version.
 * @param raw - an id as the gateway spells it.
 * @returns the normalized id with a version's `.` written as `-`, so
 * `claude-opus-4.8` and `claude-opus-4-8` share one key.
 */
export function modelFoldKey(raw: string): string {
  return normalizeModelId(raw).replace(/(?<=\d)\.(?=\d)/gu, '-')
}

/**
 * Order two listed ids of one model by which of them the entry sends.
 *
 * An undated id precedes a dated snapshot, an id whose model part is already
 * in normalized form precedes a display spelling (`DeepSeek Chat`), and a bare
 * id precedes a vendor-prefixed one. The shorter id and then code-unit order
 * settle what remains, so the choice depends on the listed ids alone and not on
 * the order the gateway lists them.
 * @param left - one listed id.
 * @param right - another listed id of the same model.
 * @returns negative when `left` is preferred, positive when `right` is.
 */
function compareSpellings(left: string, right: string): number {
  return Number(SNAPSHOT_SUFFIX.test(modelFoldKey(left))) - Number(SNAPSHOT_SUFFIX.test(modelFoldKey(right)))
    || Number(isDisplaySpelling(left)) - Number(isDisplaySpelling(right))
    || Number(left.includes('/')) - Number(right.includes('/'))
    || left.length - right.length
    || (left < right ? -1 : 1)
}

/** @param id - a listed id. @returns whether its model part is written other than in normalized form. */
function isDisplaySpelling(id: string): boolean {
  return id.slice(id.lastIndexOf('/') + 1) !== normalizeModelId(id)
}

/**
 * Pick the curated defaults the account's own listing carries.
 * @param available - fold keys of the models the account may use.
 * @returns the picked fold keys with their curated priority, one per curated group at most.
 */
export function pickDefaultVisibleKeys(available: Iterable<string>): Map<string, number> {
  const present = new Set(available)
  const picked = new Map<string, number>()
  KTAI_DEFAULT_VISIBLE_PICKS.forEach((group, priority) => {
    const hit = group.map(modelFoldKey).find(key => present.has(key))
    if (hit !== undefined) picked.set(hit, priority)
  })
  return picked
}

/**
 * Read a context window from a pricing row's size tag (`"128K"`, `"1M"`).
 * @param tags - the row's tag string.
 * @returns the window in tokens, or undefined when no size tag is present.
 */
export function parseContextFromTags(tags: string | undefined): number | undefined {
  const match = tags?.match(/(?:^|,)\s*(\d+(?:\.\d+)?)\s*([KM])\s*(?:,|$)/iu)
  if (match?.[1] === undefined) return undefined
  const multiplier = match[2]?.toUpperCase() === 'M' ? 1_000_000 : 1_000
  return Math.round(Number(match[1]) * multiplier)
}

/**
 * Read a context window from a pricing row's size tag (`"128K"`, `"1M"`).
 * @param tags - the row's tag string.
 * @returns the window in tokens, or {@link DEFAULT_CONTEXT} when no tag is present.
 */
export function contextFromTags(tags: string | undefined): number {
  return parseContextFromTags(tags) ?? DEFAULT_CONTEXT
}

const MAX_REASONING_FALLBACK = /^glm-(?:5-3(?:$|-)|(?:flash-)?latest$)/u

/**
 * Known model-family context windows used only when neither the gateway
 * listing nor any folded pricing row declares an explicit size tag.
 * @param id - listed model id.
 * @returns the documented context window in tokens, or undefined when unknown.
 */
export function fallbackContextWindow(id: string): number | undefined {
  const key = modelFoldKey(id).replace(/^sub2api-/u, '')
  if (/^glm-(?:5-3(?:$|-)|(?:flash-)?latest$)/u.test(key)) return 1_000_000
  if (/^glm-(?:4-7|5|5-turbo)$/u.test(key)) return 200_000
  if (/^deepseek-(?:latest|flash|v4(?:-|$))/u.test(key)) return 1_000_000
  if (/^qwen3-[78](?:-|$)/u.test(key)) return 1_000_000
  if (key === 'grok-4-3') return 1_000_000
  if (/^grok-4-[567]$/u.test(key)) return 500_000
  return undefined
}

function catalogReasoningFor(id: string, reasoning: LiveModelReasoning | undefined): LiveModelReasoning | undefined {
  if (reasoning === undefined || reasoning.efforts === false) return reasoning
  if (!MAX_REASONING_FALLBACK.test(modelFoldKey(id)) || reasoning.efforts.max !== undefined) return reasoning
  return {
    ...reasoning,
    efforts: { ...reasoning.efforts, max: 'max' },
  }
}

/**
 * Fold the listing onto one entry per model.
 *
 * Ids that share a fold key are one model. A dated snapshot joins its undated
 * id only when the listing carries that id: two snapshots listed without it
 * stay separate entries, because neither one names the other.
 * @param listed - chat-capable rows from the shared live-catalog reader.
 * @returns one entry per model, keyed by fold key, in first-listed order.
 */
export function foldListing(listed: readonly LiveCatalogModel[]): Map<string, KtapiModel> {
  const groups = new Map<string, LiveCatalogModel[]>()
  for (const row of listed) {
    const key = modelFoldKey(row.id)
    if (!key) continue
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [row])
    else if (!group.some(member => member.id === row.id)) group.push(row)
  }
  for (const [key, group] of [...groups]) {
    const undated = groups.get(key.replace(SNAPSHOT_SUFFIX, ''))
    if (undated === undefined || undated === group) continue
    undated.push(...group)
    groups.delete(key)
  }
  const folded = new Map<string, KtapiModel>()
  for (const [key, group] of groups) {
    const chosen = group.reduce((best, row) => compareSpellings(row.id, best.id) < 0 ? row : best)
    const aliases = group.map(row => row.id).filter(id => id !== chosen.id).toSorted(compareSpellings)
    // The gateway writes a display spelling with spaces (`DeepSeek Latest`); it
    // names the model better than a request id does.
    const spelled = [chosen.id, ...aliases].find(id => /\s/u.test(id))
    const reasoning = catalogReasoningFor(chosen.id, chosen.reasoning)
    folded.set(key, {
      id: chosen.id,
      name: chosen.name ?? spelled?.slice(spelled.lastIndexOf('/') + 1) ?? chosen.id,
      aliases,
      contextWindow: DEFAULT_CONTEXT,
      maxTokens: DEFAULT_OUTPUT,
      defaultVisible: false,
      ...reasoning === undefined ? {} : { reasoning },
    })
  }
  return folded
}

/** One listed id's pricing facts. */
export interface KtapiPricing {
  readonly inputRatio?: number
  readonly outputRatio?: number
  readonly groups?: readonly string[]
  readonly contextWindow?: number
}

/**
 * Read the pricing rows of a `GET /api/pricing` body, skipping rows without an id.
 * @param payload - `GET /api/pricing` body.
 * @returns pricing facts keyed by the exact id each row prices; the first row for an id wins.
 */
export function parsePricingPayload(payload: unknown): Map<string, KtapiPricing> {
  const byId = new Map<string, KtapiPricing>()
  for (const row of asRows(payload)) {
    const raw = typeof row.model_name === 'string' ? row.model_name : typeof row.name === 'string' ? row.name : ''
    const id = raw.trim()
    if (!id || byId.has(id)) continue
    const tags = typeof row.tags === 'string' ? row.tags : undefined
    const groups = Array.isArray(row.enable_groups)
      ? row.enable_groups.filter((group): group is string => typeof group === 'string')
      : undefined
    const contextWindow = parseContextFromTags(tags)
    const ratio = finiteNumber(row.model_ratio)
    const completion = finiteNumber(row.completion_ratio)
    byId.set(id, {
      ...ratio === undefined ? {} : { inputRatio: ratio, outputRatio: ratio * (completion ?? 1) },
      ...groups === undefined || groups.length === 0 ? {} : { groups },
      ...contextWindow === undefined ? {} : { contextWindow },
    })
  }
  return byId
}

/**
 * Join the account's listing with the shared pricing into the selector's catalog.
 *
 * Each entry carries the pricing row of its own request id. A sibling id's row
 * is never borrowed for pricing or group membership: the gateway prices listed
 * ids of one model differently. When the request id's pricing row omits a size
 * tag, an explicit size tag from a folded alias or documented model-family
 * capacity still supplies the context window before falling back to
 * {@link DEFAULT_CONTEXT}.
 * @param models - chat-capable rows the shared live-catalog reader returned for this account.
 * @param pricing - `GET /api/pricing` body, shared by every account.
 * @returns the catalog in curated order first, then the rest by id.
 */
export function buildKtapiCatalog(models: readonly LiveCatalogModel[], pricing: unknown): KtapiModel[] {
  const folded = foldListing(models)
  const priced = parsePricingPayload(pricing)
  const picked = pickDefaultVisibleKeys(folded.keys())
  return [...folded]
    .map(([key, entry]) => {
      const row = priced.get(entry.id)
      const aliasContext = entry.aliases
        .map(alias => priced.get(alias)?.contextWindow)
        .find((window): window is number => window !== undefined)
      const contextWindow = row?.contextWindow ?? aliasContext ?? fallbackContextWindow(entry.id) ?? DEFAULT_CONTEXT
      const priority = picked.get(key)
      return {
        priority: priority ?? Number.MAX_SAFE_INTEGER,
        entry: {
          ...entry,
          defaultVisible: priority !== undefined,
          contextWindow,
          ...row?.inputRatio === undefined ? {} : { inputRatio: row.inputRatio },
          ...row?.outputRatio === undefined ? {} : { outputRatio: row.outputRatio },
          ...row?.groups === undefined ? {} : { groups: row.groups },
        },
      }
    })
    .sort((left, right) => left.priority - right.priority || left.entry.id.localeCompare(right.entry.id))
    .map(ranked => ranked.entry)
}
