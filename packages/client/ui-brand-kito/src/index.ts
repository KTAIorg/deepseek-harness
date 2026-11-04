/**
 * Kito browser-brand plugin, node half. The empty apply gives Loader a
 * host-side row while the browser half ships through `exports["./client"]`.
 */
import z from '@deepseek-ai/schemastery'

/** Desktop account resource settings. */
export interface Config {
  /** Account refresh interval in milliseconds; the Loader applies the default. */
  accountRefreshIntervalMs?: number
}

/** Validated settings for the shared account resource. */
export const Config: z<Config> = z.object({
  accountRefreshIntervalMs: z.number().step(1).min(1000).default(180000),
})

/** Host plugin body — this package contributes browser presentation only. */
export function apply(): void {}
