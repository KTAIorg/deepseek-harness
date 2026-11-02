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

/** The portaled panel is a group on the model pane and a menu on the effort pane. */
function isPanelOpen(): boolean {
  return screen.queryByRole('group', { name: zh['menu.aria'] }) !== null
    || screen.queryByRole('menu', { name: zh['menu.aria'] }) !== null
}

function searchBox(): HTMLInputElement {
  return screen.getByRole('searchbox') as HTMLInputElement
}

function highlightedRow(): HTMLElement | undefined {
  return screen.queryAllByRole('menuitemradio').find(row => row.hasAttribute('data-highlighted'))
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
      <ModelSelect locked={false} available directory={directory} load={vi.fn()} select={select} t={t} renderSlot={renderSlot} />
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
    // The panel opens directly on the model rows; there is no root pane.
    expect(screen.getByTestId('option-trusted').textContent).toBe('trusted: Same model')
    expect(screen.getByTestId('option-external').textContent).toBe('external: Same model')
    expect(screen.getByTestId('option-trusted').getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId('option-external').getAttribute('data-selected')).toBe('false')
    expect(screen.queryByTestId('menu-trusted')).toBeNull()
    const external = screen.getByRole('menuitemradio', { name: 'external: Same model' })
    expect(external.querySelector('[data-provider-id="external"][data-model-id="same-model"]')).toBeTruthy()
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
    expect(within(screen.getByRole('group', { name: zh['menu.recent'] })).getAllByRole('menuitemradio')
      .map(row => row.textContent)).toEqual(['Same model'])
    expect(within(screen.getByRole('group', { name: 'Other' })).getAllByRole('menuitemradio')
      .map(row => row.textContent)).toEqual(['Same model', 'Same model'])
  })

  it('does not decorate loading or missing selections with a stale provider', () => {
    const directory = createSnapshotStore(state({ groups: [], status: 'loading' }))
    const renderSlot = vi.fn(() => null)
    render(<ModelSelect locked={false} available directory={directory} load={vi.fn()} select={vi.fn()} t={t} renderSlot={renderSlot} />)
    expect(renderSlot).not.toHaveBeenCalled()
    expect(document.querySelector('[data-provider-id]')).toBeNull()
    act(() => { directory.set(state({ groups: [] })) })
    expect(screen.getByRole('button', { name: '请选择模型' })).toBeTruthy()
    expect(renderSlot).not.toHaveBeenCalled()
  })
})

describe('ModelSelect reasoning effort', () => {
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
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    // The search field takes focus on desktop.
    expect(document.activeElement).toBe(searchBox())
    const effortRow = screen.getByRole('menuitem', { name: /推理等级/ })
    expect(effortRow.textContent).toContain(zh['menu.effort'])
    expect(effortRow.textContent).toContain('High')
    // The Effort row sits above the always-rendered search field.
    expect(effortRow.compareDocumentPosition(searchBox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(effortRow)
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Off', 'High', 'Max'])
    expect(screen.queryByText('Largest budget')).toBeNull()

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Max/ }))
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
      load={vi.fn()}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
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
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '请选择模型' })
    expect(trigger.textContent).toBe('请选择模型')
    fireEvent.click(trigger)
    // No current catalog entry means no reasoning metadata, hence no Effort row.
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(screen.queryByRole('menuitemradio', { name: 'removed-model' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
    expect(screen.queryByText('Fast catalog description')).toBeNull()
    expect(select).not.toHaveBeenCalled()
    expect(directory.getSnapshot().current).toEqual({ provider: 'deepseek-official', model: 'removed-model' })
    fireEvent.keyDown(searchBox(), { key: 'Escape' })
    expect(isPanelOpen()).toBe(false)
  })

  it.each(['model', 'provider'])('hides the saved id and effort when the selected %s disappears', (removed) => {
    const directory = createSnapshotStore(state({ retainedEffort: 'High' }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()} select={vi.fn()} t={t} />)
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
    expect(screen.queryByRole('menuitem')).toBeNull()
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
      load={vi.fn()}
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
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: /选择模型|当前/ })
    fireEvent.click(trigger)
    const rejected = screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ })
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
    expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Flash/ })).toBeTruthy()
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
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)
    const spinners = () => document.querySelectorAll('[data-state="ongoing"]')

    const trigger = screen.getByRole('button', { name: /选择模型|当前/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    expect(spinners()).toHaveLength(2)
    expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }).querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(trigger.querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(trigger.getAttribute('aria-busy')).toBe('true')
    // A pending selection disables every row and freezes the search field.
    expect((screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(searchBox().readOnly).toBe(true)
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
    expect(select).toHaveBeenCalledTimes(1)

    // Closing the panel unmounts the row; the trigger keeps the feedback.
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('menuitemradio')).toBeNull()
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
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Max/ }))
    expect(screen.getAllByRole('menuitemradio')
      .filter(row => row.querySelector('[data-state="ongoing"]') !== null)
      .map(row => row.textContent)).toEqual(['Max'])
  })

  it('portals the placed panel to body and closes only on truly-outside mousedown', () => {
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 200 })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 300 })
    try {
      const { container } = render(<ModelSelect renderSlot={renderLabel}
        locked={false}
        available
        directory={createSnapshotStore(state())}
        load={vi.fn()}
        select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
        t={t}
      />)
      const trigger = screen.getByRole('button', { name: /选择模型/ })
      fireEvent.click(trigger)
      const panel = screen.getByRole('group', { name: zh['menu.aria'] })
      // Outside the composer subtree — column overflow clips cannot crop it.
      expect(container.contains(panel)).toBe(false)
      expect(panel.parentElement).toBe(document.body)
      // jsdom anchor rects are all zero, so the measured 200x300 card clamps
      // to the 12px viewport margin on both axes.
      expect(panel.style.left).toBe('12px')
      expect(panel.style.top).toBe('12px')
      // Interactions inside the trigger subtree or the portaled panel stay open.
      expect(fireEvent.mouseDown(panel)).toBe(true)
      expect(fireEvent.mouseDown(trigger)).toBe(false)
      fireEvent.blur(trigger, { relatedTarget: panel })
      expect(isPanelOpen()).toBe(true)
      fireEvent.mouseDown(document.body)
      expect(isPanelOpen()).toBe(false)
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth)
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
    }
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load}
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
    const rows = screen.getAllByRole('menuitemradio')
    // The checked model is the last row of the grouped panel.
    expect(rows.at(-1)!.textContent).toBe('DeepSeek-V4-Flash')
    expect(highlightedRow()).toBe(rows.at(-1))
    expect(search.getAttribute('aria-activedescendant')).toBe(rows.at(-1)!.id)
    expect(rows.every(row => row.tabIndex === -1)).toBe(true)

    expect(fireEvent.keyDown(search, { key: 'ArrowDown' })).toBe(false)
    expect(document.activeElement).toBe(search)
    expect(highlightedRow()).toBe(rows[0])
    expect(highlightedRow()!.textContent).toBe('Claude Opus 5')
    expect(search.getAttribute('aria-activedescendant')).toBe(rows[0]!.id)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })

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
    expect(highlightedRow()!.getAttribute('aria-checked')).toBe('true')
  })

  it('a step from the trigger moves the highlight and hands the keyboard to search', () => {
    const { trigger } = mountOpen({ groups: searchGroups() })
    const rows = screen.getAllByRole('menuitemradio')
    // The trigger holds focus while the panel opens on desktop; the checked row
    // is the opening highlight, so a forward step wraps to the first section.
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(searchBox())
    expect(highlightedRow()).toBe(rows[0])
    fireEvent.keyDown(searchBox(), { key: 'Escape' })
    fireEvent.click(trigger)
    const reopenedRows = screen.getAllByRole('menuitemradio')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(searchBox())
    expect(highlightedRow()).toBe(reopenedRows[3])
  })

  it('focuses the checked effort level and walks the list with arrows', () => {
    mountOpen()
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const rows = screen.getAllByRole('menuitemradio')
    expect(rows.map(row => row.textContent)).toEqual(['Off', 'High', 'Max'])
    // The panel opens on the value in use.
    expect(rows[1]!.getAttribute('aria-checked')).toBe('true')
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
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const rows = screen.getAllByRole('menuitemradio')
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
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    fireEvent.keyDown(screen.getAllByRole('menuitemradio')[0]!, { key: 'Escape' })
    // The model panel is back, and desktop focus returns to its search field.
    expect(screen.getByRole('group', { name: zh['menu.aria'] })).toBeTruthy()
    expect(document.activeElement).toBe(searchBox())
    fireEvent.keyDown(searchBox(), { key: 'Escape' })
    expect(isPanelOpen()).toBe(false)
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('Shift+Tab leaves the effort list and then closes the panel, like Escape', async () => {
    const { trigger } = mountOpen()
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const rows = screen.getAllByRole('menuitemradio')
    expect(fireEvent.keyDown(rows[0]!, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(screen.getByRole('group', { name: zh['menu.aria'] })).toBeTruthy()
    expect(document.activeElement).toBe(searchBox())
    fireEvent.keyDown(searchBox(), { key: 'Tab', shiftKey: true })
    expect(isPanelOpen()).toBe(false)
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('Tab on a programmatically focused model row activates it', async () => {
    const { select } = mountOpen({ groups: modelGroups(2) })
    const row = screen.getByRole('menuitemradio', { name: 'DeepSeek V3 1' })
    act(() => { row.focus() })
    expect(document.activeElement).toBe(row)
    expect(highlightedRow()).toBe(row)
    expect(fireEvent.keyDown(row, { key: 'Tab' })).toBe(false)
    expect(select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'deepseek-v3-1' })
    await waitFor(() => { expect(isPanelOpen()).toBe(false) })
  })

  it('prevents button mousedown defaults on the Effort row and model rows without selecting', () => {
    const { select } = mountOpen()
    const effortRow = screen.getByRole('menuitem', { name: /推理等级/ })
    expect(fireEvent.mouseDown(effortRow.firstElementChild!)).toBe(false)
    fireEvent.click(effortRow)
    const effortRows = screen.getAllByRole('menuitemradio')
    const focused = document.activeElement
    expect(fireEvent.mouseDown(effortRows[0]!.firstElementChild!)).toBe(false)
    fireEvent.mouseUp(screen.getByRole('menu', { name: zh['menu.aria'] }))
    expect(select).not.toHaveBeenCalled()
    fireEvent.keyDown(focused!, { key: 'Escape' })
    expect(document.activeElement).toBe(searchBox())
    const modelRow = screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })
    expect(fireEvent.mouseDown(modelRow.firstElementChild!)).toBe(false)
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
    retries[1]!.focus()
    // A control that is not a row keeps the browser's traversal.
    expect(fireEvent.keyDown(retries[1]!, { key: 'Tab' })).toBe(true)
    fireEvent.keyDown(retries[1]!, { key: 'Escape' })
    expect(isPanelOpen()).toBe(false)
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it.each([
    { device: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 },
    { device: 'desktop-mode iPad', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 },
  ].flatMap(device => [1, 5].map(modelCount => ({ ...device, modelCount }))))(
    'keeps focus on the trigger for $device with $modelCount models and reaches search only after explicit input',
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
        load={vi.fn()} select={select} t={t}
      />)
      const trigger = screen.getByRole('button', { name: /选择模型/ })
      fireEvent.click(trigger)
      const search = searchBox()
      expect(document.activeElement).toBe(trigger)
      expect(search.value).toBe('')

      // Explicit keyboard input is what reaches the search field on mobile.
      expect(fireEvent.keyDown(trigger, { key: 'Tab' })).toBe(false)
      expect(document.activeElement).toBe(search)
      expect(fireEvent.keyDown(search, { key: 'ArrowDown' })).toBe(false)
      expect(document.activeElement).toBe(search)
      expect(screen.getAllByRole('menuitemradio').filter(row => row.hasAttribute('data-highlighted'))).toHaveLength(1)
      fireEvent.keyDown(search, { key: 'Escape' })
      await waitFor(() => { expect(document.activeElement).toBe(trigger) })
      expect(isPanelOpen()).toBe(false)

      // The effort list focuses its checked level; Escape returns to the panel.
      fireEvent.click(trigger)
      fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
      const high = screen.getByRole('menuitemradio', { name: 'High' })
      const max = screen.getByRole('menuitemradio', { name: /Max/ })
      expect(document.activeElement).toBe(high)
      fireEvent.keyDown(high, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(max)
      fireEvent.keyDown(max, { key: 'Escape' })
      expect(screen.getByRole('group', { name: zh['menu.aria'] })).toBeTruthy()
      expect(screen.queryByRole('menu', { name: zh['menu.aria'] })).toBeNull()
      // Back on the model panel, mobile does not auto-focus its search field.
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
      load={vi.fn()} select={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    const search = searchBox()
    expect(search).toBeInstanceOf(HTMLInputElement)
    expect(document.activeElement).toBe(search)
    const rows = screen.queryAllByRole('menuitemradio')
    expect(rows).toHaveLength(count)
    expect(rows.every(row => row.tabIndex === -1)).toBe(true)
    if (count === 0) {
      expect(search.hasAttribute('aria-activedescendant')).toBe(false)
      expect(screen.getByRole('status').textContent).toBe(zh['empty.models'])
      expect(screen.queryByRole('menu', { name: zh['menu.model'] })).toBeNull()
      return
    }
    // The checked model is the opening highlight at every size.
    expect(rows[0]!.getAttribute('aria-checked')).toBe('true')
    expect(highlightedRow()).toBe(rows[0])
    expect(search.getAttribute('aria-activedescendant')).toBe(rows[0]!.id)
  })

  it.each([0, 1, 4, 5])('opens an unselected %i-model catalog on its first row', (count) => {
    render(<ModelSelect renderSlot={renderLabel} locked={false} available
      directory={createSnapshotStore(state({ groups: modelGroups(count), current: null }))}
      load={vi.fn()} select={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '请选择模型' }))
    const rows = screen.queryAllByRole('menuitemradio')
    expect(rows).toHaveLength(count)
    expect(rows.every(row => row.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(document.activeElement).toBe(searchBox())
    if (count === 0) {
      expect(searchBox().hasAttribute('aria-activedescendant')).toBe(false)
      return
    }
    expect(highlightedRow()).toBe(rows[0])
    expect(searchBox().getAttribute('aria-activedescendant')).toBe(rows[0]!.id)
  })

  it('keeps the typed query, its focus, and the result status across catalog refreshes', () => {
    const current = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    const directory = createSnapshotStore(state({ groups: modelGroups(5), current }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()} select={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    const search = searchBox()
    fireEvent.change(search, { target: { value: 'V3 4' } })
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(1)

    // A shrinking catalog no longer unmounts the search field or drops the query.
    act(() => { directory.set(state({ groups: modelGroups(4), current })) })
    expect(screen.getByRole('searchbox')).toBe(search)
    expect(search.value).toBe('V3 4')
    expect(document.activeElement).toBe(search)
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe(zh['search.empty'])
    expect(screen.queryByRole('menu', { name: zh['menu.model'] })).toBeNull()

    act(() => { directory.set(state({ groups: modelGroups(5), current })) })
    expect(screen.getByRole('searchbox')).toBe(search)
    expect(search.value).toBe('V3 4')
    expect(document.activeElement).toBe(search)
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(1)
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek V3 4' })).toBeTruthy()
  })

  it('highlights a hovered row and settles it with Tab from the search field', async () => {
    const { select } = mountOpen({ groups: modelGroups(4) })
    const row = screen.getByRole('menuitemradio', { name: 'DeepSeek V3 2' })
    fireEvent.mouseMove(row)
    expect(highlightedRow()).toBe(row)
    expect(document.activeElement).toBe(searchBox())
    expect(searchBox().getAttribute('aria-activedescendant')).toBe(row.id)
    expect(fireEvent.keyDown(searchBox(), { key: 'Tab' })).toBe(false)
    expect(select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'deepseek-v3-2' })
    await waitFor(() => { expect(isPanelOpen()).toBe(false) })
  })
})

describe('ModelSelect search', () => {
  it('clears the query whenever the panel reopens', () => {
    render(<ModelSelect renderSlot={renderLabel} locked={false} available
      directory={createSnapshotStore(state({ groups: modelGroups(5), current: null }))}
      load={vi.fn()} select={vi.fn()} t={t} />)
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
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(5)
  })

  it('hides empty vendor sections and announces an empty catalog', () => {
    const directory = createSnapshotStore(state({ groups: [
      ...state().groups, { id: 'empty', name: 'Empty Provider', models: [] },
    ] }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()} select={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    expect(screen.queryByRole('group', { name: 'Empty Provider' })).toBeNull()
    const sections = screen.getAllByRole('group').filter(group => group.hasAttribute('aria-labelledby'))
    expect(sections).toHaveLength(1)
    expect(sections[0]!.textContent).toContain('Other')
    act(() => { directory.set(state({ groups: [] })) })
    expect(screen.getByRole('status').textContent).toBe(zh['empty.models'])
    expect(screen.getByRole('status').closest('[role="menu"]')).toBeNull()
    expect(screen.queryByRole('menu', { name: zh['menu.model'] })).toBeNull()
  })

  it.each(['Enter', 'Tab'])('returns focus silently after %s accepts the current model, without suppressing later focus', async (key) => {
    const select = vi.fn()
    render(<>
      <button type="button">Outside</button>
      <ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(state({ groups: modelGroups(5) }))}
        load={vi.fn()} select={select} t={t} />
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
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    const search = searchBox()
    expect(search).toBeInstanceOf(HTMLInputElement)
    const rows = screen.getAllByRole('menuitemradio')
    expect(search.getAttribute('aria-activedescendant')).toBe(rows.at(-1)!.id)
    fireEvent.keyDown(search, { key: 'ArrowDown' }) // wraps to the first section
    expect(search.getAttribute('aria-activedescendant')).toBe(rows[0]!.id)
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search.getAttribute('aria-activedescendant')).toBe(rows[1]!.id)
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    expect(search.getAttribute('aria-activedescendant')).toBe(rows[0]!.id)
    expect(document.activeElement).toBe(search)
    expect(rows[0]!.hasAttribute('data-highlighted')).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(fireEvent.keyDown(search, { key: 'ArrowLeft' })).toBe(true)
    expect(fireEvent.keyDown(search, { key: 'ArrowRight' })).toBe(true)

    fireEvent.change(search, { target: { value: 'opus' } })
    expect(search.getAttribute('aria-activedescendant'))
      .toBe(screen.getByRole('menuitemradio', { name: 'Claude Opus 5' }).id)
    fireEvent.change(search, { target: { value: 'zzzz' } })
    expect(search.hasAttribute('aria-activedescendant')).toBe(false)
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(select).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(search, { key: 'Tab' })).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    const restored = screen.getAllByRole('menuitemradio')
    expect(search.getAttribute('aria-activedescendant')).toBe(restored[0]!.id)
    fireEvent.mouseMove(restored[1]!)
    expect(search.getAttribute('aria-activedescendant')).toBe(restored[1]!.id)
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
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    const search = searchBox()
    expect(document.activeElement).toBe(search)
    // The search field is outside the rows' menu, not a menu row itself.
    expect(search.closest('[role="menu"]')).toBeNull()
    expect(fireEvent.keyDown(search, { key: 'ArrowDown', isComposing: true })).toBe(true)
    expect(document.activeElement).toBe(search)

    fireEvent.change(search, { target: { value: 'opus' } })
    expect(screen.getByRole('group', { name: zh['search.results'] })).toBeTruthy()
    expect(screen.getAllByRole('menuitemradio').map(row => row.textContent))
      .toEqual(['Claude Opus 5', 'Claude Opus 4.8'])
    expect(document.activeElement).toBe(search)
    expect(screen.queryByRole('group', { name: 'Anthropic' })).toBeNull()

    fireEvent.change(search, { target: { value: '  GMFL  ' } })
    expect(screen.getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['Gemini Flash'])

    fireEvent.change(search, { target: { value: 'zzzz' } })
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(zh['search.empty'])
    expect(status.closest('[role="menu"]')).toBeNull()
    expect(screen.queryByRole('menu', { name: zh['menu.model'] })).toBeNull()
    expect(fireEvent.keyDown(search, { key: 'ArrowDown' })).toBe(false)
    expect(document.activeElement).toBe(search)

    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    expect(search.value).toBe('')
    expect(document.activeElement).toBe(search)
    expect(screen.queryByRole('button', { name: '清除搜索' })).toBeNull()
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(5)

    // Reopening starts from an empty query and a fully listed catalog.
    fireEvent.change(search, { target: { value: 'gmfl' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    fireEvent.click(trigger)
    const reopened = searchBox()
    expect(reopened.value).toBe('')
    expect(document.activeElement).toBe(reopened)
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(5)

    fireEvent.change(reopened, { target: { value: 'gmfl' } })
    const row = screen.getByRole('menuitemradio', { name: 'Gemini Flash' })
    expect(screen.getByRole('menu', { name: zh['menu.model'] }).contains(row)).toBe(true)
    fireEvent.keyDown(reopened, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(reopened)
    expect(reopened.getAttribute('aria-activedescendant')).toBe(row.id)
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

    expect(within(screen.getByRole('group', { name: zh['menu.recent'] }))
      .getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['GPT-5.2'])
    expect(within(screen.getByRole('group', { name: zh['menu.frequent'] }))
      .getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['GPT-5.3'])
    // The pinned rows do not displace the vendor section's complete listing.
    expect(within(screen.getByRole('group', { name: 'OpenAI' }))
      .getAllByRole('menuitemradio').map(row => row.textContent))
      .toEqual(['GPT-5.4', 'GPT-5.3', 'GPT-5.2'])
    // Pinned sections lead the panel, recent before frequent.
    const headings = screen.getAllByRole('group')
      .filter(group => group.hasAttribute('aria-labelledby'))
      .map(group => document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent)
    expect(headings).toEqual([zh['menu.recent'], zh['menu.frequent'], 'OpenAI'])
  })

  it('leads the next open with the model just selected and persists it locally', async () => {
    const directory = createSnapshotStore(state({ groups, current: { provider: 'deepseek-official', model: 'gpt-5.2' } }))
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.update((snapshot) => { snapshot.current = selection })
      return { ok: true as const, value: undefined }
    })
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    expect(screen.queryByRole('group', { name: zh['menu.recent'] })).toBeNull()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'GPT-5.4' }))
    await waitFor(() => { expect(isPanelOpen()).toBe(false) })
    expect(select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'gpt-5.4' })
    expect(JSON.parse(localStorage.getItem(USAGE_KEY)!).recents)
      .toEqual([usageKey('deepseek-official', 'gpt-5.4')])

    fireEvent.click(trigger)
    expect(within(screen.getByRole('group', { name: zh['menu.recent'] }))
      .getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['GPT-5.4'])
    // Frequent excludes rows already pinned as recent, so nothing repeats there yet.
    expect(screen.queryByRole('group', { name: zh['menu.frequent'] })).toBeNull()
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
    for (const label of ['Anthropic', 'OpenAI', 'xAI', 'Google', 'Moonshot', 'Qwen', 'Z.ai', 'Composer', 'Other']) {
      expect(screen.getByRole('group', { name: label })).toBeTruthy()
    }
    const openai = screen.getByRole('group', { name: 'OpenAI' })
    const openaiRows = within(openai).getAllByRole('menuitemradio')
    expect(openaiRows).toHaveLength(1)
    expect(within(openaiRows[0]!).getByText(zh['option.aliases'].replace('{count}', '2'))).toBeTruthy()
    const anthropic = screen.getByRole('group', { name: 'Anthropic' })
    const anthropicRows = within(anthropic).getAllByRole('menuitemradio')
    expect(anthropicRows).toHaveLength(1)
    expect(within(anthropicRows[0]!).getByText(zh['option.aliases'].replace('{count}', '1'))).toBeTruthy()
    // Ids that cannot serve a chat conversation are never offered.
    expect(screen.queryByText('GPT Image 1.5')).toBeNull()
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(9)
  })

  it('submits the canonical bare id behind a folded alias row', async () => {
    const { select } = mountOpen({ groups, current: { provider: 'kito', model: 'grok-4.6' } })
    expect(screen.getByRole('menuitemradio', { name: 'Grok 4.6' }).getAttribute('aria-checked')).toBe('true')
    // The checked model advertises no reasoning metadata, so there is no Effort row.
    expect(screen.queryByRole('menuitem')).toBeNull()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /GPT-5\.6/ }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ provider: 'kito', model: 'gpt-5.6' })
      expect(isPanelOpen()).toBe(false)
    })
  })

  it('checks the folded row when the saved selection names one of its alias ids', async () => {
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    render(<ModelSelect renderSlot={renderLabel} locked={false} available
      directory={createSnapshotStore(state({ groups, current: { provider: 'kito', model: 'openai/gpt-5.6' } }))}
      load={vi.fn()} select={select} t={t} />)
    const trigger = screen.getByRole('button', { name: '选择模型，当前 GPT-5.6' })
    fireEvent.click(trigger)
    const row = screen.getByRole('menuitemradio', { name: /GPT-5\.6/ })
    expect(row.getAttribute('aria-checked')).toBe('true')
    expect(highlightedRow()).toBe(row)
    // Accepting the current row closes without another submission.
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => { expect(isPanelOpen()).toBe(false) })
    expect(select).not.toHaveBeenCalled()
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
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
    expect(screen.getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['GPT-5.6'])
  })
})

it('hides the inherited effort until a listed model is selected', async () => {
  const directory = createSnapshotStore<ModelDirectoryState>(state({ current: null, routable: false, retainedEffort: 'High' }))
  render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()} select={vi.fn()} t={t} />)
  const trigger = screen.getByRole('button', { name: '请选择模型' })
  expect(trigger.hasAttribute('disabled')).toBe(false)
  await expect(`${trigger.textContent}\n`).toMatchFileSnapshot('./expected/unselected-model.txt')
  expect(trigger.textContent).not.toContain('High')
  fireEvent.click(trigger)
  // No catalog entry for the saved route means no Effort row.
  expect(screen.queryByRole('menuitem')).toBeNull()
  expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
  expect(document.activeElement).toBe(searchBox())
  fireEvent.keyDown(searchBox(), { key: 'Escape' })
  expect(isPanelOpen()).toBe(false)
  fireEvent.click(trigger)
  expect(document.activeElement).toBe(searchBox())
  expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
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
    load={vi.fn()} select={vi.fn()} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: '请选择模型' }))
  const sections = screen.getAllByRole('group').filter(group => group.hasAttribute('aria-labelledby'))
  const lines = sections.flatMap((group) => {
    const heading = document.getElementById(group.getAttribute('aria-labelledby')!)
    return [heading!.textContent!, ...within(group).getAllByRole('menuitemradio').map(row => row.textContent!)]
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
      load={vi.fn()} select={vi.fn()} t={key => key in copy ? copy[key as keyof typeof copy] : key}
      renderSlot={renderSlot} />
  </SessionProvider>)
  runtime.renderRoot()
  await runtime.mount({ inject: ['slots'], apply(ctx) {
    ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register({
      name: 'conversation.input.model.label',
    }, ({ provider }) => <span>{provider.name}</span>))
  } })
  fireEvent.click(screen.getByRole('button', { name: copy['trigger.selectAria'] }))
  expect(screen.getAllByRole('menuitemradio').map(row => row.textContent))
    .toEqual([copy['provider.account'], 'My Gateway'])
})

it('restores the account model name after login without changing the saved route', () => {
  const groups = [{ id: 'deepseek-account', name: 'DeepSeek Account', models: [
    { id: 'deepseek-flash', name: 'DeepSeek Flash', reasoning },
  ] }]
  const selected = { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' }
  const directory = createSnapshotStore(state({ current: selected, groups, retainedEffort: 'High' }))
  render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()} select={vi.fn()} t={t} />)
  expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent).toBe('DeepSeek FlashHigh')
  act(() => { directory.update((snapshot) => { snapshot.groups = []; snapshot.routable = false }) })
  expect(screen.getByRole('button', { name: '请选择模型' }).textContent).toBe('请选择模型')
  act(() => { directory.update((snapshot) => { snapshot.groups = groups; snapshot.routable = true }) })
  expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent).toBe('DeepSeek FlashHigh')
  expect(directory.getSnapshot().current).toEqual(selected)
})
