// Web e2e scenario: a hand-declared model's `reasoningEfforts` reaches the
// composer's page-sized model dialog — the levels a settings profile declares
// are exactly what the effort pane offers, and picking one records it with the
// Agent default.
// Zero model calls: declaring, describing, and switching are settings/llm
// traffic only, so there is no fixture and a stray stream would fail loud.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page, Request } from 'playwright'
import { chromium, webkit } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, onTestFinished } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

/** Starts the shipped default on this scenario's declared reasoning model. */
const OVERLAY = fileURLToPath(new URL('./declared-reasoning.overlay.yml', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/declared-reasoning', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/declared-reasoning/ui.expected.md', import.meta.url))
const POINTER_EXPECTED = fileURLToPath(new URL('./expected/declared-reasoning/pointer-menu.expected.md', import.meta.url))
const MODE = webSnapshotMode()

/** The page-sized dialog the composer's model seat opens. */
const modelsDialog = (page: Page): Locator => page.getByRole('dialog', { name: '模型与推理等级', exact: true })

/** The model pane's always-present search field. */
const dialogSearch = (dialog: Locator): Locator => dialog.getByRole('searchbox', { name: '搜索模型…', exact: true })

/** The chip that drills from the model pane into the effort list. */
const effortChip = (dialog: Locator): Locator => dialog.getByRole('button', { name: /^推理等级/ })

/** The effort list's level rows; the back button carries no pressed state. */
const effortLevels = (dialog: Locator): Locator =>
  dialog.locator('[role="group"][aria-label="推理等级"] button[aria-pressed]')

/** The level row currently in use, which is where the effort pane parks focus. */
const pressedLevel = (dialog: Locator): Locator =>
  dialog.locator('[role="group"][aria-label="推理等级"] button[aria-pressed="true"]')

/** The model pane's plain rows under their vendor sections. */
const modelRows = (dialog: Locator): Locator =>
  dialog.locator('[role="group"][aria-label="模型"] button[aria-pressed]')

/** Whether a locator holds the keyboard right now. */
const holdsKeyboard = (locator: Locator): Promise<boolean> =>
  locator.evaluate(element => element === element.ownerDocument.activeElement)

describe.skipIf(MODE === 'record').each([
  { name: 'Chromium', engine: chromium },
  { name: 'WebKit', engine: webkit },
])('web e2e: declared reasoning efforts reach the composer ($name)', ({ engine }) => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    // The whole reasoning offer is the profile: key = selectable level, value
    // = the wire spelling dispatch would send (`max: ultra` renames; the
    // valueless `off` means "supported, send nothing"). The route sets no
    // deployment default, so the pane leads with the provider-default entry.
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: {
        'acme-gateway': {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [
            { id: 'acme-think', name: 'Acme Think' },
            { id: 'acme-swift', name: 'Acme Swift' },
            { id: 'acme-lite', name: 'Acme Lite' },
          ].map(model => ({
            ...model,
            reasoningEfforts: { off: null, high: 'high', max: 'ultra' },
          })),
        },
      },
    })
    browser = await engine.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('offers exactly the declared levels and records the picked one', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-declared-reasoning-${engine.name()}`))
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.waitFor({ timeout: 15_000 })
    // The seat opens a dialog, not the retired anchored menu.
    expect(await trigger.getAttribute('aria-haspopup')).toBe('dialog')
    await trigger.click()
    const dialog = modelsDialog(page)
    await dialog.waitFor()
    await effortChip(dialog).click()

    // Declared levels, nothing else: the provider-default entry (the route
    // configures no `reasoning`), then Off/High/Max — minimal, low, medium,
    // and xhigh were not declared and must not be offered.
    const levels = effortLevels(dialog)
    await expect.poll(async () => levels.allTextContents(), { timeout: 10_000 })
      .toEqual(['Default', 'Off', 'High', 'Max'])
    // The dialog is a labelled group of plain pressed buttons: no menu roles,
    // menu items, or virtual descendant tracking survive the redesign.
    expect(await dialog.getByRole('menuitemradio').count()).toBe(0)
    expect(await dialog.getByRole('menu').count()).toBe(0)
    await compareOrRefreshGolden(UI_EXPECTED,
      await captureStableAria(page, '[role="dialog"][aria-label="模型与推理等级"]', scaffold.workspaceCwd), MODE)

    // Keyboard: the pane parks focus on the level in use, ↑↓ walk the rows
    // from there, and Tab settles the focused row exactly as Enter would.
    await expect.poll(() => holdsKeyboard(levels.nth(0)), { timeout: 10_000 }).toBe(true)
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => holdsKeyboard(levels.nth(1)), { timeout: 10_000 }).toBe(true)
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => holdsKeyboard(levels.nth(2)), { timeout: 10_000 }).toBe(true)

    // Settling is the same gesture that saves the default selection, so the
    // effort lands in the Agent default Settings section beside provider/model;
    // a successful effort change closes the dialog back to the seat.
    await page.keyboard.press('Tab')
    await expect.poll(() => dialog.count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'),
      { timeout: 10_000 },
    ).toContain('reasoningEffort: high')
    await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 10_000 })
      .toBe('选择模型，当前 Acme Think，推理等级 High')

    // Reopening the effort pane parks the keyboard on the level in use, and
    // Escape / Shift+Tab walk back out: to the model pane first, then closed.
    await trigger.click()
    await dialog.waitFor()
    await effortChip(dialog).click()
    const high = dialog.getByRole('button', { name: 'High', exact: true })
    await expect.poll(() => holdsKeyboard(high), { timeout: 10_000 }).toBe(true)
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => effortLevels(dialog).count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(() => holdsKeyboard(dialogSearch(dialog)), { timeout: 10_000 }).toBe(true)
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => dialog.count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(() => holdsKeyboard(trigger), { timeout: 10_000 }).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('opens from the pointer with keyboard focus and closes from the dialog in every pane', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-model-trigger-${engine.name()}`))
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    const dialog = modelsDialog(page)
    for (const pane of ['model', 'effort'] as const) {
      await page.locator('[data-composer-input][contenteditable="true"]').focus()
      await trigger.click()
      await dialog.waitFor()
      // The pointer opens the page-sized dialog with the keyboard already in
      // the pane the user works in: search for models, the level in use for
      // the effort list.
      if (pane === 'model') {
        await expect.poll(() => holdsKeyboard(dialogSearch(dialog)), { timeout: 10_000 }).toBe(true)
        // The close button returns focus to the seat.
        await dialog.getByRole('button', { name: '关闭模型选择器', exact: true }).click()
      } else {
        await effortChip(dialog).click()
        await expect.poll(() => holdsKeyboard(pressedLevel(dialog)), { timeout: 10_000 }).toBe(true)
        // Escape leaves the effort list for the model pane first, and only the
        // next Escape closes the dialog.
        await page.keyboard.press('Escape')
        await expect.poll(() => effortLevels(dialog).count(), { timeout: 10_000 }).toBe(0)
        await expect.poll(() => dialog.count(), { timeout: 10_000 }).toBe(1)
        await expect.poll(() => holdsKeyboard(dialogSearch(dialog)), { timeout: 10_000 }).toBe(true)
        await page.keyboard.press('Escape')
      }
      await expect.poll(() => dialog.count(), { timeout: 10_000 }).toBe(0)
      await expect.poll(() => holdsKeyboard(trigger), { timeout: 10_000 }).toBe(true)
    }
    expect(tripwire.pageErrors).toEqual([])
  })

  it('selects model and effort by mouse and keeps keyboard control after cancelled or rejected clicks', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-model-pointer-${engine.name()}`))
    let selections = 0
    const countSelection = (request: Request): void => {
      if (new URL(request.url()).pathname.endsWith('/session/selectModel')) selections++
    }
    page.on('request', countSelection)
    onTestFinished(() => { page.off('request', countSelection) })
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    const dialog = modelsDialog(page)
    await trigger.click()
    await dialog.waitFor()
    const search = dialogSearch(dialog)
    const rows = modelRows(dialog)
    await expect.poll(() => rows.count(), { timeout: 10_000 }).toBe(5)
    const current = dialog.getByRole('button', { name: 'Acme Think', exact: true })
    const target = dialog.getByRole('button', { name: 'Acme Swift', exact: true })
    const highlightedIndex = (): Promise<number> =>
      rows.evaluateAll(nodes => nodes.findIndex(row => row.hasAttribute('data-highlighted')))
    const currentIndex = await rows.evaluateAll(nodes =>
      nodes.findIndex(row => row.getAttribute('aria-pressed') === 'true' && row.textContent === 'Acme Think'))
    expect(currentIndex).toBeGreaterThanOrEqual(0)
    await expect.poll(() => holdsKeyboard(search), { timeout: 10_000 }).toBe(true)
    // Search keeps the keyboard while the highlighted row moves with the
    // arrows; the dialog no longer republishes a virtual descendant.
    expect(await highlightedIndex()).toBe(currentIndex)
    expect(await search.getAttribute('aria-activedescendant')).toBeNull()

    // Native mousedown must not blur search and unmount the dialog before click in WebKit.
    await target.getByText('Acme Swift', { exact: true }).hover()
    await page.mouse.down()
    try {
      await expect.poll(() => dialog.count()).toBe(1)
      await expect.poll(() => holdsKeyboard(search)).toBe(true)
      await dialog.locator('section[aria-label="Other"] h3').hover()
    } finally {
      await page.mouse.up()
    }
    // The cancelled press submitted nothing; its hover leaves the pointer's row highlighted.
    expect(selections).toBe(0)
    await search.press('ArrowUp')
    await expect.poll(highlightedIndex).toBe(currentIndex)
    await search.press('ArrowDown')
    await expect.poll(highlightedIndex).toBe(currentIndex + 1)
    await expect.poll(() => holdsKeyboard(search)).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => dialog.count()).toBe(0)

    // A model row submits its selection and closes the dialog.
    await trigger.click()
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Acme Swift', exact: true }).click()
    await expect.poll(() => dialog.count()).toBe(0)
    expect(selections).toBe(1)
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection().model, { timeout: 10_000 })
      .toBe('acme-swift')

    // While the session selection is pending, every level row is disabled and
    // the seat announces it is busy; settling closes the dialog.
    const held = Promise.withResolvers<undefined>()
    await page.route('**/api/session/selectModel', async (route) => {
      await held.promise
      await route.continue()
    }, { times: 1 })
    await trigger.click()
    await dialog.waitFor()
    await effortChip(dialog).click()
    await dialog.getByRole('button', { name: 'Max', exact: true }).click()
    await expect.poll(() => trigger.getAttribute('aria-busy'), { timeout: 10_000 }).toBe('true')
    await expect.poll(() => effortLevels(dialog).evaluateAll(nodes =>
      nodes.every(node => node.hasAttribute('disabled'))), { timeout: 10_000 }).toBe(true)
    expect(selections).toBe(2)
    held.resolve(undefined)
    await expect.poll(() => dialog.count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection().reasoningEffort, { timeout: 10_000 })
      .toBe('max')

    // A rejected selection keeps the dialog open, announces through the shared
    // toast, and hands the keyboard back to the seat so traversal resumes from
    // the row in use.
    await page.route('**/api/session/selectModel', async (route) => {
      const envelope = route.request().postDataJSON() as { rpcId: string }
      await route.fulfill({
        json: {
          type: 'server-response', rpcId: envelope.rpcId,
          result: {
            ok: false,
            error: { code: 'session/writer-held', message: 'writer held', details: { sessionId: 'held-session' } },
          },
        },
      })
    }, { times: 1 })
    await trigger.click()
    await dialog.waitFor()
    await expect.poll(() => holdsKeyboard(dialogSearch(dialog)), { timeout: 10_000 }).toBe(true)
    await current.click()
    await page.getByRole('alert').waitFor()
    expect(selections).toBe(3)
    await compareOrRefreshGolden(POINTER_EXPECTED,
      await captureStableAria(page, '[role="dialog"][aria-label="模型与推理等级"]', scaffold.workspaceCwd), MODE)
    await expect.poll(() => holdsKeyboard(trigger), { timeout: 10_000 }).toBe(true)
    await page.keyboard.press('Tab')
    await expect.poll(() => holdsKeyboard(dialogSearch(dialog)), { timeout: 10_000 }).toBe(true)
    const pressedRow = await rows.evaluateAll(nodes =>
      nodes.findIndex(row => row.getAttribute('aria-pressed') === 'true'))
    expect(await highlightedIndex()).toBe(pressedRow)
    const rowCount = await rows.count()
    await dialogSearch(dialog).press('ArrowUp')
    await expect.poll(highlightedIndex).toBe((pressedRow - 1 + rowCount) % rowCount)
    await dialogSearch(dialog).press('ArrowDown')
    await expect.poll(highlightedIndex).toBe(pressedRow)
    expect(await dialogSearch(dialog).getAttribute('aria-activedescendant')).toBeNull()
    await page.keyboard.press('Escape')
    await expect.poll(() => dialog.count()).toBe(0)

    // The mask closes the page-sized dialog too, returning to the seat.
    await trigger.click()
    await dialog.waitFor()
    await page.mouse.click(0, 0)
    await expect.poll(() => dialog.count()).toBe(0)
    await expect.poll(() => holdsKeyboard(trigger)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md', 'pointer-menu.expected.md'])
  })
})
