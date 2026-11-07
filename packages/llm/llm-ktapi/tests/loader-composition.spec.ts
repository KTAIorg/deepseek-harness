import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import * as Ktapi from '../src/index.ts'

/**
 * The packaged profile this route ships in resolved to an empty model list,
 * because the profile had no provider the account's own login could fill. Unit
 * tests cannot see that: the wiring lives in the Loader composition, so this
 * spec boots a real Loader and asserts what a model selector would read.
 */

let root: string | undefined
let context: Context | undefined
const realFetch = globalThis.fetch

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  globalThis.fetch = realFetch
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const listing = {
  data: [
    { id: 'DeepSeek Latest' },
    { id: 'deepseek-latest' },
    { id: 'deepseek-v4-flash' },
    { id: 'grok-4.6' },
  ],
}

const pricing = {
  data: [
    { model_name: 'DeepSeek-Latest', model_ratio: 0.075, completion_ratio: 4, tags: '128K' },
  ],
}

/** @param url - request URL. @returns the gateway response a real deployment would send. */
function gateway(url: string): Response {
  const body = url.endsWith('/v1/models') ? listing : pricing
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('real Loader composition', () => {
  it('offers the account models from the stored KT credential alone', { timeout: 60_000 }, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-llm-ktapi-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: fixture-dependencies',
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-llm-ktapi'",
      '  config:',
      "    baseURL: 'https://ktapi.example/v1'",
      '',
    ].join('\n'))

    globalThis.fetch = (async (input: RequestInfo | URL) => gateway(String(input))) as typeof fetch

    const dependencies = {
      name: 'fixture-dependencies',
      apply(ctx: Context) {
        ctx.provide('credentials', {
          resolve: async (ref: { value?: unknown }) => ({
            value: 'sk-from-kito-login',
            source: 'file',
            ref,
          }),
        } as never)
      },
    }

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['fixture-dependencies', dependencies],
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-llm-ktapi', Ktapi],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()
    expect([...context.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])

    const models = await context.llm.listModels(Ktapi.KTAI_PROVIDER)
    // Every id the account may call, the curated picks first; the selector
    // groups by vendor family, so the rest of the listing stays reachable.
    expect(models.map(model => model.id)).toEqual(['grok-4.6', 'deepseek-latest', 'deepseek-v4-flash'])

    const resolved = await context.llm.resolveModelInfo(Ktapi.KTAI_PROVIDER, 'deepseek-latest')
    expect(resolved.context?.contextWindow).toBe(128_000)
  })

  it('serves the curated shortlist when showAllModels is off', { timeout: 60_000 }, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-llm-ktapi-curated-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: fixture-dependencies',
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-llm-ktapi'",
      '  config:',
      "    baseURL: 'https://ktapi.example/v1'",
      '    showAllModels: false',
      '',
    ].join('\n'))

    globalThis.fetch = (async (input: RequestInfo | URL) => gateway(String(input))) as typeof fetch

    const dependencies = {
      name: 'fixture-dependencies',
      apply(ctx: Context) {
        ctx.provide('credentials', {
          resolve: async (ref: { value?: unknown }) => ({
            value: 'sk-from-kito-login',
            source: 'file',
            ref,
          }),
        } as never)
      },
    }

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['fixture-dependencies', dependencies],
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-llm-ktapi', Ktapi],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()
    expect((await context.llm.listModels(Ktapi.KTAI_PROVIDER)).map(model => model.id))
      .toEqual(['grok-4.6', 'deepseek-latest'])
  })

  it('publishes the account catalog when the relay key arrives after mount', { timeout: 60_000 }, async () => {
    // A fresh install signs in from the welcome window, so the plugin mounts
    // with no relay key. The route must recover when the key lands instead of
    // keeping the empty list it drew first.
    root = await mkdtemp(join(tmpdir(), 'dsh-llm-ktapi-late-key-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: fixture-dependencies',
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-llm-ktapi'",
      '  config:',
      "    baseURL: 'https://ktapi.example/v1'",
      '',
    ].join('\n'))

    globalThis.fetch = (async (input: RequestInfo | URL) => gateway(String(input))) as typeof fetch

    const stored = new Map<string, string>()
    const dependencies = {
      name: 'fixture-dependencies',
      apply(ctx: Context) {
        ctx.provide('credentials', {
          resolve: async (ref: string) => stored.has(ref) ? { value: stored.get(ref), source: 'file', ref } : undefined,
          set: async (ref: string, value: string) => {
            stored.set(ref, value)
            ctx.emit('credentials/reference-updated', ref as never)
          },
          unset: async (ref: string) => {
            stored.delete(ref)
            ctx.emit('credentials/reference-updated', ref as never)
          },
        } as never)
      },
    }

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['fixture-dependencies', dependencies],
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-llm-ktapi', Ktapi],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    // Signed out: no relay key. The route still publishes its bootstrap row,
    // and every consumer of `llm/models-updated` has been told so — a selector
    // that drew this list keeps drawing it until the key lands.
    expect((await context.llm.listModels(Ktapi.KTAI_PROVIDER)).map(model => model.id)).toEqual(['deepseek-latest'])

    const live = context
    const published: string[] = []
    live.on('llm/models-updated', (provider: string) => { published.push(provider) })
    const republished = new Promise<void>((resolve) => {
      live.on('llm/models-updated', () => { resolve() })
    })
    // An unrelated credential must not republish this route.
    await live.credentials.set('SOME_OTHER_KEY' as never, 'sk-unrelated' as never)
    expect(published).toEqual([])

    await live.credentials.set('KITO_NEWAPI_API_KEY' as never, 'sk-from-kito-login' as never)
    await republished

    expect((await live.llm.listModels(Ktapi.KTAI_PROVIDER)).map(model => model.id))
      .toEqual(['grok-4.6', 'deepseek-latest', 'deepseek-v4-flash'])
  })

  it('reports a stored sign-in with no relay key instead of an empty list', { timeout: 60_000 }, async () => {
    // The desktop derives the relay key from the identity session. When that
    // derivation fails the account is signed in and the route has nothing, and
    // an empty selector is indistinguishable from "the catalog is empty".
    root = await mkdtemp(join(tmpdir(), 'dsh-llm-ktapi-no-key-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: fixture-dependencies',
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-llm-ktapi'",
      '  config:',
      "    baseURL: 'https://ktapi.example/v1'",
      '',
    ].join('\n'))

    globalThis.fetch = (async (input: RequestInfo | URL) => gateway(String(input))) as typeof fetch

    const stored = new Map<string, string>([['KITO_IDENTITY_TOKEN', 'identity-access-token']])
    const dependencies = {
      name: 'fixture-dependencies',
      apply(ctx: Context) {
        ctx.provide('credentials', {
          resolve: async (ref: string) => stored.has(ref) ? { value: stored.get(ref), source: 'file', ref } : undefined,
        } as never)
      },
    }

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['fixture-dependencies', dependencies],
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-llm-ktapi', Ktapi],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    await expect(context.llm.listModels(Ktapi.KTAI_PROVIDER)).rejects.toThrow(/KITO_NEWAPI_API_KEY was not derived/)
  })
})
