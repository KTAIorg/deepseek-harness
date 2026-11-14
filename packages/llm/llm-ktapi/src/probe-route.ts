/** HTTP surface the model selector calls to ask whether a listed model answers. */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { probeModels, type ModelProbeResult } from './probe.ts'

/** Route path; the selector posts model ids here. */
export const PROBE_PATH = '/kito/model-probe'

/** Route the desktop calls when its window is shown again. */
export const CATALOG_REFRESH_PATH = '/kito/catalog-refresh'

/** A selector sends a handful of ids; anything larger is a mistake or hostility. */
const MAX_BODY_BYTES = 64 * 1024

/** Facts the route reads from the owning plugin. */
export interface ProbeRouteInput {
  /** Current relay key, or undefined while signed out. */
  readonly resolveApiKey: () => Promise<string | undefined>
  /** Gateway endpoint including `/v1`. */
  readonly baseURL: () => string
  /** Model ids the account currently lists; probing anything else is refused. */
  readonly models: () => readonly string[]
}

/** The host web server surface this route registers into; typed locally so the LLM layer owns no host dependency. */
interface WebServerHandle {
  register(route: {
    readonly kind: 'exact'
    readonly path: string
    readonly handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>
  }): () => void
}

/** @param ctx - context that carries the host web server. @returns that service. */
function webServerOf(ctx: Context): WebServerHandle {
  return Reflect.get(ctx, 'webServer') as WebServerHandle
}

/** Trust surface consumed here; the browser-side connection package owns the full type. */
interface ProbeConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/**
 * Register the probe route on the host web server.
 * @param ctx - context that carries `webServer` (and `connection` when present).
 * @param input - live facts the handler answers from.
 */
export function registerProbeRoute(ctx: Context, input: ProbeRouteInput): void {
  const connection = Reflect.get(ctx, 'connection') as ProbeConnection | undefined
  ctx.effect(() => webServerOf(ctx).register({
    kind: 'exact',
    path: PROBE_PATH,
    handler: async (request, response) => {
      const rejection = connection?.requestRejection(request)
      if (rejection !== undefined) {
        sendJson(response, rejection, { error: 'unauthorized' })
        return
      }
      if (request.method !== 'POST') {
        response.setHeader('allow', 'POST')
        sendJson(response, 405, { error: 'method-not-allowed' })
        return
      }
      const body = await readJsonBody(request)
      if (body === undefined) {
        sendJson(response, 400, { error: 'invalid-json' })
        return
      }
      const listed = new Set(input.models())
      const requested = Array.isArray(body.models) ? body.models.filter((id): id is string => typeof id === 'string') : [...listed]
      const unknown = requested.filter(id => !listed.has(id))
      if (requested.length === 0 || unknown.length > 0) {
        sendJson(response, 400, { error: 'unlisted-model', models: unknown })
        return
      }
      const apiKey = await input.resolveApiKey()
      if (apiKey === undefined) {
        sendJson(response, 401, { error: 'signed-out' })
        return
      }
      try {
        const results: ModelProbeResult[] = await probeModels({ apiKey, baseUrl: input.baseURL(), models: requested })
        sendJson(response, 200, { probedAt: Date.now(), results })
      } catch (error) {
        sendJson(response, 502, { error: 'probe-failed', message: error instanceof Error ? error.message : 'unknown' })
      }
    },
  }), `llm-ktapi: POST ${PROBE_PATH}`)
}

/**
 * Register a refresh of the account catalog.
 * A failed read keeps the previous catalog; the handler still answers 200
 * because the window can open again.
 * @param ctx - context that carries `webServer`.
 * @param refresh - host catalog read.
 */
export function registerCatalogRefreshRoute(ctx: Context, refresh: () => Promise<void>): void {
  const connection = Reflect.get(ctx, 'connection') as ProbeConnection | undefined
  ctx.effect(() => webServerOf(ctx).register({
    kind: 'exact',
    path: CATALOG_REFRESH_PATH,
    handler: async (request, response) => {
      const rejection = connection?.requestRejection(request)
      if (rejection !== undefined) {
        sendJson(response, rejection, { error: 'unauthorized' })
        return
      }
      if (request.method !== 'POST') {
        response.setHeader('allow', 'POST')
        sendJson(response, 405, { error: 'method-not-allowed' })
        return
      }
      await refresh()
      sendJson(response, 200, { ok: true })
    },
  }), `llm-ktapi: POST ${CATALOG_REFRESH_PATH}`)
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

/**
 * Read a bounded JSON object body.
 * @param request - the incoming request.
 * @returns the parsed record, or undefined when the body is missing, too large, or not an object.
 */
async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayLike<number> | string)
    size += buffer.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch (_error) {
    return undefined
  }
}
