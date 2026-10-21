/**
 * Desktop fatal errors for later diagnosis. Collection stays off until
 * `DSH_SENTRY_DSN` is present, and this module never opens the alert or
 * triage hooks. The DSN stays in the environment, not in the repository.
 */

import * as Sentry from '@sentry/node'
import type { CrashReportPhase, CrashReportSource } from './crash-report.ts'

/** How long a fatal report may wait for the event to leave the process. */
export const KITO_SENTRY_FLUSH_MS = 2_000

let enabled = false

/** Remove credentials that a Host stderr tail or token exchange might echo. */
export function redactKitoDiagnostic(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gu, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9]{8,}\b/gu, '[redacted]')
}

function scrub<T extends {
  request?: unknown
  user?: unknown
  exception?: { values?: { value?: string }[] }
}>(event: T): T {
  delete event.request
  delete event.user
  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) exception.value = redactKitoDiagnostic(exception.value)
  }
  return event
}

/**
 * Start collection for this process. An empty or rejected DSN leaves the
 * process unchanged. A second call does not reconfigure the client.
 * @param appFacts - Packaged builds are labeled separately from local development.
 * @returns Whether later failures will be sent.
 */
export function initKitoSentry(appFacts: { packaged: boolean; release: string }): boolean {
  if (enabled) return true
  const dsn = process.env.DSH_SENTRY_DSN?.trim() ?? ''
  if (dsn === '') return false
  const environment = process.env.DSH_SENTRY_ENVIRONMENT?.trim()
    || (appFacts.packaged ? 'packaged' : 'development')
  try {
    Sentry.init({
      dsn,
      environment,
      release: appFacts.release,
      tracesSampleRate: 0,
      skipOpenTelemetrySetup: true,
      sendDefaultPii: false,
      beforeSend(event) {
        return scrub(event)
      },
    })
  } catch (error) {
    console.error('kito sentry: init failed', error instanceof Error ? error.name : 'unknown')
    return false
  }
  enabled = true
  console.info(`kito sentry: collecting desktop errors (${environment})`)
  return true
}

/**
 * Send one fatal desktop failure. Returns once the transport has finished or
 * the flush deadline has passed. A disabled collector resolves immediately.
 * @param error - The failure already shown in the local crash report.
 * @param facts - Where and when in startup the failure surfaced.
 */
export async function captureKitoFailure(
  error: unknown,
  facts: { source: CrashReportSource; phase: CrashReportPhase },
): Promise<void> {
  if (!enabled) return
  try {
    Sentry.captureException(error, {
      tags: { 'kito.source': facts.source, 'kito.phase': facts.phase, surface: 'desktop' },
    })
    await Sentry.flush(KITO_SENTRY_FLUSH_MS)
  } catch {
    console.error('kito sentry: capture failed')
  }
}
