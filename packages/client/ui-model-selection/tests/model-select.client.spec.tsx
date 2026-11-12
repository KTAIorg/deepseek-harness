// @vitest-environment jsdom
import * as uiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { RemoteError, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { modelUsageKey } from '../src/client/model-usage.ts'
import { en, zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const renderLabel: ComponentProps<typeof ModelSelect>['renderSlot'] = (_name, _owner, options) => options?.fallback ?? null

const resolveText: ComponentProps<typeof ModelSelect>['resolveText'] = text => typeof text === 'string' ? text : text.en

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

/** Local usage history the seat reads when it mounts. */
const USAGE_KEY = 'dsh.model-selection.usage.v1'

function usageKey(provider: string, model: string): string {
  return modelUsageKey(provider, model)
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        description: 'Fast catalog description',
        reasoning,
      }],
    }],
    failures: [],
    status: 'ready',
    pending: null,
    error: null,
    ...overrides,
  }
}

// The base model stays the newest row; the extras sort after it, newest first.
function modelGroups(count: number): ModelDirectoryState['groups'] {
  const group = state().groups[0]!
  return [{
    ...group,
    models: [
      group.models[0]!,
      ...Array.from({ length: Math.max(0, count - 1) }, (_, index) => {
        const version = count - 1 - index
        return { id: `deepseek-v3-${version}`, name: `DeepSeek V3 ${version}` }
      }),
    ].slice(0, count),
  }]
}

// One model per vendor family, plus a reasoning model to open the effort list.
function searchGroups(): ModelDirectoryState['groups'] {
  return [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'gpt-5.4', name: 'GPT-5.4' },
      ],
    },
    {
      id: 'external',
      name: 'External',
      models: [
        { id: 'claude-opus-4.8', name: 'Claude Opus 4.8' },
        { id: 'claude-opus-5', name: 'Claude Opus 5' },
        { id: 'gemini-2.5-flash', name: 'Gemini Flash' },
      ],
    },
  ]
}

/** The page-sized dialog that replaced the anchored panel. */
function dialog(): HTMLElement {
  return screen.getByRole('dialog', { name: zh['menu.aria'] })
}

function isPanelOpen(): boolean {
  return screen.queryByRole('dialog', { name: zh['menu.aria'] }) !== null
}

/** The modal mask is the aria-hidden sibling inside the dialog's parent. */
function mask(): HTMLElement {
  const found = dialog().parentElement?.querySelector<HTMLElement>('[aria-hidden="true"]')
  if (found === null || found === undefined) throw new Error('modal mask missing')
  return found
}

/** The labelled group holding the model rows; the dialog owns the dialog role. */
function modelGroup(): HTMLElement {
  return screen.getByRole('group', { name: zh['menu.model'] })
}

/** Model rows sit in the group the search field names through aria-controls. */
/** Every model row in the panel, excluding each vendor heading's fold control. */
function modelRows(): HTMLElement[] {
  const controlled = searchBox().getAttribute('aria-controls')
  const group = controlled === null ? null : document.getElementById(controlled)
  return group === null
    ? []
    : within(group).queryAllByRole('button').filter(row => !row.hasAttribute('aria-expanded'))
}

/** Resolve one model row by its accessible name. */
function modelRow(name: string | RegExp): HTMLElement {
  return within(modelGroup()).getByRole('button', { name })
}

/** The effort pane is its own labelled group around the back button and rows. */
function effortGroup(): HTMLElement {
  return screen.getByRole('group', { name: zh['menu.effort'] })
}

/** Effort rows are the toggle buttons after the pane's back button. */
function effortRows(): HTMLElement[] {
  return within(effortGroup()).getAllByRole('button').filter(row => row.hasAttribute('aria-pressed'))
}

/** Resolve one effort level by its accessible name. */
function effortRow(name: string | RegExp): HTMLElement {
  return within(effortGroup()).getByRole('button', { name })
}

function effortChip(): HTMLElement {
  return within(dialog()).getByRole('button', { name: /推理等级/ })
}

function searchBox(): HTMLInputElement {
  return screen.getByRole('searchbox') as HTMLInputElement
}

/** Highlight marks the model row the arrows or hover currently target. */
function highlightedRow(): HTMLElement | undefined {
  return modelRows().find(row => row.hasAttribute('data-highlighted'))
}

function mountOpen(overrides: Partial<ModelDirectoryState> = {}): {
  trigger: HTMLButtonElement
  select: ReturnType<typeof vi.fn>
} {
  const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
  render(<ModelSelect renderSlot={renderLabel}
    locked={false}
    available
    directory={createSnapshotStore(state(overrides))}
    load={vi.fn()}
    resolveText={resolveText}
    select={select}
    t={t}
  />)
  const trigger = screen.getByRole('button', { name: /选择模型/ }) as HTMLButtonElement
  fireEvent.click(trigger)
  return { trigger, select }
}

const scrollIntoView = vi.fn()
beforeEach(() => {
  scrollIntoView.mockClear()
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView })
  onTestFinished(() => {
    if (descriptor === undefined) Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    else Object.defineProperty(Element.prototype, 'scrollIntoView', descriptor)
  })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})


/**
 * Rows inside one section: the fold control on a vendor heading is also a
 * button, and these assertions list model rows.
 * @param scope - section region.
 * @returns its model-row buttons.
 */
function rowsIn(scope: HTMLElement): HTMLElement[] {
  return within(scope).getAllByRole('button').filter(row => !row.hasAttribute('aria-expanded'))
}

describe('ModelSelect modal shell', () => {
  it('moves the trigger into dialog state and closes from the dialog close button', async () => {
    const { trigger } = mountOpen()
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.hasAttribute('aria-controls')).toBe(true)
    const panel = dialog()
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(panel.getAttribute('aria-label')).toBe(zh['menu.aria'])
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe(zh['menu.aria'])

    fireEvent.click(within(panel).getByRole('button', { name: zh['menu.close'] }))
    expect(isPanelOpen()).toBe(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.hasAttribute('aria-controls')).toBe(false)
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('portals the page-sized dialog to body and closes it from the mask', () => {
    const { container } = render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={createSnapshotStore(state())}
      load={vi.fn()} resolveText={resolveText}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.hasAttribute('aria-controls')).toBe(false)
    fireEvent.click(trigger)
    const panel = dialog()
    // Outside the composer subtree — the page-sized dialog covers the window.
    expect(container.contains(panel)).toBe(false)
    expect(panel.parentElement?.parentElement).toBe(document.body)
    // The mask is the aria-hidden sibling of the dialog, and it closes on click.
    expect(mask().parentElement).toBe(panel.parentElement)
    expect(mask().getAttribute('aria-hidden')).toBe('true')
    // Interactions inside the dialog stay open; a mask click dismisses it.
    fireEvent.click(panel)
    expect(isPanelOpen()).toBe(true)
    fireEvent.click(mask())
    expect(isPanelOpen()).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the search field and the model group inside the dialog', () => {
    mountOpen()
    const panel = dialog()
    const search = searchBox()
    expect(panel.contains(search)).toBe(true)
    expect(search.getAttribute('role')).toBe('searchbox')
    expect(search.getAttribute('placeholder')).toBe(zh['search.placeholder'])
    expect(search.getAttribute('aria-label')).toBe(zh['search.placeholder'])
    const group = modelGroup()
    expect(panel.contains(group)).toBe(true)
    expect(group.getAttribute('role')).toBe('group')
    expect(group.getAttribute('aria-label')).toBe(zh['menu.model'])
    expect(search.getAttribute('aria-controls')).toBe(group.id)
    const row = modelRow('DeepSeek-V4-Flash')
    expect(group.contains(row)).toBe(true)
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(row.tabIndex).toBe(-1)
    // The effort entry point is a chip button in the same search bar.
    expect(panel.contains(effortChip())).toBe(true)
    fireEvent.change(search, { target: { value: 'deep' } })
    expect(within(panel).getByRole('button', { name: zh['search.clear'] })).toBeTruthy()
  })

  it('shows the effort pane as its own labelled group with a back button', () => {
    mountOpen()
    fireEvent.click(effortChip())
    const efforts = effortGroup()
    expect(effortRows().map(row => row.textContent)).toEqual(['Off', 'High', 'Max'])
    // The back button names the model pane it returns to.
    fireEvent.click(within(efforts).getByRole('button', { name: zh['menu.model'] }))
    expect(screen.queryByRole('group', { name: zh['menu.effort'] })).toBeNull()
    expect(modelGroup()).toBeTruthy()
    expect(document.activeElement).toBe(searchBox())
  })

  it('returns from the effort list on Escape before closing the dialog', async () => {
    const { trigger } = mountOpen()
    fireEvent.click(effortChip())
    expect(effortGroup()).toBeTruthy()
    expect(screen.queryByRole('group', { name: zh['menu.model'] })).toBeNull()
    fireEvent.keyDown(effortRows()[0]!, { key: 'Escape' })
    // The dialog owns Escape but defers it to its own pane first.
    expect(dialog()).toBeTruthy()
    expect(screen.queryByRole('group', { name: zh['menu.effort'] })).toBeNull()
    expect(modelGroup()).toBeTruthy()
    expect(document.activeElement).toBe(searchBox())
    fireEvent.keyDown(searchBox(), { key: 'Escape' })
    expect(isPanelOpen()).toBe(false)
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })
})

describe('ModelSelect label slot', () => {
  it('distinguishes identical model names and ids by provider on the trigger and rows, and restores labels on unload', async () => {
    const runtime = await SlotTestRuntime.create()
    onTestFinished(() => runtime.dispose())
    const sessionId = SessionId('model-label')
    await runtime.sessions.add({ id: sessionId })
    const session = runtime.sessions.retainFor(runtime.ctx, sessionId)
    const groups = ['trusted', 'external'].map(id => ({
      id, name: `${id} gateway`, models: [{ id: 'same-model', name: 'Same model' }],
    }))
    const directory = createSnapshotStore(state({ groups, current: { provider: 'trusted', model: 'same-model' } }))
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.update((snapshot) => { snapshot.current = selection })
      return { ok: true as const, value: undefined }
    })
    await runtime.root.declare({
      'conversation.input.model.label': { kind: 'single', scope: 'session', inline: true },
    }, ({ renderSlot, SessionProvider }) => <SessionProvider session={session}>
      <ModelSelect locked={false} available directory={directory} load={vi.fn()}
        resolveText={resolveText} select={select} t={t} renderSlot={renderSlot} />
    </SessionProvider>)
    runtime.renderRoot()
    const trigger = screen.getByRole('button', { name: '选择模型，当前 Same model' })
    expect(trigger.textContent).toBe('Same model')
    const plugin = await runtime.mount({ inject: ['slots'], apply(ctx) {
      ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register({
        name: 'conversation.input.model.label',
      }, ({ provider, model, placement, selected }) => <span
        data-testid={`${placement}-${provider.id}`}
        data-selected={selected}
        title={provider.name}
      >{provider.id}: {model.name}</span>))
    } })
    expect(screen.getByTestId('trigger-trusted').textContent).toBe('trusted: Same model')
    expect(screen.getByTestId('trigger-trusted').title).toBe('trusted gateway')
    fireEvent.click(trigger)
    // The dialog opens directly on the model rows; there is no root pane.
    expect(screen.getByTestId('option-trusted').textContent).toBe('trusted: Same model')
    expect(screen.getByTestId('option-external').textContent).toBe('external: Same model')
    expect(screen.getByTestId('option-trusted').getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId('option-external').getAttribute('data-selected')).toBe('false')
    // The model rows sit directly in the dialog; there is no root menu pane.
    expect(screen.queryByRole('menu')).toBeNull()
    expect(dialog().contains(screen.getByTestId('option-trusted'))).toBe(true)
    const external = modelRow('external: Same model')
    expect(external.querySelector('[data-provider-id="external"][data-model-id="same-model"]')).toBeTruthy()
    expect(external.querySelector('[data-slot="conversation.input.model.label"]')).toBeTruthy()
    fireEvent.click(external)
    await waitFor(() => { expect(screen.getByTestId('trigger-external')).toBeTruthy() })
    expect(screen.getByTestId('trigger-external').textContent).toBe('external: Same model')
    expect(select).toHaveBeenCalledWith({ provider: 'external', model: 'same-model' })
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    await act(async () => { await plugin.dispose() })
    expect(runtime.slots.entries('conversation.input.model.label')).toHaveLength(0)
    expect(trigger.textContent).toBe('Same model')
    expect(trigger.querySelector('[data-provider-id="external"][data-model-id="same-model"]')).toBeTruthy()
    // The recorded selection now leads the reopened panel as a recent row.
    fireEvent.click(trigger)
    expect(rowsIn(screen.getByRole('region', { name: zh['menu.recent'] }))
      .map(row => row.textContent)).toEqual(['Same model'])
    expect(rowsIn(screen.getByRole('region', { name: 'Other' }))
      .map(row => row.textContent)).toEqual(['Same model', 'Same model'])
  })

  it('does not decorate loading or missing selections with a stale provider', () => {
    const directory = createSnapshotStore(state({ groups: [], status: 'loading' }))
    const renderSlot = vi.fn(() => null)
    render(<ModelSelect locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={vi.fn()} t={t} renderSlot={renderSlot} />)
    expect(renderSlot).not.toHaveBeenCalled()
    expect(document.querySelector('[data-provider-id]')).toBeNull()
    act(() => { directory.set(state({ groups: [] })) })
    expect(screen.getByRole('button', { name: '请选择模型' })).toBeTruthy()
    expect(renderSlot).not.toHaveBeenCalled()
  })
})

describe('ModelSelect catalog badges', () => {
  const BADGE = { text: { en: 'New', zh: '新' }, tone: 'info' } as const
  const badged = () => state({
    current: { provider: 'deepseek-official', model: 'deepseek-flash' },
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', badge: BADGE },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }],
  })
  const chinese: ComponentProps<typeof ModelSelect>['resolveText'] = text => typeof text === 'string' ? text : text.zh ?? text.en

  it('places the badge before the trigger name and after names in the menus', () => {
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(badged())}
      load={vi.fn()} resolveText={chinese} select={vi.fn()} t={t} />)
    const trigger = screen.getByRole('button', { name: '选择模型，当前 DeepSeek-V4.1-Flash' })
    expect(trigger.textContent).toBe('新 DeepSeek-V4.1-Flash')
    expect(screen.getByText('新').getAttribute('data-tone')).toBe('info')
    fireEvent.click(trigger)
    const current = modelRow(/DeepSeek-V4\.1-Flash/)
    expect(current.textContent).toContain('DeepSeek-V4.1-Flash 新')
    expect(modelRows().map(row => row.textContent)).toEqual(['DeepSeek-V4-Pro', 'DeepSeek-V4.1-Flash 新'])
  })

  it('hands the badge to a label contribution, which replaces the default rendering', async () => {
    const runtime = await SlotTestRuntime.create()
    onTestFinished(() => runtime.dispose())
    const sessionId = SessionId('model-badge')
    await runtime.sessions.add({ id: sessionId })
    const session = runtime.sessions.retainFor(runtime.ctx, sessionId)
    await runtime.root.declare({
      'conversation.input.model.label': { kind: 'single', scope: 'session', inline: true },
    }, ({ renderSlot, SessionProvider }) => <SessionProvider session={session}>
      <ModelSelect locked={false} available directory={createSnapshotStore(badged())} load={vi.fn()} resolveText={chinese}
        select={vi.fn()} t={t} renderSlot={renderSlot} />
    </SessionProvider>)
    runtime.renderRoot()
    await runtime.mount({ inject: ['slots'], apply(ctx) {
      ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register({
        name: 'conversation.input.model.label',
      }, ({ model }) => <span>{model.name} [{model.badge?.tone ?? 'none'}]</span>))
    } })
    expect(screen.getByRole('button', { name: '选择模型，当前 DeepSeek-V4.1-Flash' }).textContent).toBe('DeepSeek-V4.1-Flash [info]')
    expect(screen.queryByText('新')).toBeNull()
  })
})

describe('ModelSelect reasoning effort', () => {
  it('changes the effort from the composer control without opening the model dialog', async () => {
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={createSnapshotStore(state())}
      load={vi.fn()} resolveText={resolveText}
      select={select}
      t={t}
    />)

    const effort = screen.getByRole('button', { name: '推理等级，当前 High' })
    expect(isPanelOpen()).toBe(false)
    fireEvent.click(effort)
    expect(isPanelOpen()).toBe(false)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Max' }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
    })
    expect(isPanelOpen()).toBe(false)
  })

  it('renders effort names without descriptions and submits the effort as part of the session selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return { ok: true as const, value: undefined }
    })
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={directory}
      load={vi.fn()} resolveText={resolveText}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    // The search field takes focus on desktop.
    expect(document.activeElement).toBe(searchBox())
    const chip = effortChip()
    expect(chip.textContent).toContain(zh['menu.effort'])
    expect(chip.textContent).toContain('High')
    // The effort chip shares the dialog's search bar, after the search field.
    expect(searchBox().compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(dialog().contains(chip)).toBe(true)
    fireEvent.click(chip)
    expect(effortRows().map(item => item.textContent))
      .toEqual(['Off', 'High', 'Max'])
    expect(screen.queryByText('Largest budget')).toBeNull()

    fireEvent.click(effortRow(/Max/))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 DeepSeek-V4-Flash，推理等级 Max')
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('offers provider default only when the adapter does not configure a model default', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={directory}
      load={vi.fn()} resolveText={resolveText}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(effortChip())
    expect(effortRows().map(item => item.textContent))
      .toEqual(['Default', 'Standard'])
  })

  it('opens the model rows without exposing a saved route absent from the catalog', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={directory}
      load={vi.fn()} resolveText={resolveText}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '请选择模型' })
    expect(trigger.textContent).toBe('请选择模型')
    fireEvent.click(trigger)
    // No current catalog entry means no reasoning metadata, hence no Effort row.
    expect(within(dialog()).queryByRole('button', { name: /推理等级/ })).toBeNull()
    expect(within(modelGroup()).queryByRole('button', { name: 'removed-model' })).toBeNull()
    expect(modelRow('DeepSeek-V4-Flash')).toBeTruthy()
    expect(screen.queryByText('Fast catalog description')).toBeNull()
    expect(select).not.toHaveBeenCalled()
    expect(directory.getSnapshot().current).toEqual({ provider: 'deepseek-official', model: 'removed-model' })
    fireEvent.keyDown(searchBox(), { key: 'Escape' })
    expect(isPanelOpen()).toBe(false)
  })

  it.each(['model', 'provider'])('hides the saved id and effort when the selected %s disappears', (removed) => {
    const directory = createSnapshotStore(state({ retainedEffort: 'High' }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={vi.fn()} t={t} />)
    expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent).toContain('DeepSeek-V4-Flash')
    act(() => { directory.update((snapshot) => {
      snapshot.groups = removed === 'provider' ? [] : snapshot.groups.map(group => ({ ...group, models: [] }))
      snapshot.routable = false
    }) })
    const trigger = screen.getByRole('button', { name: '请选择模型' })
    expect(trigger.textContent).toBe('请选择模型')
    expect(directory.getSnapshot().current).toEqual(state().current)
    fireEvent.click(trigger)
    expect(screen.getByRole('status').textContent).toBe(zh['empty.models'])
    expect(within(dialog()).queryByRole('button', { name: /推理等级/ })).toBeNull()
    fireEvent.keyDown(searchBox(), { key: 'Tab', shiftKey: true })
    expect(isPanelOpen()).toBe(false)
  })

  it.each([null, state().current])('shows loading until the catalog and Session projection are both ready (%j)', async (current) => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current,
      routable: null,
      groups: [],
      status: 'loading',
    }))
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={directory}
      load={vi.fn()} resolveText={resolveText}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)

    expect(screen.getByRole('button', { name: '正在加载模型…' }).textContent)
      .toContain('正在加载模型…')
    directory.set(state())
    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
      })).toBeTruthy()
    })
  })

  it.each([false, true])('announces rejected selections with ownership guidance only for held writers (%s)', async (sessionInUse) => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      const error = sessionInUse
        ? new RemoteError('session/writer-held', 'writer held', { sessionId: SessionId('owned') })
        : new RemoteError('session/model-unavailable', 'session already contains images', { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
      directory.set(state({ groups, status: 'error', error: 'unrelated catalog refresh' }))
      return { ok: false as const, error }
    })
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={directory}
      load={vi.fn()} resolveText={resolveText}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: /^选择模型/ })
    fireEvent.click(trigger)
    const rejected = modelRow(/DeepSeek-V4-Pro/)
    fireEvent.mouseMove(rejected)
    fireEvent.click(rejected)
    const toast = await screen.findByRole('alert')
    expect(document.activeElement).toBe(trigger)
    expect(toast.textContent).toBe(sessionInUse
      ? zh['error.sessionInUse']
      : '模型操作失败：session/model-unavailable: session already contains images')
    // The selection failure does not render the in-panel load strip (no Retry).
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
    // The panel stays open on the failure; Tab from the trigger reaches search.
    fireEvent.keyDown(trigger, { key: 'Tab' })
    expect(document.activeElement).toBe(searchBox())
    expect(modelRow(/DeepSeek-V4-Flash/)).toBeTruthy()
  })

  it('spins on the trigger and the chosen model row until the selection settles, across panel changes', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    let settle!: () => void
    const select = vi.fn((selection: ModelSelection) => {
      directory.set(state({ groups, status: 'selecting', pending: selection }))
      return new Promise<{ ok: true; value: undefined }>((resolve) => {
        settle = () => {
          directory.set(state({ groups, current: selection }))
          resolve({ ok: true, value: undefined })
        }
      })
    })
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={select} t={t} />)
    const spinners = () => document.querySelectorAll('[data-state="ongoing"]')

    const trigger = screen.getByRole('button', { name: /^选择模型/ })
    fireEvent.click(trigger)
    fireEvent.click(modelRow(/DeepSeek-V4-Pro/))
    expect(spinners()).toHaveLength(2)
    expect(modelRow(/DeepSeek-V4-Pro/).querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(trigger.querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(trigger.getAttribute('aria-busy')).toBe('true')
    // A pending selection disables every row and freezes the search field.
    expect(modelRow(/DeepSeek-V4-Pro/).hasAttribute('disabled')).toBe(true)
    expect(searchBox().readOnly).toBe(true)
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
    expect(select).toHaveBeenCalledTimes(1)

    // Closing the panel unmounts the row; the trigger keeps the feedback.
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: zh['menu.model'] })).toBeNull()
    expect(spinners()).toHaveLength(1)
    expect(trigger.querySelector('[data-state="ongoing"]')).not.toBeNull()

    await act(async () => { settle() })
    expect(spinners()).toHaveLength(0)
    expect(trigger.getAttribute('aria-busy')).toBe('false')
  })

  it('spins on the chosen effort row only', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn((selection: ModelSelection) => {
      directory.set(state({ status: 'selecting', pending: selection }))
      return new Promise<undefined>(() => {})
    })
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={select} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: /^选择模型/ }))
    fireEvent.click(effortChip())
    fireEvent.click(effortRow(/Max/))
    expect(effortRows()
      .filter(row => row.querySelector('[data-state="ongoing"]') !== null)
      .map(row => row.textContent)).toEqual(['Max'])
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load} resolveText={resolveText}
      select={vi.fn().mockResolvedValue(undefined)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})

describe('ModelSelect keyboard walk', () => {
  it('opens on the search field and closes back to the trigger with Escape or Shift+Tab', async () => {
    const { trigger, select } = mountOpen()
    const search = searchBox()
    expect(document.activeElement).toBe(search)
    expect(fireEvent.keyDown(search, { key: 'Escape' })).toBe(false)
    expect(isPanelOpen()).toBe(false)
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    expect(trigger.hasAttribute('data-selection-focus')).toBe(false)

    fireEvent.click(trigger)
    const reopened = searchBox()
    expect(document.activeElement).toBe(reopened)
    expect(fireEvent.keyDown(reopened, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(isPanelOpen()).toBe(false)
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    expect(select).not.toHaveBeenCalled()
  })

  it('moves the highlighted row with arrows while search keeps the keyboard, wrapping across sections', () => {
    const { select } = mountOpen({ groups: searchGroups() })
    const search = searchBox()
    const rows = modelRows()
    // Sections order by vendor name, so the checked DeepSeek row sits in the
    // middle of the panel: Anthropic (2), DeepSeek (1), Google (1), OpenAI (1).
    expect(rows.map(row => row.textContent))
      .toEqual(['Claude Opus 5', 'Claude Opus 4.8', 'DeepSeek-V4-Flash', 'Gemini Flash', 'GPT-5.4'])
    expect(highlightedRow()).toBe(rows[2])
    expect(rows.every(row => row.tabIndex === -1)).toBe(true)

    // Walking past the last row wraps to the first section.
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(highlightedRow()).toBe(rows[3])
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(highlightedRow()).toBe(rows.at(-1))
    expect(fireEvent.keyDown(search, { key: 'ArrowDown' })).toBe(false)
    expect(document.activeElement).toBe(search)
    expect(highlightedRow()).toBe(rows[0])
    expect(highlightedRow()!.textContent).toBe('Claude Opus 5')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })

    // Walking back up from the first row wraps to the last.
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    expect(highlightedRow()).toBe(rows.at(-1))
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    expect(highlightedRow()).toBe(rows.at(-2))
    expect(document.activeElement).toBe(search)

    // Composition input never advances the highlight.
    fireEvent.keyDown(search, { key: 'ArrowDown', isComposing: true })
    expect(highlightedRow()).toBe(rows.at(-2))
    expect(fireEvent.keyDown(search, { key: 'ArrowLeft' })).toBe(true)
    expect(fireEvent.keyDown(search, { key: 'ArrowRight' })).toBe(true)
    expect(select).not.toHaveBeenCalled()
  })

  it('Tab with the keyboard still on the trigger enters the panel at the search field', () => {
    const { trigger } = mountOpen()
    trigger.focus()
    expect(fireEvent.keyDown(trigger, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(searchBox())
    expect(isPanelOpen()).toBe(true)
    // The checked row is the entry highlight again.
    expect(highlightedRow()!.getAttribute('aria-pressed')).toBe('true')
  })

  it('a step from the trigger moves the highlight and hands the keyboard to search', () => {
    const { trigger } = mountOpen({ groups: searchGroups() })
    const rows = modelRows()
    // The trigger holds focus while the panel opens on desktop; the checked
    // DeepSeek row is the opening highlight, so a forward step lands on the
    // next row and a backward step on the row before it.
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(searchBox())
    expect(highlightedRow()).toBe(rows[3])
    fireEvent.keyDown(searchBox(), { key: 'Escape' })
    fireEvent.click(trigger)
    const reopenedRows = modelRows()
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(searchBox())
    expect(highlightedRow()).toBe(reopenedRows[1])
  })

  it('focuses the checked effort level and walks the list with arrows', () => {
    mountOpen()
    fireEvent.click(effortChip())
    const rows = effortRows()
    expect(rows.map(row => row.textContent)).toEqual(['Off', 'High', 'Max'])
    // The panel opens on the value in use.
    expect(rows[1]!.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[2])
    fireEvent.keyDown(rows[2]!, { key: 'ArrowDown' }) // wraps to the top
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0]!, { key: 'ArrowUp' }) // wraps to the bottom
    expect(document.activeElement).toBe(rows[2])
    expect(isPanelOpen()).toBe(true)
  })

  it('Tab on a focused row settles it like Enter and closes the panel', async () => {
    const { select } = mountOpen()
    fireEvent.click(effortChip())
    const rows = effortRows()
    fireEvent.keyDown(rows[1]!, { key: 'ArrowDown' }) // High → Max
    expect(document.activeElement).toBe(rows[2])
    expect(fireEvent.keyDown(rows[2]!, { key: 'Tab' })).toBe(false)
    expect(select).toHaveBeenCalledWith({
      provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max',
    })
    await waitFor(() => { expect(isPanelOpen()).toBe(false) })
  })

  it('Escape leaves the effort list for the model panel with search focused, then closes', async () => {
    const { trigger } = mountOpen()
    fireEvent.click(effortChip())
    fireEvent.keyDown(effortRows()[0]!, { key: 'Escape' })
    // The model panel is back, and desktop focus returns to its search field.
    expect(screen.getByRole('dialog', { name: zh['menu.aria'] })).toBeTruthy()
    expect(document.activeElement).toBe(searchBox())
    fireEvent.keyDown(searchBox(), { key: 'Escape' })
    expect(isPanelOpen()).toBe(false)
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('Shift+Tab leaves the effort list and then closes the panel, like Escape', async () => {
    const { trigger } = mountOpen()
    fireEvent.click(effortChip())
    const rows = effortRows()
    expect(fireEvent.keyDown(rows[0]!, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(screen.getByRole('dialog', { name: zh['menu.aria'] })).toBeTruthy()
    expect(document.activeElement).toBe(searchBox())
    fireEvent.keyDown(searchBox(), { key: 'Tab', shiftKey: true })
    expect(isPanelOpen()).toBe(false)
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('Tab on a programmatically focused model row activates it', async () => {
    const { select } = mountOpen({ groups: modelGroups(2) })
    const row = modelRow('DeepSeek V3 1')
    act(() => { row.focus() })
    expect(document.activeElement).toBe(row)
    expect(highlightedRow()).toBe(row)
    expect(fireEvent.keyDown(row, { key: 'Tab' })).toBe(false)
    expect(select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'deepseek-v3-1' })
    await waitFor(() => { expect(isPanelOpen()).toBe(false) })
  })

  it('prevents button mousedown defaults on the Effort row and model rows without selecting', () => {
    const { select } = mountOpen()
    const chip = effortChip()
    expect(fireEvent.mouseDown(chip.firstElementChild!)).toBe(false)
    fireEvent.click(chip)
    const levels = effortRows()
    const focused = document.activeElement
    expect(fireEvent.mouseDown(levels[0]!.firstElementChild!)).toBe(false)
    fireEvent.mouseUp(screen.getByRole('dialog', { name: zh['menu.aria'] }))
    expect(select).not.toHaveBeenCalled()
    fireEvent.keyDown(focused!, { key: 'Escape' })
    expect(document.activeElement).toBe(searchBox())
    const row = modelRow('DeepSeek-V4-Flash')
    expect(fireEvent.mouseDown(row.firstElementChild!)).toBe(false)
    expect(select).not.toHaveBeenCalled()
  })

  it('keeps the card navigable when the catalog has no rows, and leaves a retry its Tab', async () => {
    const load = vi.fn()
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups: [],
      failures: [{ id: 'external', name: 'External', message: 'socket closed' }],
      status: 'error',
      error: 'catalog down',
    }))
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={directory}
      load={load}
      resolveText={resolveText}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    // The search field is always rendered, even when no row can be offered.
    expect(searchBox()).toBeInstanceOf(HTMLInputElement)
    expect(document.activeElement).toBe(searchBox())
    expect(screen.getByText('模型操作失败：catalog down')).toBeTruthy()
    expect(screen.getByText('External 加载失败：socket closed')).toBeTruthy()

    const retries = screen.getAllByRole('button', { name: '重试' })
    expect(fireEvent.mouseDown(retries[0]!)).toBe(false)
    fireEvent.click(retries[0]!)
    expect(load).toHaveBeenCalledTimes(2)
    expect(isPanelOpen()).toBe(true)
    // A control that is not a row keeps the dialog's traversal.
    retries[0]!.focus()
    expect(fireEvent.keyDown(retries[0]!, { key: 'Tab' })).toBe(true)
    fireEvent.keyDown(retries[0]!, { key: 'Escape' })
    expect(isPanelOpen()).toBe(false)
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it.each([
    { device: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 },
    { device: 'desktop-mode iPad', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 },
  ].flatMap(device => [1, 5].map(modelCount => ({ ...device, modelCount }))))(
    'keeps the $device dialog focus off search with $modelCount models until explicit input',
    async ({ userAgent, platform, maxTouchPoints, modelCount }) => {
      for (const [name, value] of Object.entries({ userAgent, platform, maxTouchPoints })) {
        const descriptor = Object.getOwnPropertyDescriptor(navigator, name)
        Object.defineProperty(navigator, name, { configurable: true, value })
        onTestFinished(() => {
          if (descriptor === undefined) Reflect.deleteProperty(navigator, name)
          else Object.defineProperty(navigator, name, descriptor)
        })
      }
      vi.resetModules()
      const detection = await import('@deepseek-ai/dsh-client-ui-primitives/src/focus.ts')
      const device = vi.spyOn(uiPrimitives, 'isMobileDevice').mockImplementation(detection.isMobileDevice)
      onTestFinished(() => { device.mockRestore() })
      const select = vi.fn()
      render(<ModelSelect renderSlot={renderLabel} locked={false} available
        directory={createSnapshotStore(state({ groups: modelGroups(modelCount) }))}
        load={vi.fn()} resolveText={resolveText} select={select} t={t}
      />)
      const trigger = screen.getByRole('button', { name: /选择模型/ })
      fireEvent.click(trigger)
      const search = searchBox()
      // The dialog takes focus, but a mobile client is spared the keyboard.
      expect(dialog().contains(document.activeElement)).toBe(true)
      expect(document.activeElement).not.toBe(search)
      expect(search.value).toBe('')

      // Only explicit input reaches the search field on mobile.
      act(() => { search.focus() })
      expect(document.activeElement).toBe(search)
      expect(fireEvent.keyDown(search, { key: 'ArrowDown' })).toBe(false)
      expect(document.activeElement).toBe(search)
      expect(modelRows().filter(row => row.hasAttribute('data-highlighted'))).toHaveLength(1)
      fireEvent.keyDown(search, { key: 'Escape' })
      await waitFor(() => { expect(document.activeElement).toBe(trigger) })
      expect(isPanelOpen()).toBe(false)

      // The effort list focuses its checked level; Escape returns to the model pane.
      fireEvent.click(trigger)
      fireEvent.click(effortChip())
      const high = effortRow('High')
      const max = effortRow(/Max/)
      expect(document.activeElement).toBe(high)
      fireEvent.keyDown(high, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(max)
      fireEvent.keyDown(max, { key: 'Escape' })
      expect(dialog()).toBeTruthy()
      expect(screen.queryByRole('group', { name: zh['menu.effort'] })).toBeNull()
      expect(modelGroup()).toBeTruthy()
      // Back on the model pane, mobile does not auto-focus its search field.
      expect(document.activeElement).not.toBe(searchBox())
      expect(select).not.toHaveBeenCalled()
    },
  )
})

describe('ModelSelect catalog size', () => {
  it.each([0, 1, 4, 5])('renders the search field for every catalog size (%i models)', (count) => {
    const groups = modelGroups(count)
    const current = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(state({ groups, current }))}
      load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    const search = searchBox()
    expect(search).toBeInstanceOf(HTMLInputElement)
    expect(document.activeElement).toBe(search)
    const rows = modelRows()
    expect(rows).toHaveLength(count)
    expect(rows.every(row => row.tabIndex === -1)).toBe(true)
    if (count === 0) {
      expect(screen.getByRole('status').textContent).toBe(zh['empty.models'])
      expect(screen.queryByRole('group', { name: zh['menu.model'] })).toBeNull()
      return
    }
    // The checked model is the opening highlight at every size.
    expect(rows[0]!.getAttribute('aria-pressed')).toBe('true')
    expect(highlightedRow()).toBe(rows[0])
  })

  it.each([0, 1, 4, 5])('opens an unselected %i-model catalog on its first row', (count) => {
    render(<ModelSelect renderSlot={renderLabel} locked={false} available
      directory={createSnapshotStore(state({ groups: modelGroups(count), current: null }))}
      load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '请选择模型' }))
    const rows = modelRows()
    expect(rows).toHaveLength(count)
    expect(rows.every(row => row.getAttribute('aria-pressed') === 'false')).toBe(true)
    expect(document.activeElement).toBe(searchBox())
    if (count === 0) return
    expect(highlightedRow()).toBe(rows[0])
  })

  it('keeps the typed query, its focus, and the result status across catalog refreshes', () => {
    const current = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    const directory = createSnapshotStore(state({ groups: modelGroups(5), current }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    const search = searchBox()
    fireEvent.change(search, { target: { value: 'V3 4' } })
    expect(modelRows()).toHaveLength(1)

    // A shrinking catalog no longer unmounts the search field or drops the query.
    act(() => { directory.set(state({ groups: modelGroups(4), current })) })
    expect(screen.getByRole('searchbox')).toBe(search)
    expect(search.value).toBe('V3 4')
    expect(document.activeElement).toBe(search)
    expect(modelRows()).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe(zh['search.empty'])
    expect(screen.queryByRole('group', { name: zh['menu.model'] })).toBeNull()

    act(() => { directory.set(state({ groups: modelGroups(5), current })) })
    expect(screen.getByRole('searchbox')).toBe(search)
    expect(search.value).toBe('V3 4')
    expect(document.activeElement).toBe(search)
    expect(modelRows()).toHaveLength(1)
    expect(modelRow('DeepSeek V3 4')).toBeTruthy()
  })

  it('highlights a hovered row and settles it with Tab from the search field', async () => {
    const { select } = mountOpen({ groups: modelGroups(4) })
    const row = modelRow('DeepSeek V3 2')
    fireEvent.mouseMove(row)
    expect(highlightedRow()).toBe(row)
    expect(document.activeElement).toBe(searchBox())
    expect(fireEvent.keyDown(searchBox(), { key: 'Tab' })).toBe(false)
    expect(select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'deepseek-v3-2' })
    await waitFor(() => { expect(isPanelOpen()).toBe(false) })  })
})

describe('ModelSelect search', () => {
  it('clears the query whenever the panel reopens', () => {
    render(<ModelSelect renderSlot={renderLabel} locked={false} available
      directory={createSnapshotStore(state({ groups: modelGroups(5), current: null }))}
      load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t} />)
    const trigger = screen.getByRole('button', { name: '请选择模型' })
    fireEvent.click(trigger)
    const search = searchBox()
    fireEvent.change(search, { target: { value: 'zzzz' } })
    expect(search.value).toBe('zzzz')
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(isPanelOpen()).toBe(false)
    fireEvent.click(trigger)
    const reopened = searchBox()
    expect(reopened.value).toBe('')
    expect(document.activeElement).toBe(reopened)
    expect(modelRows()).toHaveLength(5)
  })

  it('hides empty vendor sections and announces an empty catalog', () => {
    const directory = createSnapshotStore(state({ groups: [
      ...state().groups, { id: 'empty', name: 'Empty Provider', models: [] },
    ] }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    expect(screen.queryByRole('region', { name: 'Empty Provider' })).toBeNull()
    const sections = screen.getAllByRole('region')
    expect(sections).toHaveLength(1)
    expect(sections[0]!.textContent).toContain('DeepSeek')
    act(() => { directory.set(state({ groups: [] })) })
    expect(screen.getByRole('status').textContent).toBe(zh['empty.models'])
    expect(screen.getByRole('status').closest('[role="group"]')).toBeNull()
    expect(screen.queryByRole('group', { name: zh['menu.model'] })).toBeNull()
  })

  it.each(['Enter', 'Tab'])('returns focus silently after %s accepts the current model, without suppressing later focus', async (key) => {
    const select = vi.fn()
    render(<>
      <button type="button">Outside</button>
      <ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(state({ groups: modelGroups(5) }))}
        load={vi.fn()} resolveText={resolveText} select={select} t={t} />
    </>)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    // The checked model is the opening highlight, so accepting it is a no-op switch.
    fireEvent.keyDown(searchBox(), { key })
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    expect(trigger.hasAttribute('data-selection-focus')).toBe(true)
    expect(select).not.toHaveBeenCalled()
    act(() => { screen.getByRole('button', { name: 'Outside' }).focus() })
    expect(trigger.hasAttribute('data-selection-focus')).toBe(false)
    act(() => { trigger.focus() })
    expect(trigger.hasAttribute('data-selection-focus')).toBe(false)
  })

  it.each(['Enter', 'Tab'])('keeps typing focus while arrows wrap across sections and %s accepts the highlight', async (key) => {
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      groups: searchGroups(),
    }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={select} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    const search = searchBox()
    expect(search).toBeInstanceOf(HTMLInputElement)
    const rows = modelRows()
    expect(highlightedRow()).toBe(rows[2])
    // Walk past the last row to wrap into the first section.
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(highlightedRow()).toBe(rows[3])
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(highlightedRow()).toBe(rows.at(-1))
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(highlightedRow()).toBe(rows[0])
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(highlightedRow()).toBe(rows[1])
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    expect(highlightedRow()).toBe(rows[0])
    expect(document.activeElement).toBe(search)
    expect(rows[0]!.hasAttribute('data-highlighted')).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(fireEvent.keyDown(search, { key: 'ArrowLeft' })).toBe(true)
    expect(fireEvent.keyDown(search, { key: 'ArrowRight' })).toBe(true)

    fireEvent.change(search, { target: { value: 'opus' } })
    expect(highlightedRow()).toBe(modelRow('Claude Opus 5'))
    fireEvent.change(search, { target: { value: 'zzzz' } })
    expect(highlightedRow()).toBeUndefined()
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(select).not.toHaveBeenCalled()
    // Tab with no matching rows neither selects nor leaves the dialog: the
    // dialog keeps the keyboard inside while the picker's search owns nothing.
    fireEvent.keyDown(search, { key: 'Tab' })
    expect(select).not.toHaveBeenCalled()
    expect(dialog().contains(document.activeElement)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    const restored = modelRows()
    expect(highlightedRow()).toBe(restored[0])
    fireEvent.mouseMove(restored[1]!)
    expect(highlightedRow()).toBe(restored[1])
    expect(document.activeElement).toBe(search)
    fireEvent.keyDown(search, { key })
    expect(select).toHaveBeenCalledWith({ provider: 'external', model: 'claude-opus-4.8' })
    await waitFor(() => { expect(isPanelOpen()).toBe(false) })
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    expect(trigger.hasAttribute('data-selection-focus')).toBe(true)
  })

  it('filters model names fuzzily, ranks a results section, clears, and selects a result', async () => {
    const directory = createSnapshotStore(state({ groups: searchGroups() }))
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={select} t={t} />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    const search = searchBox()
    expect(document.activeElement).toBe(search)
    // The search field is outside the rows' group, not a row itself.
    expect(search.closest('[role="group"]')).toBeNull()
    expect(fireEvent.keyDown(search, { key: 'ArrowDown', isComposing: true })).toBe(true)
    expect(document.activeElement).toBe(search)

    fireEvent.change(search, { target: { value: 'opus' } })
    expect(screen.getByRole('region', { name: zh['search.results'] })).toBeTruthy()
    expect(modelRows().map(row => row.textContent))
      .toEqual(['Claude Opus 5', 'Claude Opus 4.8'])
    expect(document.activeElement).toBe(search)
    expect(screen.queryByRole('region', { name: 'Anthropic' })).toBeNull()

    fireEvent.change(search, { target: { value: '  GMFL  ' } })
    expect(modelRows().map(row => row.textContent)).toEqual(['Gemini Flash'])

    fireEvent.change(search, { target: { value: 'zzzz' } })
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(zh['search.empty'])
    expect(status.closest('[role="group"]')).toBeNull()
    expect(screen.queryByRole('group', { name: zh['menu.model'] })).toBeNull()
    expect(fireEvent.keyDown(search, { key: 'ArrowDown' })).toBe(false)
    expect(document.activeElement).toBe(search)

    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    expect(search.value).toBe('')
    expect(document.activeElement).toBe(search)
    expect(screen.queryByRole('button', { name: '清除搜索' })).toBeNull()
    expect(modelRows()).toHaveLength(5)

    // Reopening starts from an empty query and a fully listed catalog.
    fireEvent.change(search, { target: { value: 'gmfl' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    fireEvent.click(trigger)
    const reopened = searchBox()
    expect(reopened.value).toBe('')
    expect(document.activeElement).toBe(reopened)
    expect(modelRows()).toHaveLength(5)

    fireEvent.change(reopened, { target: { value: 'gmfl' } })
    const row = modelRow('Gemini Flash')
    expect(modelGroup().contains(row)).toBe(true)
    fireEvent.keyDown(reopened, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(reopened)
    expect(highlightedRow()).toBe(row)
    fireEvent.keyDown(reopened, { key: 'Tab' })
    await waitFor(() => { expect(isPanelOpen()).toBe(false) })
    expect(select).toHaveBeenCalledWith({ provider: 'external', model: 'gemini-2.5-flash' })
  })
})

describe('ModelSelect recent and frequent sections', () => {
  const groups: ModelDirectoryState['groups'] = [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'gpt-5.3', name: 'GPT-5.3' },
      { id: 'gpt-5.2', name: 'GPT-5.2' },
    ],
  }]

  it('pins recent selections above frequent ones, and still lists every row under its vendor', () => {
    localStorage.setItem(USAGE_KEY, JSON.stringify({
      recents: [usageKey('deepseek-official', 'gpt-5.2')],
      counts: {
        [usageKey('deepseek-official', 'gpt-5.2')]: 2,
        [usageKey('deepseek-official', 'gpt-5.3')]: 5,
      },
    }))
    mountOpen({ groups, current: null })

    expect(rowsIn(screen.getByRole('region', { name: zh['menu.recent'] }))
      .map(row => row.textContent)).toEqual(['GPT-5.2'])
    expect(rowsIn(screen.getByRole('region', { name: zh['menu.frequent'] }))
      .map(row => row.textContent)).toEqual(['GPT-5.3'])
    // The pinned rows do not displace the vendor section's complete listing.
    expect(rowsIn(screen.getByRole('region', { name: 'OpenAI' }))
      .map(row => row.textContent))
      .toEqual(['GPT-5.4', 'GPT-5.3', 'GPT-5.2'])
    // Pinned sections lead the panel, recent before frequent.
    const headings = screen.getAllByRole('region').map(section => section.getAttribute('aria-label'))
    expect(headings).toEqual([zh['menu.recent'], zh['menu.frequent'], 'OpenAI'])
  })

  it('leads the next open with the model just selected and persists it locally', async () => {
    const directory = createSnapshotStore(state({ groups, current: { provider: 'deepseek-official', model: 'gpt-5.2' } }))
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.update((snapshot) => { snapshot.current = selection })
      return { ok: true as const, value: undefined }
    })
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory}
      load={vi.fn()} resolveText={resolveText} select={select} t={t} />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    expect(screen.queryByRole('region', { name: zh['menu.recent'] })).toBeNull()
    fireEvent.click(modelRow('GPT-5.4'))
    await waitFor(() => { expect(isPanelOpen()).toBe(false) })
    expect(select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'gpt-5.4' })
    expect((JSON.parse(localStorage.getItem(USAGE_KEY)!) as { recents: string[] }).recents)
      .toEqual([usageKey('deepseek-official', 'gpt-5.4')])

    fireEvent.click(trigger)
    expect(rowsIn(screen.getByRole('region', { name: zh['menu.recent'] }))
      .map(row => row.textContent)).toEqual(['GPT-5.4'])
    // Frequent excludes rows already pinned as recent, so nothing repeats there yet.
    expect(screen.queryByRole('region', { name: zh['menu.frequent'] })).toBeNull()
  })
})

describe('ModelSelect vendor grouping', () => {
  const groups: ModelDirectoryState['groups'] = [{
    id: 'kito',
    name: 'Kito',
    models: [
      { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5' },
      { id: 'claude-opus-5', name: 'Claude Opus 5' },
      { id: 'gpt-5.6', name: 'GPT-5.6' },
      { id: 'openai/gpt-5.6', name: 'GPT-5.6' },
      { id: 'sub2api-gpt-5.6', name: 'GPT-5.6' },
      { id: 'gpt-image-1.5', name: 'GPT Image 1.5' },
      { id: 'grok-4.6', name: 'Grok 4.6' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'moonshotai/kimi-k3', name: 'Kimi K3' },
      { id: 'qwen/qwen3.7-max', name: 'Qwen 3.7 Max' },
      { id: 'z-ai/glm-5.3', name: 'GLM 5.3' },
      { id: 'composer-2.5', name: 'Composer 2.5' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
    ],
  }]

  it('labels sections with vendor brands and folds alias ids into one badged row', () => {
    mountOpen({ groups, current: null })
    for (const label of ['Anthropic', 'OpenAI', 'xAI', 'Google', 'Moonshot', 'Qwen', 'Z.ai', 'Composer', 'DeepSeek']) {
      expect(screen.getByRole('region', { name: label })).toBeTruthy()
    }
    const openai = screen.getByRole('region', { name: 'OpenAI' })
    const openaiRows = rowsIn(openai)
    expect(openaiRows).toHaveLength(1)
    expect(within(openaiRows[0]!).getByText(zh['option.aliases'].replace('{count}', '2'))).toBeTruthy()
    const anthropic = screen.getByRole('region', { name: 'Anthropic' })
    const anthropicRows = rowsIn(anthropic)
    expect(anthropicRows).toHaveLength(1)
    expect(within(anthropicRows[0]!).getByText(zh['option.aliases'].replace('{count}', '1'))).toBeTruthy()
    // Ids that cannot serve a chat conversation are never offered.
    expect(screen.queryByText('GPT Image 1.5')).toBeNull()
    expect(modelRows()).toHaveLength(9)
  })

  it('submits the canonical bare id behind a folded alias row', async () => {
    const { select } = mountOpen({ groups, current: { provider: 'kito', model: 'grok-4.6' } })
    expect(modelRow('Grok 4.6').getAttribute('aria-pressed')).toBe('true')
    // The checked model advertises no reasoning metadata, so there is no Effort row.
    expect(within(dialog()).queryByRole('button', { name: /推理等级/ })).toBeNull()
    fireEvent.click(modelRow(/GPT-5\.6/))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ provider: 'kito', model: 'gpt-5.6' })
      expect(isPanelOpen()).toBe(false)
    })
  })

  it('checks the folded row when the saved selection names one of its alias ids', async () => {
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    render(<ModelSelect renderSlot={renderLabel} locked={false} available
      directory={createSnapshotStore(state({ groups, current: { provider: 'kito', model: 'openai/gpt-5.6' } }))}
      load={vi.fn()} resolveText={resolveText} select={select} t={t} />)
    const trigger = screen.getByRole('button', { name: '选择模型，当前 GPT-5.6' })
    fireEvent.click(trigger)
    const row = modelRow(/GPT-5\.6/)
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(highlightedRow()).toBe(row)
    // Accepting the current row closes without another submission.
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => { expect(isPanelOpen()).toBe(false) })
    expect(select).not.toHaveBeenCalled()
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('folds a vendor section from its heading, keeps the heading, and ignores the fold while searching', () => {
    mountOpen({ groups, current: null })
    const anthropic = () => screen.getByRole('region', { name: 'Anthropic' })
    const fold = within(anthropic()).getByRole('button', { name: 'Anthropic' })
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    expect(rowsIn(anthropic())).toHaveLength(1)
    fireEvent.click(fold)
    // The heading stays as the control that reopens the section; only its rows go.
    expect(within(anthropic()).getByRole('button', { name: 'Anthropic' }).getAttribute('aria-expanded')).toBe('false')
    expect(rowsIn(anthropic())).toHaveLength(0)
    // A search is already a deliberate narrowing, so it still lists folded rows.
    fireEvent.change(searchBox(), { target: { value: 'Claude' } })
    expect(rowsIn(screen.getByRole('region', { name: zh['search.results'] })).length).toBeGreaterThan(0)
    fireEvent.change(searchBox(), { target: { value: '' } })
    expect(rowsIn(anthropic())).toHaveLength(0)
    fireEvent.click(within(anthropic()).getByRole('button', { name: 'Anthropic' }))
    expect(rowsIn(anthropic())).toHaveLength(1)
  })

  it('lists every catalog row without asking the desktop to probe them', () => {
    vi.stubGlobal('dshDesktop', { protocolVersion: 1 })
    const probeFetch = vi.fn(async () => new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', probeFetch)
    onTestFinished(() => { vi.unstubAllGlobals() })
    const groups: ModelDirectoryState['groups'] = [{
      id: 'ktapi',
      name: 'KT AI',
      models: [
        { id: 'gpt-5.6', name: 'GPT-5.6' },
        { id: 'gpt-5.5', name: 'GPT-5.5' },
      ],
    }]
    mountOpen({ groups, current: null })
    expect(screen.getByRole('button', { name: 'GPT-5.6' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'GPT-5.5' })).toBeTruthy()
    expect(probeFetch).not.toHaveBeenCalled()
  })

  it('never offers non-chat ids even when they are the only catalog rows', () => {
    mountOpen({
      current: null,
      groups: [{
        id: 'kito',
        name: 'Kito',
        models: [
          { id: 'gpt-image-1.5', name: 'GPT Image 1.5' },
          { id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image' },
          { id: 'gpt-5.6', name: 'GPT-5.6' },
        ],
      }],
    })
    expect(modelRows().map(row => row.textContent)).toEqual(['GPT-5.6'])
  })
})

it('hides the inherited effort until a listed model is selected', async () => {
  const directory = createSnapshotStore<ModelDirectoryState>(state({ current: null, routable: false, retainedEffort: 'High' }))
  render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
    resolveText={resolveText} select={vi.fn()} t={t} />)
  const trigger = screen.getByRole('button', { name: '请选择模型' })
  expect(trigger.hasAttribute('disabled')).toBe(false)
  await expect(`${trigger.textContent}\n`).toMatchFileSnapshot('./expected/unselected-model.txt')
  expect(trigger.textContent).not.toContain('High')
  fireEvent.click(trigger)
  // No catalog entry for the saved route means no Effort row.
  expect(within(dialog()).queryByRole('button', { name: /推理等级/ })).toBeNull()
  expect(modelRow('DeepSeek-V4-Flash')).toBeTruthy()
  expect(document.activeElement).toBe(searchBox())
  fireEvent.keyDown(searchBox(), { key: 'Escape' })
  expect(isPanelOpen()).toBe(false)
  fireEvent.click(trigger)
  expect(document.activeElement).toBe(searchBox())
  expect(modelRow('DeepSeek-V4-Flash')).toBeTruthy()
})

it('orders vendor sections and their rows deterministically', async () => {
  const groups = [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'claude-opus-4.8', name: 'Claude Opus 4.8' },
      { id: 'gpt-5.6', name: 'GPT-5.6' },
      { id: 'claude-opus-5', name: 'Claude Opus 5' },
      { id: 'grok-4.6', name: 'Grok 4.6' },
    ],
  }]
  render(<ModelSelect renderSlot={renderLabel} locked={false} available
    directory={createSnapshotStore(state({ current: null, groups }))}
    load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: '请选择模型' }))
  const sections = screen.getAllByRole('region')
  for (const section of sections) {
    expect(section.getAttribute('aria-label'))
      .toBe(within(section).getByRole('heading', { level: 3 }).textContent)
  }
  const lines = sections.flatMap((section) => {
    const heading = within(section).getByRole('heading', { level: 3 })
    return [heading.textContent, ...rowsIn(section).map(row => row.textContent)]
  })
  await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot('./expected/vendor-sections.txt')
})

it.each([en, zh])('localizes the account provider name for model labels while preserving external names', async (copy) => {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const sessionId = SessionId(`account-label-${copy['provider.account']}`)
  await runtime.sessions.add({ id: sessionId })
  const session = runtime.sessions.retainFor(runtime.ctx, sessionId)
  const groups = ['deepseek-account', 'custom'].map(id => ({
    id, name: id === 'deepseek-account' ? 'DeepSeek Account' : 'My Gateway',
    models: [{ id: `${id}-model`, name: 'Model' }],
  }))
  await runtime.root.declare({
    'conversation.input.model.label': { kind: 'single', scope: 'session', inline: true },
  }, ({ renderSlot, SessionProvider }) => <SessionProvider session={session}>
    <ModelSelect locked={false} available
      directory={createSnapshotStore(state({ current: null, groups }))}
      load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={key => key in copy ? copy[key as keyof typeof copy] : key}
      renderSlot={renderSlot} />
  </SessionProvider>)
  runtime.renderRoot()
  await runtime.mount({ inject: ['slots'], apply(ctx) {
    ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register({
      name: 'conversation.input.model.label',
    }, ({ provider }) => <span>{provider.name}</span>))
  } })
})

it('places account and official models before third-party models', async () => {
  const groups = ['custom', 'deepseek-official', 'deepseek-account', 'another'].map(id => ({
    id, name: id, models: [1, 2].map(index => ({ id: `${id}-${index}`, name: `${id}-${index}` })),
  }))
  const directory = createSnapshotStore<ModelDirectoryState>(state({ current: null, groups }))
  render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
    resolveText={resolveText} select={vi.fn()} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: '请选择模型' }))
  const names = modelRows().map(row => row.textContent)
  expect(names).toEqual([
    'Deepseek Account 2', 'Deepseek Account 1', 'Deepseek Official 2', 'Deepseek Official 1',
    'Custom 2', 'Custom 1', 'Another 2', 'Another 1',
  ])
  expect(groups.map(group => group.id)).toEqual(['custom', 'deepseek-official', 'deepseek-account', 'another'])
  await expect(`${names.join('\n')}\n`).toMatchFileSnapshot('./expected/account-first.txt')
})

it('restores the account model name after login without changing the saved route', () => {
  const groups = [{ id: 'deepseek-account', name: 'DeepSeek Account', models: [
    { id: 'deepseek-flash', name: 'DeepSeek Flash', reasoning },
  ] }]
  const selected = { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' }
  const directory = createSnapshotStore(state({ current: selected, groups, retainedEffort: 'High' }))
  render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
    resolveText={resolveText} select={vi.fn()} t={t} />)
  expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent).toBe('DeepSeek Flash')
  expect(screen.getByRole('button', { name: '推理等级，当前 High' }).textContent).toContain('High')
  act(() => { directory.update((snapshot) => { snapshot.groups = []; snapshot.routable = false }) })
  expect(screen.getByRole('button', { name: '请选择模型' }).textContent).toBe('请选择模型')
  act(() => { directory.update((snapshot) => { snapshot.groups = groups; snapshot.routable = true }) })
  expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent).toBe('DeepSeek Flash')
  expect(screen.getByRole('button', { name: '推理等级，当前 High' }).textContent).toContain('High')
  expect(directory.getSnapshot().current).toEqual(selected)
})
