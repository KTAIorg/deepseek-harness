/**
 * The ktapi model route: one provider whose catalog comes from the account's own
 * KT Identity login rather than from configuration.
 *
 * The route owns no transport. It builds the pi-ai adapter over a provider
 * profile derived at call time, so streaming, tool calls, and reasoning ride the
 * shared OpenAI-compatible path; what this plugin adds is where the model list
 * and the credential come from.
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmError, type AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import {
  authContextFrom, credentialStoreFrom, resolveProfiles, type ResolvedPiAiProviderProfile,
} from '@deepseek-ai/dsh-llm-pi-ai/host'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_CONTEXT, DEFAULT_OUTPUT, type KtapiModel } from './catalog.ts'
import { CATALOG_TIMEOUT_MS, fetchKtapiCatalog, type KtapiCatalogSnapshot } from './discovery.ts'

/** Cordis plugin name. */
export const name = 'llm-ktapi'
/** Required services: the model seam every adapter registers into. */
export const inject = ['llm', 'credentials']

/** Route key this plugin owns. */
export const KTAI_PROVIDER = 'ktapi'

/** Configuration of the ktapi route. */
export interface Config {
  /** Credential reference holding the relay key derived from the KT Identity login. */
  apiKeyEnv: Volatile<string>
  /** Credential reference holding the KT Identity session the relay key is derived from. */
  identityTokenRef: Volatile<string>
  /** Gateway origin, including its `/v1` segment. */
  baseURL: Volatile<string>
  /** Name shown in the model selector. */
  displayName: Volatile<string>
  /** Whether the selector offers every model the account may call, curated picks first. */
  showAllModels: Volatile<boolean>
  /** Catalog cache lifetime in milliseconds; `0` reads on every access. */
  modelsMaxAgeMs: Volatile<number>
  /** Deadline for one catalog request. */
  modelsTimeoutMs: Volatile<number>
}

export const Config = z.object({
  apiKeyEnv: z.string().role('credential-ref').default('KITO_NEWAPI_API_KEY').volatile(),
  identityTokenRef: z.string().role('credential-ref').default('KITO_IDENTITY_TOKEN').volatile(),
  baseURL: z.string().default('https://ktapi.cc/v1').volatile(),
  displayName: z.string().default('KT AI').volatile(),
  showAllModels: z.boolean().default(true).volatile(),
  modelsMaxAgeMs: z.number().min(0).default(600_000).volatile(),
  modelsTimeoutMs: z.number().min(1).default(CATALOG_TIMEOUT_MS).volatile(),
})

/** Detached configuration values for one operation. */
interface Options {
  readonly apiKeyEnv: string
  readonly identityTokenRef: string
  readonly baseURL: string
  readonly displayName: string
  readonly showAllModels: boolean
  readonly modelsMaxAgeMs: number
  readonly modelsTimeoutMs: number
}

/** The model the route serves before its first successful catalog read. */
const BOOTSTRAP_MODEL = 'deepseek-latest'

/** @param config - live plugin configuration. @returns detached values for one operation. */
function optionsOf(config: Config): Options {
  return {
    apiKeyEnv: config.apiKeyEnv.get(),
    identityTokenRef: config.identityTokenRef.get(),
    baseURL: config.baseURL.get() || 'https://ktapi.cc/v1',
    displayName: config.displayName.get(),
    showAllModels: config.showAllModels.get(),
    modelsMaxAgeMs: config.modelsMaxAgeMs.get(),
    modelsTimeoutMs: config.modelsTimeoutMs.get(),
  }
}

/** @param model - one catalog entry. @returns the pi-ai model row the profile carries. */
function modelRow(model: KtapiModel): Record<string, unknown> {
  return {
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow > 0 ? model.contextWindow : DEFAULT_CONTEXT,
    maxTokens: DEFAULT_OUTPUT,
    input: ['text'],
    // The gateway states each model's reasoning levels itself; a row without
    // one describes a model that reads no reasoning parameter.
    ...model.reasoning === undefined ? {} : { reasoningEfforts: model.reasoning.efforts },
  }
}

/**
 * Build the provider profile the adapter resolves for one catalog snapshot.
 * @param options - detached configuration.
 * @param snapshot - current catalog, absent before the first successful read.
 * @returns the raw profile pi-ai consumes.
 */
function profileOf(options: Options, snapshot: KtapiCatalogSnapshot | undefined): Record<string, unknown> {
  // The default serves every model the account may call, curated picks first,
  // so a person sees the catalog their recharge actually carries; hiding rows
  // behind a curated shortlist read as lost models. `showAllModels: false`
  // restores the shortlist for surfaces that want one entry per family. The
  // snapshot is already ordered curated-first, then by id
  // (@see buildKtapiCatalog).
  const models = snapshot === undefined
    ? [{ id: BOOTSTRAP_MODEL, name: 'DeepSeek Latest', contextWindow: DEFAULT_CONTEXT, maxTokens: DEFAULT_OUTPUT, input: ['text'] }]
    : (options.showAllModels ? snapshot.models : snapshot.models.filter(model => model.defaultVisible)).map(modelRow)
  return {
    displayName: options.displayName,
    apiKeyEnv: options.apiKeyEnv,
    api: 'openai-completions',
    baseURL: options.baseURL,
    models,
  }
}

/**
 * Register the ktapi route, then keep its catalog current.
 * @param ctx - plugin context carrying the model seam.
 * @param config - validated route configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const auth = { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) }

  let snapshot: KtapiCatalogSnapshot | undefined
  let reading: Promise<void> | undefined
  let revision = 0
  let registration: AdapterRegistrationHandle | undefined

  /** @returns whether the cached catalog still satisfies the configured lifetime. */
  const fresh = (): boolean => {
    const { modelsMaxAgeMs } = optionsOf(config)
    return snapshot !== undefined && modelsMaxAgeMs > 0 && Date.now() - snapshot.fetchedAt < modelsMaxAgeMs
  }

  /** @returns the provider profiles the adapter serves right now. */
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> =>
    resolveProfiles({ [KTAI_PROVIDER]: profileOf(optionsOf(config), snapshot) })

  /**
   * Resolve the relay key through the credential seam.
   *
   * A stored KT Identity session with no relay key is a broken state, not a
   * signed-out one: the account is signed in and the desktop was supposed to
   * derive the key from it. Reporting that as "no credential" leaves the model
   * selector empty with nothing said, which is exactly how a failed derivation
   * reads to the person looking at it, so it fails loud instead.
   * @returns the relay key, or undefined while the account is signed out.
   */
  const resolveApiKey = async (): Promise<string | undefined> => {
    const { apiKeyEnv, identityTokenRef } = optionsOf(config)
    const hit = await ctx.credentials.resolve(credentialRef(apiKeyEnv))
    if (hit?.value !== undefined) return hit.value
    const identity = await ctx.credentials.resolve(credentialRef(identityTokenRef))
    if (identity?.value === undefined) return undefined
    throw new LlmError(
      `KT sign-in is stored but ${apiKeyEnv} was not derived from it; the model list stays empty until the relay key is stored`,
      'KTAI_RELAY_KEY_MISSING',
    )
  }

  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey: async () => await resolveApiKey(),
    auth,
  })

  /**
   * Read the account's catalog and republish the route so selectors pick it up.
   * A refused credential or a failed read keeps the previous catalog: the route
   * continues serving what the account could already call.
   *
   * A request that arrives while a read is running re-runs once that read
   * settles, because the running read may have started before the credential
   * this request is about. Without that, a key landing mid-read would be
   * swallowed by the in-flight read that resolved nothing.
   */
  const refresh = (): Promise<void> => {
    const requested = ++revision
    if (reading !== undefined) return reading
    reading = (async () => {
      try {
        await read(requested)
      } finally {
        reading = undefined
        if (revision !== requested) void refresh()
      }
    })()
    return reading
  }

  /** @param requested - the refresh request this read answers. */
  const read = async (requested: number): Promise<void> => {
    try {
      const key = await resolveApiKey()
      if (key === undefined) {
        console.info(`[llm-ktapi] no ${optionsOf(config).apiKeyEnv} yet; serving the bootstrap model`)
        // A sign-out must not leave the previous account's picks in place, and
        // the event keeps an open selector from drawing them after a key
        // disappears.
        snapshot = undefined
        registration?.replace([KTAI_PROVIDER])
        ctx.emit('llm/models-updated', KTAI_PROVIDER)
        return
      }
      if (revision !== requested) return
      const options = optionsOf(config)
      snapshot = await fetchKtapiCatalog({
        apiKey: key,
        baseUrl: options.baseURL,
        timeoutMs: options.modelsTimeoutMs,
      })
      registration?.replace([KTAI_PROVIDER])
      // An open selector caches the list it drew; the event is what makes it
      // re-read the route instead of waiting for the next page reload.
      ctx.emit('llm/models-updated', KTAI_PROVIDER)
      console.info(`[llm-ktapi] catalog: ${String(snapshot.models.length)} models,`
        + ` ${String(snapshot.models.filter(model => model.defaultVisible).length)} curated`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown'
      console.warn(`[llm-ktapi] catalog read failed; keeping the previous catalog: ${detail}`)
    }
  }

  registration = ctx.llm.registerAdapter([KTAI_PROVIDER], adapter)
  // The relay key arrives after this plugin mounts: a fresh install signs in
  // from the welcome window, so the mount-time read has nothing to resolve and
  // the route offers no models. Without this listener that first empty result
  // is final — the catalog is never read again, and the selector keeps drawing
  // the empty list it cached. The credential seam publishes every committed
  // write, so the key landing here is what republishes the route.
  ctx.on('credentials/reference-updated', (ref) => {
    if (ref !== optionsOf(config).apiKeyEnv) return
    void refresh()
  })
  ctx.effect(() => {
    if (!fresh()) void refresh()
    return () => { registration = undefined }
  })
}
