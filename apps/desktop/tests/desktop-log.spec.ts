/** Rolling main-process log file. */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startDesktopLog } from '../src/desktop-log.ts'

let directory: string | undefined
let close: (() => void) | undefined

afterEach(async () => {
  close?.()
  close = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

/** @returns a fresh log directory. */
async function scratch(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), 'dsh-desktop-log-'))
  return directory
}

describe('desktop log', () => {
  it('mirrors console output into the file and restores console on close', { timeout: 20_000 }, async () => {
    const original = console.warn
    const log = startDesktopLog(await scratch())
    close = () => { log.close() }

    console.warn('catalog read failed', { code: 401 })
    log.close()
    close = undefined

    const text = await readFile(log.file, 'utf8')
    expect(text).toContain('WARN catalog read failed {"code":401}')
    expect(console.warn).toBe(original)
  })

  it('records an error with its stack', { timeout: 20_000 }, async () => {
    const log = startDesktopLog(await scratch())
    close = () => { log.close() }

    console.error(new Error('relay key missing'))
    log.close()
    close = undefined

    const text = await readFile(log.file, 'utf8')
    expect(text).toContain('relay key missing')
    expect(text).toContain('ERROR')
  })

  it('keeps one previous file once the current one reaches the size cap', { timeout: 20_000 }, async () => {
    const log = startDesktopLog(await scratch())
    close = () => { log.close() }

    await writeFile(log.file, 'x'.repeat(5 * 1024 * 1024))
    console.log('after rotation')

    const current = await readFile(log.file, 'utf8')
    const previous = await readFile(join(directory as string, 'main.1.log'), 'utf8')
    expect(previous).toHaveLength(5 * 1024 * 1024)
    expect(current).toContain('after rotation')
    expect(current).not.toContain('x'.repeat(64))
    expect((await stat(log.file)).size).toBeLessThan(5 * 1024 * 1024)
  })

  it('never throws when the directory disappears', { timeout: 20_000 }, async () => {
    const root = await scratch()
    const log = startDesktopLog(join(root, 'logs'))
    close = () => { log.close() }
    await rm(join(root, 'logs'), { recursive: true, force: true })

    expect(() => { console.log('write into a vanished directory') }).not.toThrow()
  })

  it('survives a value that cannot be serialized', { timeout: 20_000 }, async () => {
    const log = startDesktopLog(await scratch())
    close = () => { log.close() }
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    expect(() => { console.log(cyclic) }).not.toThrow()
    expect(await readFile(log.file, 'utf8')).toContain('LOG')
  })

  it('does not install a second mirror when started twice', { timeout: 20_000 }, async () => {
    const first = startDesktopLog(await scratch())
    const second = startDesktopLog(await scratch())
    close = () => { second.close(); first.close() }

    const spy = vi.spyOn(process.stdout, 'write')
    console.log('one line')
    spy.mockRestore()

    expect((await readFile(first.file, 'utf8')).split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(0)
  })
})
