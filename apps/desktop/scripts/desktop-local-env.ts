/**
 * Optional local environment for desktop development. The file is gitignored.
 * Existing process values win, so a shell export is not overwritten.
 */

/** Apply `KEY=value` lines onto an environment without replacing values already set. */
export function applyEnvFile(text: string, environment: NodeJS.ProcessEnv): void {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1)
    if (environment[key] === undefined || environment[key] === '') environment[key] = value
  }
}
