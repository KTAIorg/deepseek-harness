/** The Kito Harness release version is read from its own file and validated as an orderable version. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse } from 'semver'
import { afterEach, expect, it } from 'vitest'
import { KITO_HARNESS_VERSION_FILE, kitoHarnessVersion } from './kito-harness-version.mjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function repository(content?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'kito-harness-version-'))
  roots.push(root)
  if (content !== undefined) {
    const path = join(root, KITO_HARNESS_VERSION_FILE)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  return root
}

it('reads the version field of the given repository', () => {
  expect(kitoHarnessVersion(repository('{ "version": "3.4.5" }\n'))).toBe('3.4.5')
  expect(kitoHarnessVersion(repository('{ "version": "3.4.5-rc.6" }\n'))).toBe('3.4.5-rc.6')
})

it('rejects a missing file, malformed JSON, and a value the updater cannot order', () => {
  expect(() => kitoHarnessVersion(repository())).toThrow(/cannot read the Kito Harness version/)
  expect(() => kitoHarnessVersion(repository('{'))).toThrow(/cannot read the Kito Harness version/)
  for (const content of ['null', '{}', '{ "version": 1 }', '{ "version": "1.0" }', '{ "version": "v1.0.0" }', '{ "version": "1.0.0+build" }']) {
    expect(() => kitoHarnessVersion(repository(content)), content).toThrow(/has an invalid version/)
  }
})

it('never ships a version below the last release that used the dsh version line', () => {
  // 0.2.2-rc.10 was the last Kito Harness release numbered with the dsh version; installed copies update only upward.
  const version = parse(kitoHarnessVersion())
  expect(version?.compare('0.2.2-rc.10')).toBeGreaterThanOrEqual(0)
})
