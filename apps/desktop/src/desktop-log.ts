/**
 * Rolling log file for the packaged desktop shell.
 *
 * A packaged build has no terminal attached, so a failure that only reaches
 * `console` is invisible to the person it happened to and unreachable for
 * whoever has to diagnose it. This mirrors the main process's console output
 * into a file under the user data directory, keeping a bounded history.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Size at which the current file is rotated; one previous file is kept. */
const MAX_BYTES = 5 * 1024 * 1024

/** Console methods whose output lands in the file. */
const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

type ConsoleMethod = typeof METHODS[number]

/** One open log file. */
export interface DesktopLog {
  /** Absolute path of the current log file. */
  readonly file: string
  /** Stop mirroring console output. */
  close(): void
}

/** @param value - one console argument. @returns its loggable text. */
function render(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    // A value with a cycle or a throwing `toJSON` must not lose the log line.
    return Object.prototype.toString.call(value)
  }
}

/**
 * Mirror the main process console into `<directory>/main.log`, rotating once
 * the file reaches {@link MAX_BYTES}.
 * @param directory - directory that receives the log files.
 * @returns the open log.
 */
export function startDesktopLog(directory: string): DesktopLog {
  mkdirSync(directory, { recursive: true })
  const file = join(directory, 'main.log')
  let writable = true

  const rotateIfNeeded = (): void => {
    try {
      if (statSync(file).size < MAX_BYTES) return
    } catch {
      return
    }
    try {
      renameSync(file, join(directory, 'main.1.log'))
    } catch {
      // A rotation failure must not stop logging; the file simply keeps growing
      // until the next attempt.
    }
  }

  const write = (line: string): void => {
    if (!writable) return
    try {
      rotateIfNeeded()
      appendFileSync(file, line, { encoding: 'utf8' })
    } catch {
      writable = false
    }
  }

  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>()
  for (const method of METHODS) {
    const captured = console[method]
    originals.set(method, captured)
    const forward = captured.bind(console)
    console[method] = (...args: unknown[]): void => {
      write(`${new Date().toISOString()} ${method.toUpperCase()} ${args.map(render).join(' ')}\n`)
      forward(...args)
    }
  }

  return {
    file,
    close() {
      for (const [method, original] of originals) console[method] = original as never
      writable = false
    },
  }
}
