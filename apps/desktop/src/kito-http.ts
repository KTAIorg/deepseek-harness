/** Small JSON helpers for the Kito Identity and NewAPI calls. */

import { Resolver } from 'node:dns/promises'
import type { IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'

/** Cloudflare nameserver that still publishes the ktapi.cc zone. */
const KTAPI_ZONE_NAMESERVER = 'aron.ns.cloudflare.com'

/** Cloudflare rejects the default Node agent on login.ktyun.cc. This is the agent that request is allowed to send. */
export const KITO_USER_AGENT = 'Kito/2.0'

/** @param extra - additional headers. @returns JSON headers including the allowed user agent. */
export function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { accept: 'application/json', 'content-type': 'application/json', 'user-agent': KITO_USER_AGENT, ...extra }
}

/** @param response - HTTP response. @returns parsed JSON, raw text, or undefined when the body is empty. */
export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** @param payload - response body. @param fallback - message used when the body has no error string. @returns a human-readable failure. */
export function errorMessage(payload: unknown, fallback: string): string {
  if (payload === null || typeof payload !== 'object') return fallback
  const record = payload as { message?: unknown; error?: unknown }
  if (typeof record.message === 'string' && record.message.trim()) return record.message
  if (typeof record.error === 'string' && record.error.trim()) return record.error
  return fallback
}

/** @param error - thrown request failure. @returns the message plus the underlying cause when present. */
export function failureDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause
  if (!(cause instanceof Error)) return error.message
  const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : ''
  const causeText = [code, `${cause.name}: ${cause.message}`].filter(part => part !== '').join(' ')
  return `${error.message} (${causeText})`
}

/**
 * Resolve a ktapi.cc hostname from the nameserver that still publishes the zone.
 * The registrar nameservers currently answer with a different address, so the system resolver cannot reach NewAPI.
 * @param hostname - request hostname.
 * @returns an address to connect to, or undefined when the hostname is outside the zone.
 */
export async function resolveKtapiHost(hostname: string): Promise<string | undefined> {
  if (hostname !== 'ktapi.cc' && !hostname.endsWith('.ktapi.cc')) return undefined
  try {
    const resolver = new Resolver()
    const nameservers = await resolver.resolve4(KTAPI_ZONE_NAMESERVER)
    const nameserver = nameservers[0]
    if (nameserver === undefined) return undefined
    resolver.setServers([nameserver])
    const addresses = await resolver.resolve4(hostname)
    return addresses[0]
  } catch (error) {
    console.error('kito ktapi resolve failed', failureDetail(error))
    return undefined
  }
}

/**
 * Fetch used by KT Identity and NewAPI calls. ktapi.cc is connected at the address from {@link resolveKtapiHost}.
 * @param input - request URL.
 * @param init - request method, headers, and body.
 * @returns the HTTP response.
 */
export const kitoFetch: typeof fetch = async (input, init) => {
  const url = requestUrl(input)
  const address = await resolveKtapiHost(url.hostname)
  if (address === undefined) return fetch(input, init)
  return fetchByAddress(url, address, init)
}

/** @param signal - caller cancellation. @param ms - request deadline. @returns a signal that aborts on either condition. */
export function withTimeout(signal: AbortSignal | undefined, ms = 15_000): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return input
  return new URL(input.url)
}

function fetchByAddress(url: URL, address: string, init: RequestInit | undefined): Promise<Response> {
  const headers = headerRecord(init?.headers)
  headers.host = url.hostname
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      host: address,
      servername: url.hostname,
      method: init?.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      headers,
      signal: init?.signal ?? undefined,
    }, (incoming) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      incoming.on('end', () => {
        resolve(new Response(Buffer.concat(chunks), {
          status: incoming.statusCode ?? 502,
          headers: responseHeaders(incoming.headers),
        }))
      })
    })
    req.on('error', reject)
    if (typeof init?.body === 'string') req.write(init.body)
    req.end()
  })
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
}

function responseHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') result.append(key, value)
    else if (Array.isArray(value)) {
      for (const entry of value) result.append(key, entry)
    }
  }
  return result
}
