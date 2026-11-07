/** Proxy discovery and tunnelling for the Kito Identity and NewAPI calls. */

import { createServer as createHttpServer, type Server } from 'node:http'
import { connect as netConnect, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { parseProxy, proxyRequest, systemProxy } from '../src/kito-proxy.ts'

const opened: Server[] = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map(async server => await new Promise<void>((resolve) => {
    server.closeAllConnections()
    server.close(() => { resolve() })
  })))
})

/** @returns the port the server listens on. */
async function listen(server: Server): Promise<number> {
  opened.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server bound no port')
  return address.port
}

/** A target that answers every request with its own path. */
async function startTarget(): Promise<number> {
  return await listen(createHttpServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ path: request.url }))
  }))
}

/** A CONNECT proxy that relays each tunnel to its target verbatim. */
async function startProxy(): Promise<{ port: number; tunnels: string[] }> {
  const tunnels: string[] = []
  const server = createHttpServer()
  server.on('connect', (request: import('node:http').IncomingMessage, client: Socket, head: Buffer) => {
    const [host, port] = (request.url ?? '').split(':')
    tunnels.push(`${String(host)}:${String(port)}`)
    const upstream = netConnect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    upstream.on('error', () => { client.destroy() })
  })
  const port = await listen(server)
  return { port, tunnels }
}

describe('proxy discovery', () => {
  it('accepts a bare host and port', () => {
    expect(parseProxy('127.0.0.1:7890')?.host).toBe('127.0.0.1:7890')
  })

  it('keeps an explicit scheme', () => {
    expect(parseProxy('socks5://127.0.0.1:1080')?.protocol).toBe('socks5:')
  })

  it('ignores an unusable value', () => {
    expect(parseProxy('   ')).toBeUndefined()
  })

  it('prefers the environment over the platform setting', async () => {
    const proxy = await systemProxy({ HTTPS_PROXY: 'http://10.0.0.1:8080' }, 'win32')
    expect(proxy?.hostname).toBe('10.0.0.1')
  })

  it('reports no proxy on a platform with no setting to read', async () => {
    expect(await systemProxy({}, 'darwin')).toBeUndefined()
  })
})

describe('proxy tunnelling', () => {
  it('reaches the target through the proxy and keeps the request path', { timeout: 20_000 }, async () => {
    const targetPort = await startTarget()
    const { port: proxyPort, tunnels } = await startProxy()

    const response = await proxyRequest(
      new URL(`http://127.0.0.1:${String(proxyPort)}`),
      new URL(`http://127.0.0.1:${String(targetPort)}/v1/models?x=1`),
      { method: 'GET' },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ path: '/v1/models?x=1' })
    expect(tunnels).toEqual([`127.0.0.1:${String(targetPort)}`])
  })

  it('fails loudly when the proxy refuses the tunnel', { timeout: 20_000 }, async () => {
    const server = createHttpServer()
    server.on('connect', (_request: import('node:http').IncomingMessage, client: Socket) => {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n')
    })
    const port = await listen(server)

    await expect(proxyRequest(new URL(`http://127.0.0.1:${String(port)}`), new URL('http://ktapi.cc/v1/models'), {}))
      .rejects.toThrow(/proxy refused CONNECT/)
  })
})
