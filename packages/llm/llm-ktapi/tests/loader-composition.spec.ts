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
    // The curated picks, not the whole listing: mounting every listed id would
    // bury them under provider duplicates.
    expect(models.map(model => model.id)).toEqual(['grok-4.6', 'deepseek-latest'])

    const resolved = await context.llm.resolveModelInfo(Ktapi.KTAI_PROVIDER, 'deepseek-latest')
    expect(resolved.context?.contextWindow).toBe(128_000)
  })
})
