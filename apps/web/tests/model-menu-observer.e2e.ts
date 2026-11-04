/**
 * Built-profile browser coverage for the vendor-grouped model surfaces: the
 * /model popup keeps the shared sticky MenuGroup headings, the composer dialog
 * keeps plain sections, and only their synchronous group rect reads are counted
 * — not FPS or latency.
 */
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium, webkit } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

declare global {
  interface Window {
    /** Test-private count for MenuGroup sections and their direct scroll viewport. */
    __modelMenuRectReads: number
  }
}

const OVERLAY = fileURLToPath(new URL('./default-model.overlay.yml', import.meta.url))

/** One route per vendor family, plus the scenario's starting route. */
const PROVIDERS = [
  {
    id: 'origin-gateway',
    name: 'Origin Gateway',
    models: [
      { id: 'origin-large', name: 'Origin Large', reasoningEfforts: {
        off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
      } },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `claude-opus-${String(6 - index)}`, name: `Claude Opus ${String(6 - index)}`,
      })),
    ],
  },
  {
    id: 'amber-gateway',
    name: 'Amber Gateway',
    models: Array.from({ length: 7 }, (_, index) => ({
      id: `gpt-5.${String(7 - index)}`, name: `GPT-5.${String(7 - index)}`,
    })),
  },
  {
    id: 'cedar-gateway',
    name: 'Cedar Gateway',
    models: Array.from({ length: 7 }, (_, index) => ({
      id: `grok-4.${String(7 - index)}`, name: `Grok 4.${String(7 - index)}`,
    })),
  },
  {
    id: 'quartz-gateway',
    name: 'Quartz Gateway',
    models: Array.from({ length: 7 }, (_, index) => ({
      id: `gemini-3.${String(7 - index)}`, name: `Gemini 3.${String(7 - index)}`,
    })),
  }]

/**
 * Expected vendor sections and their rows. Rows are ordered by version
 * descending with alias ids folded away, and the two shipped DeepSeek rows
 * sort longest-first.
 */
const EXPECTED_SECTIONS = new Map<string, string[]>([
  ['Anthropic', Array.from({ length: 6 }, (_, index) => `Claude Opus ${String(6 - index)}`)],
  ['DeepSeek', ['DeepSeek-V4-Flash-Vision-Exp', 'DeepSeek-V4-Flash']],
  ['Google', Array.from({ length: 7 }, (_, index) => `Gemini 3.${String(7 - index)}`)],
  ['OpenAI', Array.from({ length: 7 }, (_, index) => `GPT-5.${String(7 - index)}`)],
  ['Other', ['Origin Large']],
  ['xAI', Array.from({ length: 7 }, (_, index) => `Grok 4.${String(7 - index)}`)],
])

/** Colored vendors ship an image mark; monochrome ones mask to `currentColor`; Other has none. */
const EXPECTED_MARKS: Readonly<Record<string, string | null>> = {
  Anthropic: 'img', DeepSeek: 'img', Google: 'img', OpenAI: 'mask', Other: null, xAI: 'mask',
}

/** Vendor rows rendered per section (the total catalog size). */
const ROW_COUNT = [...EXPECTED_SECTIONS.values()].reduce((total, rows) => total + rows.length, 0)

/** Native IO/RO callbacks need rendering opportunities, not elapsed-time sleeps. */
async function frames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => { requestAnimationFrame(() => { resolve() }) })
  }))
}

/** The dialog the composer model seat opens. */
const modelsDialog = (page: Page): Locator => page.getByRole('dialog', { name: '模型与推理等级', exact: true })

/**
 * Read the dialog's plain sections, their brand mark, and their rows.
 * @param dialog - the open model dialog.
 * @returns one entry per section in render order.
 */
async function readSections(dialog: Locator): Promise<{ label: string; mark: string | null; rows: string[] }[]> {
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
 * Read the open dialog's filled box, its card grid, and whether any catalog
 * name is clipped by its row.
 * @param dialog - the open model dialog.
 * @returns the dialog box, the available modal area, and the card-grid metrics.
 */
async function readDialogLayout(dialog: Locator): Promise<{
  width: number
  height: number
  availableWidth: number
  availableHeight: number
  columns: number
  cardWidth: number
  clippedNames: string[]
  nameLineClamp: string
  nameWhiteSpace: string
}> {
  return await dialog.evaluate((node) => {
    const root = node.parentElement
    if (root === null) throw new Error('modal root missing')
    const rootStyle = getComputedStyle(root)
    const availableWidth = root.clientWidth - parseFloat(rootStyle.paddingLeft) - parseFloat(rootStyle.paddingRight)
    const availableHeight = root.clientHeight - parseFloat(rootStyle.paddingTop) - parseFloat(rootStyle.paddingBottom)
    const rect = node.getBoundingClientRect()
    const groups = node.querySelector('[role="group"][aria-label="模型"]')
    if (groups === null) throw new Error('model sections missing')
    // Chip rows have their own wrapper; the card grid is the remaining row parent.
    const cards = [...groups.querySelectorAll<HTMLElement>('button[aria-pressed]')]
      .filter(button => (button.parentElement?.className ?? '').includes('grid'))
    const grid = cards[0]?.parentElement
    if (grid === null || grid === undefined) throw new Error('model grid missing')
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
    const names = cards.map((card) => {
      const name = card.querySelector<HTMLElement>('span[class*="modelName"]')
      if (name === null) throw new Error('model name missing')
      return { name, text: name.textContent ?? '' }
    })
    const clippedNames = names
      .filter(({ name }) => name.scrollWidth > name.clientWidth + 1 || name.scrollHeight > name.clientHeight + 2)
      .map(({ text }) => text)
    const firstStyle = getComputedStyle(names[0]!.name)
    return {
      width: rect.width,
      height: rect.height,
      availableWidth,
      availableHeight,
      columns,
      cardWidth: cards[0]!.getBoundingClientRect().width,
      clippedNames,
      nameLineClamp: firstStyle.getPropertyValue('-webkit-line-clamp').trim(),
      nameWhiteSpace: firstStyle.whiteSpace,
    }
  })
}

/**
 * Read the popup's sticky groups, the mark in their heading's leading slot, and rows.
 * @param popup - the open /model popup.
 * @returns one entry per group in render order.
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
  const popup = page.locator('[aria-label="/model 选项"]')
  await popup.getByRole('option').first().waitFor()
  return popup
}

function readPinned(viewport: Locator) {
  return viewport.locator('[data-menu-group-heading]').evaluateAll(headings =>
    headings.map(heading => heading.hasAttribute('data-stuck')))
}

async function assertNoRectReads(page: Page): Promise<void> {
  await frames(page)
  expect(await page.evaluate(() => window.__modelMenuRectReads)).toBe(0)
}

async function assertPinned(page: Page, viewport: Locator, index: number, count: number): Promise<void> {
  const expected = Array.from({ length: count }, (_, i) => i === index)
  await expect.poll(() => readPinned(viewport)).toEqual(expected)
  await assertNoRectReads(page)
  expect(await readPinned(viewport)).toEqual(expected)
}

async function scrollToGroup(viewport: Locator, index: number, inside = 1): Promise<void> {
  // Sections share an offset parent. Their normal-flow offsets are test positioning, not rect instrumentation.
  await viewport.evaluate((node, target) => new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      const groups = node.querySelectorAll<HTMLElement>(':scope > [data-menu-group]')
      node.scrollTop = groups[target.index]!.offsetTop - groups[0]!.offsetTop + target.inside
      resolve()
    })
  }), { index, inside })
}

describe.skipIf(webSnapshotMode() === 'record').each([
  { name: 'Chromium', engine: chromium },
  { name: 'WebKit', engine: webkit },
])('web e2e: model menu observers ($name)', ({ engine }) => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    // Catalog-only settings traffic: no prompt, selection, replay fixture, or model request.
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: Object.fromEntries(PROVIDERS.map(provider => [provider.id, {
        displayName: provider.name,
        api: 'openai-completions',
        baseURL: `https://${provider.id}.example/v1`,
        models: provider.models,
      }])),
    })
    browser = await engine.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    await page.addInitScript(() => {
      window.__modelMenuRectReads = 0
      /** The native measurement, read off the prototype descriptor to keep its receiver explicit. */
      const nativeRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')?.value as
        ((this: Element) => DOMRect) | undefined
      Element.prototype.getBoundingClientRect = function (): DOMRect {
        if (this.hasAttribute('data-menu-group') || [...this.children].some(child => child.hasAttribute('data-menu-group'))) {
          window.__modelMenuRectReads++
        }
        if (nativeRect === undefined) throw new Error('getBoundingClientRect descriptor missing')
        return nativeRect.call(this)
      }
    })
    page.on('crash', () => { console.error('observer test page crashed') })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  })

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('groups both pickers by vendor and keeps sticky headings, highlights and rect reads owned by the popup', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-model-menu-observer-${engine.name()}`))
    const composer = page.locator('[data-composer-input]').first()
    const trigger = page.getByRole('button', { name: /^选择模型/ })

    await trigger.click()
    const dialog = modelsDialog(page)
    await dialog.waitFor()
    const dialogSearch = dialog.getByRole('searchbox', { name: '搜索模型…', exact: true })
    await expect.poll(() => dialog.locator('section').count()).toBe(EXPECTED_SECTIONS.size)
    const sections = await readSections(dialog)
    expect(sections.map(section => section.label).sort()).toEqual([...EXPECTED_SECTIONS.keys()].sort())
    for (const section of sections) {
      expect(section.rows, section.label).toEqual(EXPECTED_SECTIONS.get(section.label))
      // Brand marks live inside the dialog heading, not a MenuGroup leading slot.
      expect(section.mark, section.label).toBe(EXPECTED_MARKS[section.label])
    }
    // The dialog never renders the popup's sticky machinery.
    expect(await dialog.locator('[data-menu-group], [data-menu-group-heading], [data-menu-group-leading]').count()).toBe(0)
    expect(await dialog.locator('[data-stuck]').count()).toBe(0)
    expect(await dialogSearch.evaluate(node => node === node.ownerDocument.activeElement)).toBe(true)
    await assertNoRectReads(page)

    const rows = dialog.locator('[role="group"][aria-label="模型"] button[aria-pressed]')
    expect(await rows.count()).toBe(ROW_COUNT)
    const pressed = await rows.evaluateAll(nodes =>
      nodes.findIndex(node => node.getAttribute('aria-pressed') === 'true'))
    expect(pressed).toBeGreaterThanOrEqual(0)
    // The current row starts highlighted; ↑/↓ move the highlight while search
    // keeps the keyboard.
    expect(await rows.evaluateAll(nodes =>
      nodes.findIndex(node => node.hasAttribute('data-highlighted')))).toBe(pressed)
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => rows.evaluateAll(nodes =>
      nodes.findIndex(node => node.hasAttribute('data-highlighted')))).toBe((pressed + 1) % ROW_COUNT)
    expect(await dialogSearch.evaluate(node => node === node.ownerDocument.activeElement)).toBe(true)
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => rows.evaluateAll(nodes =>
      nodes.findIndex(node => node.hasAttribute('data-highlighted')))).toBe(pressed)
    await assertNoRectReads(page)

    // Search collapses the dialog to one unmarked results section.
    await dialogSearch.fill('Opus 6')
    await expect.poll(() => readSections(dialog))
      .toEqual([{ label: '搜索结果', mark: null, rows: ['Claude Opus 6'] }])
    await assertNoRectReads(page)
    await dialogSearch.fill('')
    await page.keyboard.press('Escape')
    await expect.poll(() => dialog.count()).toBe(0)
    await assertNoRectReads(page)

    // The popup uses the same vendor sections, but its headings are MenuGroups
    // with a leading brand mark and sticky material.
    const popup = await openCommandPopup(page)
    // Park the pointer outside the card: hovering a row sets the popup's
    // virtual highlight, which would race the keyboard walk below.
    await page.mouse.move(0, 0)
    const popupSearch = page.getByRole('textbox', { name: '筛选选项', exact: true })
    const viewport = popup.getByRole('listbox')
    const headings = popup.locator('[data-menu-group-heading]')
    const groups = await readPopupGroups(popup)
    expect(groups.map(group => group.label).sort()).toEqual(sections.map(section => section.label).sort())
    for (const group of groups) {
      expect(group.rows, group.label).toEqual(EXPECTED_SECTIONS.get(group.label))
      expect(group.leading, group.label).toBe(group.label !== 'Other')
    }
    expect(await headings.count()).toBe(EXPECTED_SECTIONS.size)
    // Only the popup owns sticky headings; the picker's dialog sections never do.
    await viewport.evaluate((node) => { node.style.maxHeight = '80px'; node.scrollTop = 0 })
    await expect.poll(() => readPinned(viewport)).toEqual(Array.from({ length: EXPECTED_SECTIONS.size }, () => false))
    await assertNoRectReads(page)
    await scrollToGroup(viewport, 2)
    await assertPinned(page, viewport, 2, EXPECTED_SECTIONS.size)
    await scrollToGroup(viewport, 4)
    await assertPinned(page, viewport, 4, EXPECTED_SECTIONS.size)
    await scrollToGroup(viewport, 0, 0)
    await assertPinned(page, viewport, -1, EXPECTED_SECTIONS.size)

    // Keyboard navigation keeps the virtual highlight in view; sticky
    // observation stays consistent throughout and never reads a rect
    // synchronously.
    const options = popup.getByRole('option')
    const activeIndex = () => options.evaluateAll(nodes =>
      nodes.findIndex(node => node.getAttribute('aria-selected') === 'true'))
    const active = await activeIndex()
    expect(active).toBeGreaterThanOrEqual(0)
    for (let step = 1; step <= 6; step++) {
      await popupSearch.press('ArrowDown')
      await expect.poll(activeIndex).toBe((active + step) % ROW_COUNT)
      await frames(page)
      await expect.poll(() => viewport.evaluate((node) => {
        const groups = [...node.querySelectorAll<HTMLElement>(':scope > [data-menu-group]')]
        const base = groups[0]!.offsetTop
        return groups.every((group) => {
          const top = group.offsetTop - base
          const shouldStick = top < node.scrollTop && top + group.offsetHeight > node.scrollTop
          return group.querySelector('[data-menu-group-heading]')!.hasAttribute('data-stuck') === shouldStick
        })
      })).toBe(true)
      expect(await popupSearch.evaluate(node => node === node.ownerDocument.activeElement)).toBe(true)
      await assertNoRectReads(page)
    }
    await popupSearch.press('ArrowUp')
    await expect.poll(activeIndex).toBe((active + 5) % ROW_COUNT)

    // The popup filters inside the surviving vendor group, not into a results
    // section of its own.
    await popupSearch.fill('Opus 6')
    await expect.poll(() => readPopupGroups(popup))
      .toEqual([{ label: 'Anthropic', leading: true, rows: ['Claude Opus 6'] }])
    await assertNoRectReads(page)
    await popupSearch.fill('')
    await viewport.evaluate((node) => { node.style.maxHeight = ''; node.scrollTop = 0 })

    // Picking from the popup updates the shared session model, and the dialog
    // shows the same row as current on its next open.
    await popup.getByRole('option', { name: 'Claude Opus 6', exact: true }).click()
    await expect.poll(() => popup.count()).toBe(0)
    await expect.poll(() => trigger.textContent()).toContain('Claude Opus 6')
    expect(scaffold.ctx.agentDefaultModel.currentSelection())
      .toEqual({ provider: 'origin-gateway', model: 'claude-opus-6' })
    await trigger.click()
    await dialog.waitFor()
    // History now ranks a leading recent section; the vendor sections and rows
    // are unchanged.
    const reopened = (await readSections(dialog)).filter(section => EXPECTED_SECTIONS.has(section.label))
    expect(reopened).toEqual(sections)
    const pressedRows = dialog.locator('button[aria-pressed="true"]')
    expect(await pressedRows.count()).toBeGreaterThanOrEqual(1)
    expect(await pressedRows.first().textContent()).toBe('Claude Opus 6')
    expect(await pressedRows.first().evaluate(node => node.hasAttribute('data-highlighted'))).toBe(true)
    await assertNoRectReads(page)
    await page.keyboard.press('Escape')
    await expect.poll(() => dialog.count()).toBe(0)

    const reopenedPopup = await openCommandPopup(page)
    await page.mouse.move(0, 0)
    expect(await reopenedPopup.locator('[role="option"][aria-selected="true"]').textContent()).toBe('Claude Opus 6')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await composer.fill('')
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('fills the viewport and keeps catalog names readable across desktop sizes', async () => {
    onTestFailed(() => saveFailureShot(page, `web-e2e-model-layout-${engine.name()}`))
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    const dialog = modelsDialog(page)
    const viewports = [
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
    ]
    const columns: number[] = []
    for (const viewport of viewports) {
      const at = `${String(viewport.width)}x${String(viewport.height)}`
      await page.setViewportSize(viewport)
      await trigger.click()
      await dialog.waitFor()
      await expect.poll(() => dialog.locator('[role="group"][aria-label="模型"] section').count()).toBeGreaterThan(0)
      const layout = await readDialogLayout(dialog)
      expect(Math.abs(layout.width - Math.min(layout.availableWidth, 2400)), `dialog width at ${at}`)
        .toBeLessThanOrEqual(2)
      expect(Math.abs(layout.height - layout.availableHeight), `dialog height at ${at}`)
        .toBeLessThanOrEqual(2)
      expect(layout.cardWidth, `card width at ${at}`).toBeGreaterThanOrEqual(250)
      expect(layout.clippedNames, `clipped model names at ${at}`).toEqual([])
      expect(layout.nameWhiteSpace, `name wrapping at ${at}`).toBe('normal')
      expect(layout.nameLineClamp, `name clamp at ${at}`).toBe('2')
      columns.push(layout.columns)
      await page.keyboard.press('Escape')
      await expect.poll(() => dialog.count()).toBe(0)
    }
    expect(columns).toEqual([4, 5, 6, 7])
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)})
