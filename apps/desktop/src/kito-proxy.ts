/** Outbound proxy support for the Kito Identity and NewAPI calls. */

import { execFile } from 'node:child_process'
import { Agent as HttpAgent, request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { connect as tlsConnect } from 'node:tls'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Registry key holding the WinINET proxy configuration. */
const WINDOWS_INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

/** @param raw - a configured proxy, with or without its scheme. @returns the proxy URL, or undefined when unusable. */
export function parseProxy(raw: string): URL | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const url = new URL(candidate)
    if (url.hostname === '') return undefined
    return url
  } catch {
    return undefined
  }
}

/**
 * Read the proxy the operating system would use for an outgoing HTTPS request.
 *
 * A desktop client that only speaks to the open internet does not need this,
 * but these calls cross the Great Firewall: the usual Windows setup routes the
 * browser through a local proxy while Node's own fetch and `https.request`
 * ignore it, so every Kito call goes direct and stalls.
 * @param env - environment carrying the conventional proxy variables.
 * @param platform - platform whose system configuration to read.
 * @returns the proxy to tunnel through, or undefined for a direct connection.
 */
export async function systemProxy(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<URL | undefined> {
  const configured = env.HTTPS_PROXY ?? env.https_proxy ?? env.ALL_PROXY ?? env.all_proxy
    ?? env.HTTP_PROXY ?? env.http_proxy
  const fromEnv = configured === undefined ? undefined : parseProxy(configured)
  if (fromEnv !== undefined) return fromEnv
  return platform === 'win32' ? await windowsProxy() : undefined
}

/**
 * @returns the enabled WinINET proxy, reading the per-protocol list when the
 * setting carries one.
 */
async function windowsProxy(): Promise<URL | undefined> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', WINDOWS_INTERNET_SETTINGS])
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(stdout)) return undefined
    const server = /ProxyServer\s+REG_SZ\s+(.+)/i.exec(stdout)?.[1]?.trim()
    if (server === undefined) return undefined
    // `http=host:port;https=host:port` is the per-protocol form; a bare
    // `host:port` applies to every protocol.
    const perProtocol = /(?:^|;)\s*https=([^;]+)/i.exec(server)?.[1]
    return parseProxy((perProtocol ?? server.split(';')[0] ?? '').trim())
  } catch {
    return undefined
  }
}

/**
 * @param proxy - proxy to tunnel through.
 * @param host - target host.
 * @param port - target port.
 * @returns the raw socket the proxy opened to the target.
 */
async function openTunnel(proxy: URL, host: string, port: number): Promise<import('node:net').Socket> {
  const headers: Record<string, string> = {}
  if (proxy.username !== '' || proxy.password !== '') {
    const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
    headers['proxy-authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`
  }
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      host: proxy.hostname,
      port: Number(proxy.port === '' ? (proxy.protocol === 'https:' ? 443 : 80) : proxy.port),
      method: 'CONNECT',
      path: `${host}:${String(port)}`,
      headers,
      agent: false,
    })
    request.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`proxy refused CONNECT ${host}:${String(port)} (${String(response.statusCode)})`))
        return
      }
      resolve(socket)
    })
    request.once('error', reject)
    request.end()
  })
}

/**
 * Issue one request through a proxy, tunnelling and then terminating TLS here
 * so the proxy never sees the plaintext.
 * @param proxy - proxy to tunnel through.
 * @param url - request target.
 * @param init - method, headers, and body.
 * @returns the response.
 */
export async function proxyRequest(proxy: URL, url: URL, init: RequestInit | undefined): Promise<Response> {
  const secure = url.protocol !== 'http:'
  const port = Number(url.port === '' ? (secure ? 443 : 80) : url.port)
  const raw = await openTunnel(proxy, url.hostname, port)
  const socket = secure ? tlsConnect({ socket: raw, servername: url.hostname }) : raw
  // The tunnel is already open, so the agent only has to carry the existing
  // socket instead of dialling the target itself.
  const agent = secure ? new HttpsAgent({ keepAlive: false }) : new HttpAgent({ keepAlive: false })
  ;(agent as unknown as { createConnection: () => typeof socket }).createConnection = () => socket
  const headers = { ...headerRecord(init?.headers), host: url.hostname }
  return await new Promise((resolve, reject) => {
    const request = (secure ? httpsRequest : httpRequest)({
      host: url.hostname,
      port,
      method: init?.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      headers,
      ...(init?.signal === undefined || init.signal === null ? {} : { signal: init.signal }),
      agent,
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
    request.on('error', reject)
    if (typeof init?.body === 'string') request.write(init.body)
    request.end()
  })
}

/** @param headers - caller headers in any accepted form. @returns a mutable header record. */
function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
}

/** @param headers - response headers. @returns a header record for the synthetic response. */
function responseHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const record: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    record[name] = Array.isArray(value) ? value.join(', ') : value
  }
  return record
}
