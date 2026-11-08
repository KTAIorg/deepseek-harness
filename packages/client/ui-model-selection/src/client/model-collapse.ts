/** Browser-local vendor sections the model picker keeps folded. */

const STORAGE_KEY = 'dsh.model-selection.collapsed.v1'

/**
 * Read the section ids the person folded, so one long vendor list stays folded
 * across picker opens instead of collapsing the next time it is shown.
 * @returns folded section ids; empty when storage is unavailable or invalid.
 */
export function loadCollapsedSections(): readonly string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/**
 * Persist the folded section ids.
 * @param ids - folded section ids.
 */
export function saveCollapsedSections(ids: readonly string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // A private or full store must not block folding a section for this open.
  }
}
