/**
 * ktapi model catalog: normalizing the gateway's listing into one entry per
 * model, intersecting it with the curated Kito picks, and attaching the pricing
 * a selector shows.
 *
 * ktapi exposes each model under several spellings (`DeepSeek Latest`,
 * `DeepSeek-Latest`, `deepseek/deepseek-latest`, `deepseek-latest`). They all
 * route to the same upstream, so a catalog keyed by the raw listing would show
 * duplicates; every id is normalized to one lowercase request id here.
 */

/** Context window assumed when the pricing row carries no size tag. */
export const DEFAULT_CONTEXT = 131_072
/** Output cap assumed when the pricing row carries no size tag. */
export const DEFAULT_OUTPUT = 32_768

/**
 * Curated Kito defaults for new accounts, in product priority order.
 *
 * Each group contributes at most one id: the first alias the account's own
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

/** One selectable model, already normalized. */
export interface KtapiModel {
  /** Request id sent to the gateway. */
  readonly id: string
  /** Name shown in the selector. */
  readonly name: string
  /** Context window in tokens. */
  readonly contextWindow: number
  /** Output cap in tokens. */
  readonly maxTokens: number
  /** Whether the curated table picks this entry for new accounts. */
  readonly defaultVisible: boolean
  /** Input price per million tokens, when the pricing row reports a ratio. */
  readonly inputRatio?: number
  /** Output price per million tokens, when the pricing row reports a ratio. */
  readonly outputRatio?: number
  /** Groups the model is enabled for, as the pricing row declares them. */
  readonly groups?: readonly string[]
}

type JsonRecord = Record<string, unknown>

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
 * Reduce every listing spelling of one model to a single request id.
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
 * Pick the curated defaults the account's own listing carries.
 * @param available - normalized ids the account may use.
 * @returns the picked ids, one per curated group at most.
 */
export function pickDefaultVisibleModelIds(available: Iterable<string>): Set<string> {
  const present = new Set(available)
  const picked = new Set<string>()
  for (const group of KTAI_DEFAULT_VISIBLE_PICKS) {
    const hit = group.map(normalizeModelId).find(id => present.has(id))
    if (hit !== undefined) picked.add(hit)
  }
  return picked
}

/**
 * Read a context window from a pricing row's size tag (`"128K"`, `"1M"`).
 * @param tags - the row's tag string.
 * @returns the window in tokens, or {@link DEFAULT_CONTEXT} when no tag is present.
 */
export function contextFromTags(tags: string | undefined): number {
  const match = tags?.match(/(?:^|,)\s*(\d+(?:\.\d+)?)\s*([KM])\s*(?:,|$)/iu)
  if (match?.[1] === undefined) return DEFAULT_CONTEXT
  const multiplier = match[2]?.toUpperCase() === 'M' ? 1_000_000 : 1_000
  return Math.round(Number(match[1]) * multiplier)
}

/** @param payload - `GET /v1/models` body. @returns one record per listed model, keyed by normalized id. */
export function parseModelsPayload(payload: unknown): Map<string, { id: string; name: string }> {
  const byId = new Map<string, { id: string; name: string }>()
  for (const row of asRows(payload)) {
    const raw = typeof row.id === 'string' ? row.id.trim() : ''
    if (!raw) continue
    const id = normalizeModelId(raw)
    if (!id || byId.has(id)) continue
    byId.set(id, { id, name: raw })
  }
  return byId
}

/** One row's pricing facts, keyed by normalized model id. */
export interface KtapiPricing {
  readonly name?: string
  readonly inputRatio?: number
  readonly outputRatio?: number
  readonly groups?: readonly string[]
  readonly contextWindow?: number
}

/**
 * @param payload - `GET /api/pricing` body.
 * @returns pricing facts keyed by normalized model id; the first row for an id wins.
 */
export function parsePricingPayload(payload: unknown): Map<string, KtapiPricing> {
  const byId = new Map<string, KtapiPricing>()
  for (const row of asRows(payload)) {
    const raw = typeof row.model_name === 'string' ? row.model_name : typeof row.name === 'string' ? row.name : ''
    if (!raw.trim()) continue
    const id = normalizeModelId(raw)
    if (!id || byId.has(id)) continue
    const tags = typeof row.tags === 'string' ? row.tags : undefined
    const groups = Array.isArray(row.enable_groups)
      ? row.enable_groups.filter((group): group is string => typeof group === 'string')
      : undefined
    const ratio = finiteNumber(row.model_ratio)
    const completion = finiteNumber(row.completion_ratio)
    byId.set(id, {
      name: raw,
      ...ratio === undefined ? {} : { inputRatio: ratio },
      ...ratio === undefined ? {} : { outputRatio: ratio * (completion ?? 1) },
      ...groups === undefined || groups.length === 0 ? {} : { groups },
      ...tags === undefined ? {} : { contextWindow: contextFromTags(tags) },
    })
  }
  return byId
}

/**
 * Join the account's listing with the shared pricing into the selector's catalog.
 * @param models - `GET /v1/models` body for the account's credential.
 * @param pricing - `GET /api/pricing` body, shared by every account.
 * @returns the catalog in curated order first, then the rest by id.
 */
export function buildKtapiCatalog(models: unknown, pricing: unknown): KtapiModel[] {
  const listed = parseModelsPayload(models)
  const priced = parsePricingPayload(pricing)
  const picked = pickDefaultVisibleModelIds(listed.keys())
  const entries: KtapiModel[] = []
  for (const [id, listedEntry] of listed) {
    const row = priced.get(id)
    entries.push({
      id,
      name: row?.name ?? listedEntry.name,
      contextWindow: row?.contextWindow ?? DEFAULT_CONTEXT,
      maxTokens: DEFAULT_OUTPUT,
      defaultVisible: picked.has(id),
      ...row?.inputRatio === undefined ? {} : { inputRatio: row.inputRatio },
      ...row?.outputRatio === undefined ? {} : { outputRatio: row.outputRatio },
      ...row?.groups === undefined ? {} : { groups: row.groups },
    })
  }
  const curatedOrder = new Map<string, number>()
  let rank = 0
  for (const group of KTAI_DEFAULT_VISIBLE_PICKS) {
    for (const alias of group) {
      const id = normalizeModelId(alias)
      if (!curatedOrder.has(id)) curatedOrder.set(id, rank)
    }
    rank += 1
  }
  return entries.sort((left, right) => {
    const leftRank = left.defaultVisible ? curatedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    const rightRank = right.defaultVisible ? curatedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    return leftRank === rightRank ? left.id.localeCompare(right.id) : leftRank - rightRank
  })
}
