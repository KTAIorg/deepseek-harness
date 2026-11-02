// Web e2e scenario: switching models in the composer is how this deployment's
// default is chosen. The gesture writes the shared `agent-default-model` settings section, a
// session created afterwards starts from it, and a session that already logged
// a route keeps deriving from its own log — the tier order the gateway
// resolves on every read.
// Zero model calls: the switch is settings/llm-domain traffic only, so there
// is no fixture and a stray stream would fail loud because the adapter registry is empty. Both
// routes are declared host-side (not through the UI, which has its own
// scenario) through the pi-ai adapter the shipped tree already mounts: a
// fixture-less scaffold registers no adapter at all, so the routes the
// picker offers — and the one the composer must start on — have to come from
// somewhere, and settings profiles are the product's own way to add them.
//
// Both model surfaces group rows by vendor family: the composer opens a
// page-sized dialog of plain `aria-pressed` buttons under section headings,
// while the /model popup keeps the shared sticky MenuGroup headings. Neither
// surface shows provider names any more (`Origin Gateway` / `Acme Gateway`
// collapse into `Other`), and within a section rows are ordered newest id
// first with alias ids folded away.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, watchConsole, captureStableAria, compareOrRefreshGolden, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

/** Points the shipped shared Agent default at this scenario's own route. */
const OVERLAY = fileURLToPath(new URL('./default-model.overlay.yml', import.meta.url))

/** The route this scenario starts on, patched over the shipped default. */
const START_ROUTE = 'origin-gateway'
const START_MODEL = 'origin-large'
/** The route the switch lands on, which then becomes the saved default. */
const ROUTE = 'acme-gateway'
const MODEL = 'acme-large'

/** The dialog the composer's model seat opens; its own close button carries the close copy. */
const modelsDialog = (page: Page): Locator => page.getByRole('dialog', { name: '模型与推理等级', exact: true })

/** The dialog's always-present search field. */
const dialogSearch = (dialog: Locator): Locator => dialog.getByRole('searchbox', { name: '搜索模型…', exact: true })

/** The dialog's model rows: plain buttons pressed to the current selection. */
const dialogRows = (dialog: Locator): Locator =>
  dialog.locator('[role="group"][aria-label="模型"] button[aria-pressed]')

/** The /model popup shell opened from the composer command menu. */
const COMMAND_POPUP = '[aria-label="/model 选项"]'

/**
 * Read the dialog's sections, their vendor brand mark, and each section's rows.
 * @param dialog - the open model dialog.
 * @returns one entry per section, in render order.
 */
async function readDialogSections(dialog: Locator): Promise<{ label: string; mark: string | null; rows: string[] }[]> {
  return await dialog.locator('[role="group"][aria-label="模型"] > section').evaluateAll(sections =>
    sections.map(section => ({
      label: section.getAttribute('aria-label') ?? '',
      mark: section.querySelector('h3 > img[aria-hidden="true"]') !== null
        ? 'img'
        : section.querySelector('h3 > span[aria-hidden="true"]') !== null ? 'mask' : null,
      rows: [...section.querySelectorAll('button[aria-pressed]')].map(row => row.textContent ?? ''),
    })))
}

/**
 * Read the popup's sticky MenuGroup headings, their leading brand mark, and rows.
 * @param popup - the open /model popup.
 * @returns one entry per group, in render order.
 */
async function readPopupGroups(popup: Locator): Promise<{ label: string; leading: boolean; rows: string[] }[]> {
  return await popup.locator('[data-menu-group]').evaluateAll(groups => groups.map(group => ({
    label: group.querySelector('[data-menu-group-heading]')?.textContent ?? '',
    leading: group.querySelector('[data-menu-group-heading] > [data-menu-group-leading]')
      ?.querySelector('img, span[aria-hidden="true"]') != null,
    rows: [...group.querySelectorAll('[role="option"]')].map(row => row.textContent ?? ''),
  })))
}

/** Open the /model command popup and wait for its first row. */
async function openCommandPopup(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '添加文件或调用指令', exact: true }).click()
  await page.getByRole('option', { name: /^模型/ }).click()
  const popup = page.locator(COMMAND_POPUP)
  await popup.getByRole('option').first().waitFor()
  return popup
}

describe('web e2e: the composer model switch is the default for later sessions', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  /** Create one session and its agent through the same wire face the browser uses. */
  const createSession = async (sessionId: string): Promise<string> => {
    const response = await scaffold.ctx.sessionController.create({
      sessionId: SessionId(sessionId),
      cwd: scaffold.workspaceCwd,
    })
    return response.sessionId
  }

  /** The route the Client derives from the Session projection and Host default. */
  const currentOf = (sessionId: string): Promise<unknown> => {
    const session = scaffold.ctx.sessions.get(SessionId(sessionId))
    if (session === undefined) throw new Error(`session "${sessionId}" is not live`)
    return Promise.resolve(
      scaffold.ctx.sessionProjections.snapshot(session).values.modelSelection?.next
        ?? scaffold.ctx.agentDefaultModel.currentSelection(),
    )
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    // Two routes so the picker has somewhere to start and somewhere to go.
    // Declared through the settings seam rather than the Models page: this
    // scenario is about the composer, and the declaring flow is covered by
    // models-settings.e2e.
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: {
        [START_ROUTE]: {
          displayName: 'Origin Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.origin.example/v1',
          models: [{ id: START_MODEL, name: 'Origin Large' }],
        },
        [ROUTE]: {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [{ id: MODEL, name: 'Acme Large' }, { id: 'acme-small', name: 'Acme Small' }],
        },
      },
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The composer's seats only exist once a workspace is connected: without
    // one the input is the locked placeholder and no session scope is open.
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('exposes inline model labels with exact routes under vendor sections in the dialog', async () => {
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    const label = '[data-provider-id][data-model-id]'
    const readLabels = (surface: Locator) => surface.locator(label).evaluateAll(nodes => nodes.map(node => ({
      provider: node.getAttribute('data-provider-id'), model: node.getAttribute('data-model-id'),
      name: node.textContent, slot: node.querySelector('[data-slot]')?.getAttribute('data-slot'),
      inline: node.tagName === 'SPAN' && node.querySelector('div') === null,
    })))
    const current = {
      provider: START_ROUTE, model: START_MODEL, name: 'Origin Large',
      slot: 'conversation.input.model.label', inline: true,
    }
    await expect.poll(() => readLabels(trigger)).toEqual([current])
    const dialog = modelsDialog(page)
    try {
      await trigger.click()
      await dialog.waitFor()
      // The seat announces a dialog and points at the catalog group it opens.
      expect(await trigger.getAttribute('aria-haspopup')).toBe('dialog')
      expect(await trigger.getAttribute('aria-expanded')).toBe('true')
      const catalog = dialog.getByRole('group', { name: '模型', exact: true })
      await catalog.waitFor()
      expect(await trigger.getAttribute('aria-controls')).toBe(await catalog.getAttribute('id'))
      expect(await dialog.getByRole('heading', { name: '模型与推理等级', exact: true, level: 2 }).count()).toBe(1)
      expect(await dialog.getByRole('button', { name: '关闭模型选择器', exact: true }).count()).toBe(1)
      const search = dialogSearch(dialog)
      expect(await search.getAttribute('aria-controls')).toBe(await catalog.getAttribute('id'))
      expect(await search.getAttribute('placeholder')).toBe('搜索模型…')
      expect(await search.evaluate(node => node === node.ownerDocument.activeElement)).toBe(true)

      // Vendor sections: DeepSeek first, then the unrecognized ids as Other.
      // The DeepSeek heading carries its brand mark; Other has none.
      await expect.poll(() => dialog.locator('[role="group"][aria-label="模型"] > section').count()).toBe(2)
      expect(await readDialogSections(dialog)).toEqual([
        { label: 'DeepSeek', mark: 'img', rows: ['DeepSeek-V4-Flash-Vision-Exp', 'DeepSeek-V4-Flash'] },
        { label: 'Other', mark: null, rows: ['Origin Large', 'Acme Small', 'Acme Large'] },
      ])

      // Rows are plain buttons with aria-pressed, not option/menuitemradio, and
      // the current row is the highlighted one.
      const rows = dialogRows(dialog)
      expect(await rows.count()).toBe(5)
      const rowFacts = await rows.evaluateAll(nodes => nodes.map(node => ({
        tag: node.tagName,
        tabIndex: (node as HTMLElement).tabIndex,
        id: node.id,
        pressed: node.getAttribute('aria-pressed'),
        highlighted: node.hasAttribute('data-highlighted'),
        text: node.textContent,
      })))
      expect(rowFacts.map(row => row.tag)).toEqual(Array.from({ length: 5 }, () => 'BUTTON'))
      expect(rowFacts.map(row => row.tabIndex)).toEqual(Array.from({ length: 5 }, () => -1))
      expect(new Set(rowFacts.map(row => row.id)).size).toBe(5)
      expect(rowFacts.every(row => /-model-\d+$/.test(row.id))).toBe(true)
      expect(rowFacts.filter(row => row.pressed === 'true')).toEqual([
        expect.objectContaining({ text: 'Origin Large', highlighted: true }),
      ])
      expect(await dialog.getByRole('menuitemradio').count()).toBe(0)

      await compareOrRefreshGolden(
        fileURLToPath(new URL('./expected/default-model/model-labels.expected.md', import.meta.url)),
        JSON.stringify(await readLabels(dialog), null, 2),
        webSnapshotMode(),
      )

      // The dialog's own close button returns focus to the seat.
      await dialog.getByRole('button', { name: '关闭模型选择器', exact: true }).click()
      await expect.poll(() => dialog.count()).toBe(0)
      expect(await trigger.evaluate(node => node === node.ownerDocument.activeElement)).toBe(true)
      expect(await trigger.getAttribute('aria-expanded')).toBe('false')
    } finally {
      if (await dialog.count()) await page.keyboard.press('Escape')
    }
  })

  it('keeps the page-sized dialog geometry when a row label grows, and closes from Escape or the mask', async () => {
    const viewport = page.viewportSize()!
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    const dialog = modelsDialog(page)
    try {
      await page.setViewportSize({ width: 390, height: 844 })
      await trigger.click()
      await dialog.waitFor()
      const original = (await dialog.boundingBox())!
      // Page-sized: nearly the whole narrow viewport, still fully inside it.
      expect(original.width).toBeGreaterThan(300)
      expect(original.x).toBeGreaterThanOrEqual(0)
      expect(original.y).toBeGreaterThanOrEqual(0)
      expect(original.x + original.width).toBeLessThanOrEqual(390)
      expect(original.y + original.height).toBeLessThanOrEqual(844)
      const label = dialog.locator('[data-provider-id="origin-gateway"][data-model-id="origin-large"]')
      await label.waitFor()
      // A Slot descendant can grow independently of the dialog's own props. The
      // page-sized surface no longer reanchors around its content: its box stays
      // put instead of widening like the old anchored menu.
      await label.evaluate((node) => {
        const badge = node.ownerDocument.createElement('span')
        badge.dataset.modelLabelResizeProbe = ''
        badge.textContent = ' — Provider identification badge with a long channel name'
        node.appendChild(badge)
      })
      await expect.poll(async () => (await dialog.boundingBox())!.width).toBeCloseTo(original.width)
      await expect.poll(async () => (await dialog.boundingBox())!.x).toBeCloseTo(original.x)
      await label.locator('[data-model-label-resize-probe]').evaluate((node) => { node.remove() })
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)

      // Escape closes back to the seat.
      await page.keyboard.press('Escape')
      await expect.poll(() => dialog.count()).toBe(0)
      expect(await trigger.evaluate(node => node === node.ownerDocument.activeElement)).toBe(true)

      // The mask closes it too.
      await trigger.click()
      await dialog.waitFor()
      await page.mouse.click(2, 2)
      await expect.poll(() => dialog.count()).toBe(0)
      expect(await trigger.evaluate(node => node === node.ownerDocument.activeElement)).toBe(true)
    } finally {
      if (await dialog.count()) await page.keyboard.press('Escape')
      await page.setViewportSize(viewport)
    }
  })

  it('keeps command popup search borders transparent in both palettes', async () => {
    const composer = page.locator('[data-composer-input]').first()
    await page.getByRole('button', { name: '添加文件或调用指令', exact: true }).click()
    // Leave the pointer out of the card before the popup opens: crossing a row
    // would move the popup's virtual highlight and make the golden depend on
    // the pointer path.
    await page.mouse.move(0, 0)
    const commandMenuBounds = await page.locator('[data-trigger-menu]').boundingBox()
    await page.getByRole('option', { name: /^模型/ }).click()
    const search = page.getByRole('textbox', { name: '筛选选项', exact: true })
    await search.waitFor()
    try {
      const popup = page.locator(COMMAND_POPUP)
      const popupBounds = await popup.boundingBox()
      expect(popupBounds).not.toBeNull()
      expect(commandMenuBounds).not.toBeNull()
      expect(popupBounds!.width).toBeCloseTo(commandMenuBounds!.width)
      expect(popupBounds!.x).toBeCloseTo(commandMenuBounds!.x)
      expect(await search.getAttribute('placeholder')).toBe('搜索模型…')
      // The same vendor grouping as the dialog, now with sticky headings whose
      // leading slot carries the brand mark ahead of the vendor label.
      expect(await readPopupGroups(popup)).toEqual([
        { label: 'DeepSeek', leading: true, rows: ['DeepSeek-V4-Flash-Vision-Exp', 'DeepSeek-V4-Flash'] },
        { label: 'Other', leading: false, rows: ['Origin Large', 'Acme Small', 'Acme Large'] },
      ])
      expect(await popup.getByRole('option').first().isVisible()).toBe(true)
      // The popup's virtual highlight follows the pointer, so the structural
      // golden keeps every row equal; keyboard highlight is covered separately.
      const labels = ['DeepSeek-V4-Flash-Vision-Exp', 'DeepSeek-V4-Flash', 'Origin Large', 'Acme Small', 'Acme Large']
      await compareOrRefreshGolden(
        fileURLToPath(new URL('./expected/default-model/command-picker.expected.md', import.meta.url)),
        await captureStableAria(page, COMMAND_POPUP, scaffold.workspaceCwd, {
          replacements: labels.map(label => [`option "${label}" [selected]`, `option "${label}"`] as const),
        }),
        webSnapshotMode(),
      )
      await search.fill('no-model-matches')
      await page.getByText('没有匹配的模型。', { exact: true }).waitFor()
      await search.fill('')
      const borders = await search.evaluate((input) => {
        const body = input.ownerDocument.body
        const previousTheme = body.getAttribute('data-ds-dark-theme')
        try {
          return [false, true].map((dark) => {
            body.toggleAttribute('data-ds-dark-theme', dark)
            return getComputedStyle(input).borderColor
          })
        } finally {
          if (previousTheme === null) body.removeAttribute('data-ds-dark-theme')
          else body.setAttribute('data-ds-dark-theme', previousTheme)
        }
      })
      expect(borders).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'])
    } finally {
      await search.press('Escape')
      await composer.fill('')
    }
  })

  it.each([
    { device: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1', automatic: false },
    { device: 'Android Chrome', userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/119.0.0.0 Mobile Safari/537.36', automatic: false },
    { device: 'iPhone Chrome', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 CriOS/139.0.0.0 Mobile/15E148 Safari/604.1', automatic: false },
    { device: 'narrow desktop', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15', automatic: true },
  ])('respects $device composer sizing and search focus when opening /model', async ({ userAgent, automatic }) => {
    const context = await browser.newContext({
      userAgent, viewport: { width: 390, height: 844 }, locale: ZH_BROWSER_LOCALE, hasTouch: !automatic,
    })
    try {
      const devicePage = await context.newPage()
      const consoleWatch = watchConsole(devicePage)
      await devicePage.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await devicePage.getByRole('textbox', { name: '选择工作区' }).click()
      const composer = devicePage.locator('[data-composer-input][contenteditable="true"]').first()
      await composer.waitFor()
      expect(await composer.evaluate(element => getComputedStyle(element).fontSize)).toBe(automatic ? '14px' : '16px')
      await composer.fill('/model')
      await devicePage.getByRole('option', { name: /^模型/ }).click()
      const search = devicePage.getByRole('textbox', { name: '筛选选项', exact: true })
      await search.waitFor()
      await devicePage.getByRole('option', { name: /Origin Large/ }).waitFor()
      expect(await search.evaluate(input => document.activeElement === input)).toBe(automatic)
      await search.click()
      expect(await search.evaluate(input => document.activeElement === input)).toBe(true)
      await search.fill('Origin')
      await devicePage.getByRole('option', { name: /Origin Large/ }).waitFor()
      expect(await devicePage.getByRole('option', { name: /Acme/ }).count()).toBe(0)
      expect(await devicePage.getByRole('option', { name: /DeepSeek/ }).count()).toBe(0)
      await search.press('Escape')
      await composer.fill('')
      expect(consoleWatch.pageErrors).toEqual([])
    } finally {
      await context.close()
    }
  })

  it.each([
    { device: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1', platform: 'iPhone' },
    { device: 'desktop-mode iPad', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15', platform: 'MacIntel' },
  ])('moves model dialog focus from the close button to search on $device', async ({ userAgent, platform }) => {
    const context = await browser.newContext({
      userAgent, viewport: { width: 390, height: 844 }, locale: ZH_BROWSER_LOCALE, hasTouch: true,
    })
    try {
      await context.addInitScript(({ platform }) => {
        Object.defineProperty(navigator, 'platform', { configurable: true, value: platform })
        Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
      }, { platform })
      const devicePage = await context.newPage()
      const consoleWatch = watchConsole(devicePage)
      await devicePage.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await devicePage.getByRole('textbox', { name: '选择工作区' }).click()
      const trigger = devicePage.getByRole('button', { name: /^选择模型/ })
      const dialog = modelsDialog(devicePage)
      const search = dialogSearch(dialog)
      const observations: string[] = []
      const observeFocus = async (action: string): Promise<void> => {
        const focused = await devicePage.evaluate(() => {
          const element = document.activeElement!
          const role = element.getAttribute('role') ?? element.tagName.toLowerCase()
          const label = element.getAttribute('aria-label') ?? element.textContent?.replace(/\s+/g, ' ').trim()
          return `${role}: ${label}`
        })
        observations.push(`${action}: ${focused}`)
      }
      await trigger.click()
      await dialog.waitFor()
      // Touch devices open the page-sized dialog without moving focus into
      // search; the modal layer parks it on the first control (the close
      // button) instead.
      await expect.poll(() => dialog.getByRole('button', { name: '关闭模型选择器', exact: true })
        .evaluate(element => document.activeElement === element)).toBe(true)
      expect(await search.evaluate(element => document.activeElement === element)).toBe(false)
      await observeFocus('Open')
      // The first arrow brings the highlight into the catalog and hands the
      // keyboard to search; ↑/↓ keep moving the highlighted row from there.
      const rows = dialogRows(dialog)
      await expect.poll(() => rows.count()).toBe(5)
      const initial = await rows.evaluateAll(nodes => nodes.findIndex(row => row.hasAttribute('data-highlighted')))
      expect(initial).toBeGreaterThanOrEqual(0)
      await devicePage.keyboard.press('ArrowDown')
      await expect.poll(() => search.evaluate(element => document.activeElement === element)).toBe(true)
      await expect.poll(() => rows.evaluateAll(nodes =>
        nodes.findIndex(row => row.hasAttribute('data-highlighted')))).toBe((initial + 1) % 5)
      await observeFocus('Highlight models')
      await devicePage.keyboard.press('Escape')
      await expect.poll(() => dialog.count()).toBe(0)
      await expect.poll(() => trigger.evaluate(element => document.activeElement === element)).toBe(true)
      await observeFocus('Close')
      expect(await trigger.getAttribute('aria-expanded')).toBe('false')
      expect(consoleWatch.pageErrors).toEqual([])
      await compareOrRefreshGolden(
        fileURLToPath(new URL('./expected/default-model/mobile-keyboard.expected.md', import.meta.url)),
        observations.join('\n'), webSnapshotMode(),
      )
    } finally {
      await context.close()
    }
  })

  it('shares vendor sections and model labels between the dialog and the /model popup', async () => {
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    const dialog = modelsDialog(page)
    const dialogSections = await (async () => {
      await trigger.click()
      await dialog.waitFor()
      await expect.poll(() => dialog.locator('[role="group"][aria-label="模型"] > section').count()).toBe(2)
      const sections = await readDialogSections(dialog)
      // The dialog renders plain sections; only the popup owns MenuGroup sticky
      // machinery.
      expect(await dialog.locator('[data-menu-group], [data-menu-group-heading], [data-stuck]').count()).toBe(0)
      expect(await dialog.locator('h3').evaluateAll(nodes =>
        [...new Set(nodes.map(node => getComputedStyle(node).position))])).toEqual(['static'])
      const search = dialogSearch(dialog)
      await search.fill('  ACMLG  ')
      // Search collapses the picker into one ranked results section without a
      // vendor mark, unlike the popup which filters inside its vendor groups.
      await expect.poll(() => readDialogSections(dialog))
        .toEqual([{ label: '搜索结果', mark: null, rows: ['Acme Large'] }])
      await search.fill('')
      await page.keyboard.press('Escape')
      await expect.poll(() => dialog.count()).toBe(0)
      return sections
    })()
    const popup = await openCommandPopup(page)
    try {
      await page.mouse.move(0, 0)
      expect(await readPopupGroups(popup)).toEqual(dialogSections.map(section => ({
        label: section.label, leading: section.mark !== null, rows: section.rows,
      })))
      const popupSearch = page.getByRole('textbox', { name: '筛选选项', exact: true })
      // The same query in the popup filters within its surviving vendor group.
      await popupSearch.fill('  ACMLG  ')
      await expect.poll(() => readPopupGroups(popup)).toEqual([
        { label: 'Other', leading: false, rows: ['Acme Large'] },
      ])
      await popupSearch.fill('')
      expect(await popupSearch.evaluate(node => node === node.ownerDocument.activeElement)).toBe(true)
    } finally {
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.locator('[data-composer-input]').first().fill('')
    }
  })

  it('keeps search in both pickers when the catalog is small', async () => {
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    const dialog = modelsDialog(page)
    const setModels = (expanded: boolean) => scaffold.ctx.settings.update('llm-pi-ai', {
      providers: { [ROUTE]: {
        displayName: 'Acme Gateway', api: 'openai-completions', baseURL: 'https://gateway.acme.example/v1',
        models: expanded ? [{ id: MODEL, name: 'Acme Large' }, { id: 'acme-small', name: 'Acme Small' }]
          : [{ id: MODEL, name: 'Acme Large' }],
      } },
    })
    try {
      await setModels(false)
      await trigger.click()
      await dialog.waitFor()
      await expect.poll(() => dialogRows(dialog).count()).toBe(4)
      const search = dialogSearch(dialog)
      expect(await search.count()).toBe(1)
      expect(await search.evaluate(node => node === node.ownerDocument.activeElement)).toBe(true)
      await search.fill('Acme')
      await expect.poll(() => dialogRows(dialog).allTextContents()).toEqual(['Acme Large'])
      await search.fill('')
      await page.keyboard.press('Escape')
      await expect.poll(() => dialog.count()).toBe(0)

      const popup = await openCommandPopup(page)
      await expect.poll(() => popup.getByRole('option').count()).toBe(4)
      const popupSearch = page.getByRole('textbox', { name: '筛选选项', exact: true })
      await popupSearch.fill('Acme')
      await expect.poll(() => popup.getByRole('option').allTextContents()).toEqual(['Acme Large'])
      await popupSearch.press('Escape')
      await page.locator('[data-composer-input]').first().fill('')
    } finally {
      await setModels(true)
      await trigger.click()
      await dialog.waitFor()
      await expect.poll(() => dialogRows(dialog).count()).toBe(5)
      expect(await dialogSearch(dialog).count()).toBe(1)
      await page.keyboard.press('Escape')
      await expect.poll(() => dialog.count()).toBe(0)
    }
  })

  it('paints only pinned popup vendor headings across themes and filtering, while dialog headings never stick', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-model-sticky-headings'))
    const attributes = await page.evaluate(() => ({
      platform: document.documentElement.getAttribute('data-platform'),
      theme: document.body.getAttribute('data-ds-dark-theme'),
    }))
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    try {
      const popup = await openCommandPopup(page)
      const viewport = popup.getByRole('listbox')
      const headings = popup.locator('[data-menu-group-heading]')
      const readPinned = () => headings.evaluateAll(nodes => nodes.map(node => node.hasAttribute('data-stuck')))
      await viewport.evaluate((node) => { node.style.maxHeight = '80px'; node.scrollTop = 0 })
      await expect.poll(readPinned).toEqual([false, false])
      expect(await headings.evaluateAll(nodes =>
        [...new Set(nodes.map(node => getComputedStyle(node).backgroundColor))])).toEqual(['rgba(0, 0, 0, 0)'])
      const material = await headings.first().evaluate((node) => {
        const style = getComputedStyle(node)
        return { position: style.position, radius: style.borderRadius, font: style.fontSize,
          weight: style.fontWeight, padding: style.padding }
      })
      expect(material).toMatchObject({
        position: 'sticky', font: '11px', weight: '500', padding: '4px 7px 2px',
      })
      await viewport.evaluate((node) => { node.scrollTop = 10 })
      await expect.poll(readPinned).toEqual([true, false])
      expect(await headings.first().evaluate(node => getComputedStyle(node).backgroundColor))
        .toBe('rgba(248, 249, 250, 0.94)')
      await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
      await expect.poll(async () => headings.first().evaluate(node => getComputedStyle(node).backgroundColor))
        .toBe('rgba(48, 49, 54, 0.94)')
      await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
      await viewport.evaluate((node) => { node.scrollTop = 0 })
      await expect.poll(readPinned).toEqual([false, false])

      const popupSearch = page.getByRole('textbox', { name: '筛选选项', exact: true })
      await popupSearch.fill('Origin Large')
      await expect.poll(async () => headings.count()).toBe(1)
      await expect.poll(readPinned).toEqual([false])
      await popupSearch.fill('')
      await expect.poll(readPinned).toEqual([false, false])
      // Reopening starts from an empty search.
      await popupSearch.press('Escape')
      await page.locator('[data-composer-input]').first().fill('')
      const reopened = await openCommandPopup(page)
      expect(await page.getByRole('textbox', { name: '筛选选项', exact: true }).inputValue()).toBe('')
      expect(await reopened.locator('[data-menu-group]').count()).toBe(2)

      // The dialog keeps plain, non-sticky section headings.
      await trigger.click()
      const dialog = modelsDialog(page)
      await dialog.waitFor()
      expect(await dialog.locator('[data-stuck], [data-menu-group]').count()).toBe(0)
      expect(await dialog.locator('h3').evaluateAll(nodes =>
        [...new Set(nodes.map(node => getComputedStyle(node).position))])).toEqual(['static'])
      await page.keyboard.press('Escape')
      await expect.poll(() => dialog.count()).toBe(0)
      expect(await page.locator('[aria-label="/model 选项"]').count()).toBe(0)
      await page.keyboard.press('Escape')
      await page.locator('[data-composer-input]').first().fill('')
    } finally {
      if (await page.locator(COMMAND_POPUP).count()) await page.keyboard.press('Escape')
      if (await modelsDialog(page).count()) await page.keyboard.press('Escape')
      await page.evaluate(({ platform, theme }) => {
        if (platform === null) document.documentElement.removeAttribute('data-platform')
        else document.documentElement.setAttribute('data-platform', platform)
        if (theme === null) document.body.removeAttribute('data-ds-dark-theme')
        else document.body.setAttribute('data-ds-dark-theme', theme)
      }, attributes)
    }
  })

  it('writes the switched model as the default and leaves a logged session alone', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-default-model'))
    // A session that has already run a turn, spelled as the fact a turn
    // leaves behind: its own logged route.
    const loggedId = await createSession('default-model-logged')
    scaffold.ctx.sessions.get(SessionId(loggedId))?.append('request/header', {
      header: { config: { provider: START_ROUTE, model: START_MODEL } },
      reason: 'initial',
    })

    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    const dialog = modelsDialog(page)
    await dialog.waitFor()
    // Page-sized: the catalog dialog is larger than the composer it covers,
    // unlike the old anchored dropdown.
    const dialogBounds = await dialog.boundingBox()
    const composerBounds = await page.locator('[data-composer-card]').first().boundingBox()
    expect(dialogBounds!.width).toBeGreaterThan(composerBounds!.width)
    expect(dialogBounds!.height).toBeGreaterThan(composerBounds!.height)

    const search = dialogSearch(dialog)
    const rows = dialogRows(dialog)
    await expect.poll(() => rows.count()).toBe(5)
    const rowIds = await rows.evaluateAll(nodes => nodes.map(row => row.id))
    const initialHighlight = await rows.evaluateAll(nodes =>
      nodes.findIndex(row => row.hasAttribute('data-highlighted')))
    expect(initialHighlight).toBeGreaterThanOrEqual(0)
    // The dialog keeps the keyboard on search while ↑/↓ move the highlighted
    // row and wrap around the catalog.
    for (let step = 1; step <= rowIds.length + 1; step++) {
      await search.press('ArrowDown')
      expect(await rows.evaluateAll(nodes =>
        nodes.findIndex(row => row.hasAttribute('data-highlighted')))).toBe((initialHighlight + step) % rowIds.length)
      expect(await search.evaluate(input => input === input.ownerDocument.activeElement)).toBe(true)
    }
    await search.press('ArrowUp')
    expect(await rows.evaluateAll(nodes =>
      nodes.findIndex(row => row.hasAttribute('data-highlighted')))).toBe(initialHighlight)

    await search.fill('zzzz')
    await page.getByText('没有匹配的模型。', { exact: true }).waitFor()
    await dialog.getByRole('button', { name: '清除搜索', exact: true }).click()
    expect(await search.inputValue()).toBe('')
    expect(await search.evaluate(input => input === input.ownerDocument.activeElement)).toBe(true)
    expect(await dialogRows(dialog).count()).toBe(rowIds.length)
    expect(await dialog.getByRole('button', { name: '清除搜索', exact: true }).count()).toBe(0)
    await search.fill('  ACMLG  ')
    expect(await dialogRows(dialog).allTextContents()).toEqual(['Acme Large'])
    expect(await dialog.locator('section[aria-label="DeepSeek"]').count()).toBe(0)
    expect(await dialog.locator('section[aria-label="搜索结果"]').count()).toBe(1)
    await compareOrRefreshGolden(
      fileURLToPath(new URL('./expected/default-model/search.expected.md', import.meta.url)),
      await captureStableAria(page, '[role="dialog"][aria-label="模型与推理等级"]', scaffold.workspaceCwd),
      webSnapshotMode(),
    )
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const blocked = scaffold.ctx.hmr.runExclusive(async () => {
      entered.resolve(undefined)
      await release.promise
    })
    try {
      await entered.promise
      await search.press('ArrowDown')
      await expect.poll(() => search.evaluate(input => input === input.ownerDocument.activeElement)).toBe(true)
      expect(await dialogRows(dialog).evaluateAll(nodes =>
        nodes.findIndex(row => row.hasAttribute('data-highlighted')))).toBe(0)
      await page.keyboard.press('Enter')
      await expect.poll(() => trigger.getAttribute('aria-busy')).toBe('false')
      await expect.poll(() => trigger.textContent()).toContain('Acme Large')
      await expect.poll(() => trigger.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true)
      expect(await trigger.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none')
      expect(await trigger.getAttribute('data-selection-focus')).toBe('')
      expect(scaffold.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: START_ROUTE, model: START_MODEL })
      const aria = await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(fileURLToPath(new URL('./expected/default-model/background-save.expected.md', import.meta.url)), aria, webSnapshotMode())
    } finally {
      release.resolve(undefined)
      await blocked
    }

    // The switch is what sets the default: the shared Agent-route settings section
    // now names it, beside the provider profiles the Models page writes.
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'),
      { timeout: 10_000 },
    ).toContain('id: agent-default-model')
    const document = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
    expect(document).toContain(`provider: ${ROUTE}`)
    expect(document).toContain(`model: ${MODEL}`)

    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection())
      .toEqual({ provider: ROUTE, model: MODEL })
    // A session created after the switch starts from it...
    expect(await currentOf(await createSession('default-model-after')))
      .toEqual({ provider: ROUTE, model: MODEL })
    // ...while the one holding a logged route keeps deriving from its log.
    expect(await currentOf(loggedId)).toEqual({ provider: START_ROUTE, model: START_MODEL })
    // Leaving the seat clears the selection-focus marker so the next focus ring
    // is a normal keyboard one.
    await trigger.press('Tab')
    expect(await trigger.getAttribute('data-selection-focus')).toBeNull()
    await trigger.focus()
    expect(await trigger.evaluate(element => element.matches(':focus-visible'))).toBe(true)
    expect(await trigger.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('retains the saved route and editable composer when its provider is removed', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-default-model-blocked'))
    const box = page.locator('[data-composer-input]').first()
    await expect.poll(async () => box.isEnabled(), { timeout: 10_000 }).toBe(true)

    // Removing the selected provider preserves the other route and the saved
    // selection. A merge update would retain the removed profile.
    await scaffold.ctx.settings.replace('llm-pi-ai', { providers: {
      [START_ROUTE]: { displayName: 'Origin Gateway', api: 'openai-completions',
        baseURL: 'https://gateway.origin.example/v1', models: [{ id: START_MODEL, name: 'Origin Large' }] },
    } })

    const seat = page.getByRole('button', { name: '请选择模型', exact: true })
    await seat.waitFor()
    expect(await box.isEnabled()).toBe(true)
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toMatchObject({ provider: ROUTE, model: MODEL })
    const aria = await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/default-model/unselected.expected.md', import.meta.url)), aria, webSnapshotMode())
    await seat.click()
    const dialog = modelsDialog(page)
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Origin Large', exact: true }).click()
    await expect.poll(() => dialog.count()).toBe(0)
    await expect.poll(async () => box.isEnabled(), { timeout: 15_000 }).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
