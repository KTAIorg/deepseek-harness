/** Repository-relative file that holds the Kito Harness release version. */
export const KITO_HARNESS_VERSION_FILE: 'kt/kito-harness/version.json'

/**
 * Read the Kito Harness release version.
 * @param root - Repository root; defaults to the root that contains this script.
 * @returns The `version` field of `kt/kito-harness/version.json`.
 */
export function kitoHarnessVersion(root?: string): string
