/** Browser-local model usage: the composer picker's recent and frequent rows. */

/** How many recently selected models the picker keeps. */
export const MODEL_RECENT_LIMIT = 5
/** How many counted models the local usage keeps before trimming the least used. */
export const MODEL_COUNT_LIMIT = 40

const STORAGE_KEY = 'dsh.model-selection.usage.v1'

/** Local selection history keyed by provider and catalog id. */
export interface ModelUsage {
  /** Most recently selected keys, newest first. */
  readonly recents: readonly string[]
  /** Selection counts by key. */
  readonly counts: Readonly<Record<string, number>>
}

/** The empty history used before the first selection or without storage. */
const EMPTY_USAGE: ModelUsage = { recents: [], counts: {} }

/**
 * @param provider - catalog provider id.
 * @param model - exact catalog model id, which may itself contain `/`.
 * @returns one stable usage key for that row.
 */
export function modelUsageKey(provider: string, model: string): string {
  // NUL cannot appear in either catalog id, so the two parts stay unambiguous.
  return `${provider}\u0000${model}`
}

/** @param key - usage key from {@link modelUsageKey}. @returns its provider part. */
export function providerOfUsageKey(key: string): string {
  return key.slice(0, key.indexOf('\u0000'))
}

/** @param key - usage key from {@link modelUsageKey}. @returns its model part. */
export function modelOfUsageKey(key: string): string {
  return key.slice(key.indexOf('\u0000') + 1)
}

function isUsage(value: unknown): value is ModelUsage {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { recents?: unknown; counts?: unknown }
  if (!Array.isArray(candidate.recents) || !candidate.recents.every(item => typeof item === 'string')) return false
  if (candidate.counts === null || typeof candidate.counts !== 'object') return false
  return Object.values(candidate.counts as Record<string, unknown>)
    .every(count => typeof count === 'number' && Number.isFinite(count) && count > 0)
}

/**
 * Read the local selection history.
 * @returns the stored usage, or the empty history when storage is unavailable or invalid.
 */
export function loadModelUsage(): ModelUsage {
  if (typeof localStorage === 'undefined') return EMPTY_USAGE
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return EMPTY_USAGE
    const parsed: unknown = JSON.parse(raw)
    if (!isUsage(parsed)) return EMPTY_USAGE
    return {
      recents: [...new Set(parsed.recents)].slice(0, MODEL_RECENT_LIMIT),
      counts: parsed.counts,
    }
  } catch {
    return EMPTY_USAGE
  }
}

function persist(usage: ModelUsage): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(usage))
  } catch {
    // A private or full browser store must not block selecting a model.
  }
}

/**
 * Record one selection: it becomes the newest recent row and its count grows.
 * @param usage - history before the selection.
 * @param key - usage key of the selected model.
 * @returns the updated bounded history, already persisted when storage allows.
 */
export function rememberModelUse(usage: ModelUsage, key: string): ModelUsage {
  const recents = [key, ...usage.recents.filter(item => item !== key)].slice(0, MODEL_RECENT_LIMIT)
  const counts = { ...usage.counts, [key]: (usage.counts[key] ?? 0) + 1 }
  const recency = (item: string): number => {
    const at = recents.indexOf(item)
    return at === -1 ? Number.POSITIVE_INFINITY : at
  }
  const trimmed = Object.entries(counts)
    .toSorted((left, right) => right[1] - left[1] || recency(left[0]) - recency(right[0]))
    .slice(0, MODEL_COUNT_LIMIT)
  const next: ModelUsage = { recents, counts: Object.fromEntries(trimmed) }
  persist(next)
  return next
}
