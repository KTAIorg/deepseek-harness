/**
 * Host-facing helpers for sibling model providers.
 *
 * A provider that builds its own pi-ai adapter needs the same profile
 * resolution, auth context, and live-catalog reader this package uses
 * internally. Those stay off the package root, whose surface is the plugin
 * itself; this subpath is the supported import for that narrower audience.
 */

export { authContextFrom, credentialStoreFrom } from './auth.ts'
export { resolveProfiles } from './config.ts'
export type { ResolvedPiAiProviderProfile } from './config.ts'
export { fetchLiveCatalog } from './live-catalog.ts'
export type { LiveCatalogModel, LiveModelReasoning } from './live-catalog.ts'
