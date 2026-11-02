/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * The trigger (313:14108's ToggleButton) shows the model name and current
 * effort. Opening it shows a page-sized dialog over the shared directory, so
 * the catalog spreads across the window instead of scrolling a small card:
 * search is always present and focused on desktop, recent selections and
 * frequently used models stay pinned on top as chips, and the rest of the
 * catalog is grouped by vendor family into a responsive card grid.
 * Vendor-prefixed and mirror ids (`openai/gpt-5.6`, `sub2api-grok-4.5`) fold
 * into one row that submits the canonical id and carries an alias-count badge;
 * ids that cannot serve a chat conversation are never offered. The effort chip
 * opens the effort list for the current model. ↑/↓ move the highlighted row
 * while search keeps the keyboard; Enter and Tab settle it, Escape and
 * Shift+Tab leave the effort list first and otherwise close back to the
 * trigger. A successful selection records local usage, so the next open leads
 * with the models just used. Selecting restores trigger focus without a ring
 * until the trigger loses focus or the dialog reopens. Mobile devices open the
 * dialog without focusing search and reach it only after explicit user input.
 * Data and submission ride the same per-session ModelDirectory as the /model
 * popup; exact-model reasoning metadata and the selected effort come from the
 * Host rather than a client-owned vocabulary. A rejected selection announces
 * through the shared transient Toast anchored to the composer card; the
 * in-dialog strip with Retry remains the catalog-load surface. While the
 * directory's pending selection is unsettled, the trigger shows a spinner in
 * place of its chevron, and each row whose value that selection carries shows
 * one in place of its check mark.
 **/
import {
  Input, isMobileDevice, Modal, StateDot, Toast,
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconCloseFillRegular,
  IconDataOutlineRegular, IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent,
} from 'react'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelLabelOwner, ModelSelectInjected } from './slots.ts'
import css from './ModelSelect.module.css'
import {
  buildModelSections, choiceMatches, modelChoices,
  type ModelChoice, type ModelSection,
} from './model-sections.ts'
import { VendorIcon } from './VendorIcon.tsx'
import { loadModelUsage, modelUsageKey, rememberModelUse, type ModelUsage } from './model-usage.ts'
import { orderModelProviders } from './provider-order.ts'

/** Which pane the dropdown shows: the grouped model panel or its effort list. */
type Pane = 'model' | 'effort'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
export function ModelSelect(
  { locked, available, directory, load, select, t, renderSlot }:
  ModelSelectInjected & Pick<PropsRuntime<'conversation.input.model'>, 'locked'> & PropsLocale<'model'>
    & Omit<PropsRenderSlots<'conversation.input.model.label'>, 'SessionProvider'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('model')
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const [selectionFocus, setSelectionFocus] = useState(false)
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const effortRef = useRef<HTMLDivElement | null>(null)
  const groupsRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const accountProviderName = t('provider.account')
  const groups = useMemo(() => orderModelProviders(state.groups).map(group => ({
    ...group,
    name: group.id === 'deepseek-account' ? accountProviderName : group.name,
  })), [state.groups, accountProviderName])
  const [usage, setUsage] = useState<ModelUsage>(loadModelUsage)
  const choices = useMemo(() => modelChoices(groups), [groups])
  const sections = useMemo(() => buildModelSections(choices, usage, query), [choices, usage, query])
  const visibleChoices = useMemo(() => sections.flatMap(section => section.choices), [sections])
  const currentVisibleIndex = visibleChoices.findIndex(choice =>
    state.current !== null && choiceMatches(choice, state.current.provider, state.current.model))
  const activeModelIndex = visibleChoices.length === 0
    ? -1
    : Math.min(highlightedIndex ?? Math.max(0, currentVisibleIndex), visibleChoices.length - 1)
  const current = state.current
  const currentChoice = current === null
    ? undefined
    : choices.find(choice => choiceMatches(choice, current.provider, current.model))
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = currentChoice === undefined
    ? undefined
    : reasoning === undefined
      ? state.retainedEffort
      : effectiveEffort === undefined
        ? t('effort.providerDefault')
        : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
      })),
    ], [reasoning, t])
  const { pending } = state
  const busy = pending !== null

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  // The search field owns the keyboard whenever the model panel is showing;
  // the effort list starts on the value in use so Enter settles it directly.
  useEffect(() => {
    if (!open) return
    if (pane === 'effort') {
      const checked = effortRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"]:not([disabled])')
      const target = checked ?? itemRefs.current.find(item => item !== null && !item.disabled)
      ;(target ?? triggerRef.current)?.focus()
      return
    }
    // The dialog's own mask keeps the page inert, so search owns the keyboard.
    if (!isMobileDevice()) searchRef.current?.focus()
  }, [open, pane])

  useLayoutEffect(() => {
    if (open && pane === 'model' && activeModelIndex >= 0) {
      itemRefs.current[activeModelIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [open, pane, activeModelIndex, visibleChoices])

  if (!available) return null

  const show = (): void => {
    setSelectionFocus(false)
    triggerRef.current?.focus()
    setQuery('')
    setHighlightedIndex(null)
    setPane('model')
    setOpen(true)
    reload()
  }

  const changeQuery = (next: string): void => {
    setQuery(next)
    setHighlightedIndex(0)
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('model')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const closeAfterSelection = (): void => {
    setSelectionFocus(true)
    close(true)
  }

  /** Show the effort list over the model panel; Escape returns here. */
  const showEfforts = (): void => {
    setQuery('')
    setHighlightedIndex(null)
    setPane('effort')
  }

  /** Return from the effort list to the grouped model panel. */
  const backToModels = (): void => {
    setPane('model')
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    // Focus outside the rows (the trigger, which keeps it while the menu
    // opens) enters at the end the step comes from: the first row forward,
    // the last row backward.
    const next = active === -1
      ? (offset > 0 ? 0 : items.length - 1)
      : (active + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (!open) return
    if (pane === 'model' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      if (!busy && visibleChoices.length > 0) {
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setHighlightedIndex((activeModelIndex + direction + visibleChoices.length) % visibleChoices.length)
        searchRef.current?.focus()
      }
      return
    }
    if (pane === 'model' && event.target instanceof HTMLInputElement
      && (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))) {
      if (event.key === 'Tab' && visibleChoices.length === 0) return
      event.preventDefault()
      const highlighted = visibleChoices[activeModelIndex]
      if (!busy && highlighted !== undefined) choose(highlighted)
      return
    }
    // Tab settles like Enter and Shift+Tab leaves like Escape, so the panel's
    // keys mean what they mean in the composer. Both are consumed: the card
    // keeps the browser's focus traversal out while it is open.
    if (event.key === 'Tab') {
      if (event.shiftKey) {
        event.preventDefault()
        if (pane === 'effort') backToModels()
        else close(true)
        return
      }
      // Settling activates the row the keyboard is on; with focus still on the
      // trigger, Tab enters the panel at the search field instead. Any other
      // control inside the card (a retry button) keeps the browser's traversal,
      // so the keystroke stays unconsumed there.
      const focused = document.activeElement
      const rows = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null)
      if (focused instanceof HTMLButtonElement && rows.includes(focused)) {
        event.preventDefault()
        focused.click()
        return
      }
      if (focused !== triggerRef.current) return
      event.preventDefault()
      if (pane === 'model') {
        setHighlightedIndex(null)
        searchRef.current?.focus()
        return
      }
      const checked = effortRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"]:not([disabled])')
      ;(checked ?? rows.find(item => !item.disabled))?.focus()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const settleSelection = (
    result: Awaited<ReturnType<ModelSelectInjected['select']>>,
    selection: ModelSelection,
    recordUse: boolean,
  ): void => {
    if (result === undefined) return
    if (result.ok) {
      // A model-row choice feeds the next open's recent and frequent rows; an
      // effort-only change leaves that history alone.
      if (recordUse) {
        const nextUsage = rememberModelUse(usage, modelUsageKey(selection.provider, selection.model))
        setUsage(nextUsage)
      }
      if (rootRef.current !== null) closeAfterSelection()
      return
    }
    const { error } = result
    toastSeq.current += 1
    setToast({
      seq: toastSeq.current,
      text: error.code === 'session/writer-held'
        ? t('error.sessionInUse')
        : t('error.action', { message: `${error.code}: ${error.message}` }),
    })
  }

  const submit = (selection: ModelSelection, recordUse = false): void => {
    lastActionRef.current = 'select'
    // Disabled option rows cannot retain focus while a selection is pending.
    setSelectionFocus(true)
    triggerRef.current?.focus()
    void select(selection).then((result) => { settleSelection(result, selection, recordUse) })
  }

  const choose = (choice: ModelChoice): void => {
    if (state.current !== null && choiceMatches(choice, state.current.provider, state.current.model)) {
      closeAfterSelection()
      return
    }
    submit({
      provider: choice.provider,
      model: choice.model.id,
      ...choice.model.reasoning?.defaultEffort === undefined
        ? {}
        : { reasoningEffort: choice.model.reasoning.defaultEffort },
    }, true)
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      closeAfterSelection()
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    submit(selection)
  }

  const waiting = currentChoice === undefined && state.status === 'loading'
  const modelLabel = waiting
    ? t('trigger.loading')
    : currentChoice?.model.name
      ?? t('trigger.fallback')
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = waiting
    ? t('trigger.loading')
    : currentChoice === undefined
      ? t('trigger.selectAria')
      : effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  const sectionLabel = (section: ModelSection): string => section.kind === 'recent'
    ? t('menu.recent')
    : section.kind === 'frequent'
      ? t('menu.frequent')
      : section.kind === 'results'
        ? t('search.results')
        : section.label ?? ''
  const renderModelLabel = (
    provider: ModelLabelOwner['provider'], model: ModelLabelOwner['model'],
    placement: ModelLabelOwner['placement'], selected: boolean, displayName = model.name,
  ) => (
    <span data-provider-id={provider.id} data-model-id={model.id}>
      {renderSlot('conversation.input.model.label', {
        provider, model, placement, selected,
      }, { fallback: displayName })}
    </span>
  )
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  let choiceIndex = 0
  const renderChoice = (choice: ModelChoice, compact: boolean) => {
    const index = choiceIndex++
    const selected = state.current !== null && choiceMatches(choice, state.current.provider, state.current.model)
    const pendingChoice = pending !== null && choiceMatches(choice, pending.provider, pending.model)
    return (
      <button
        ref={itemRef()}
        type="button"
        aria-pressed={selected}
        id={`${id}-model-${index}`}
        tabIndex={-1}
        onFocus={() => { setHighlightedIndex(index) }}
        data-highlighted={index === activeModelIndex ? '' : undefined}
        className={clsx(
          compact ? css.chip : css.card,
          selected && css.selectedChoice,
          index === activeModelIndex && css.optionActive,
        )}
        onMouseMove={busy || index === activeModelIndex ? undefined : () => { setHighlightedIndex(index) }}
        key={`${choice.provider}:${choice.model.id}:${String(index)}`}
        title={choice.displayName}
        disabled={busy}
        onClick={() => { choose(choice) }}
      >
        <span className={css.modelName}>
          {renderModelLabel(
            { id: choice.provider, name: choice.providerName },
            { ...choice.model, name: choice.displayName },
            'option',
            selected,
            choice.displayName,
          )}
        </span>
        {choice.aliases.length > 0 && (
          <span className={css.aliasBadge}>{t('option.aliases', { count: choice.aliases.length })}</span>
        )}
        <span className={css.check}>
          {pendingChoice
            ? <StateDot state="ongoing" />
            : selected ? <IconCheckOutlineRegular /> : null}
        </span>
      </button>
    )
  }

  return (
    <div
      ref={rootRef}
      className={css.root}
      onKeyDown={onRootKeyDown}
      onMouseDown={(event) => {
        // WebKit blurs a focused row before click unless the button's mousedown keeps focus.
        if (event.target instanceof Element && event.target.closest('button') !== null) event.preventDefault()
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-models` : undefined}
        title={triggerLabel}
        aria-busy={busy}
        data-selection-focus={selectionFocus ? '' : undefined}
        onBlur={() => { setSelectionFocus(false) }}
        disabled={locked}
        onClick={() => {
          if (open) {
            close(true)
          } else {
            show()
          }
        }}
      >
        <IconDataOutlineRegular className={css.triggerIcon} size={16} />
        <span className={css.triggerLabel}>
          {currentChoice === undefined
            ? modelLabel
            : renderModelLabel(
              { id: currentChoice.provider, name: currentChoice.providerName },
              { ...currentChoice.model, name: currentChoice.displayName },
              'trigger',
              true,
              currentChoice.displayName,
            )}
        </span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        {busy
          ? <StateDot state="ongoing" />
          : <IconChevronDownOutlineRegular className={clsx(css.chevron, open && css.chevronOpen)} />}
      </button>

      {/* Page-sized dialog: ui-primitives owns the mask, blur, focus layer and
          Escape handling, so the catalog spreads across the window instead of
          scrolling inside a small anchored card. */}
      <Modal
        open={open}
        onClose={() => { if (pane === 'effort') backToModels(); else close(true) }}
        title={t('menu.aria')}
        closeLabel={t('menu.close')}
        className={css.dialog ?? ''}
        contentClassName={css.dialogBody ?? ''}
      >
        {pane === 'model' && (
          <div className={css.modelPane}>
            <div className={css.searchBar}>
              <div className={css.searchField}>
                <Input
                  ref={searchRef}
                  className={clsx(css.search, query !== '' && css.searchWithQuery)}
                  type="text"
                  role="searchbox"
                  aria-label={t('search.placeholder')}
                  aria-controls={`${id}-models`}
                  placeholder={t('search.placeholder')}
                  value={query}
                  readOnly={busy}
                  onChange={(event) => { changeQuery(event.target.value) }}
                />
                {query !== '' && (
                  <button
                    type="button"
                    className={css.searchClear}
                    aria-label={t('search.clear')}
                    disabled={busy}
                    onClick={() => {
                      changeQuery('')
                      searchRef.current?.focus()
                    }}
                  >
                    <IconCloseFillRegular />
                  </button>
                )}
              </div>
              {reasoning !== undefined && (
                <button type="button" className={css.effortChip} disabled={busy} onClick={showEfforts}>
                  <span className={css.effortChipLabel}>{t('menu.effort')}</span>
                  <span className={css.effortChipValue}>{effortLabel}</span>
                  <IconChevronRightOutlineRegular className={css.effortChipChevron} />
                </button>
              )}
            </div>
            {state.status === 'loading' && (
              <div className={css.status}>{t('status.loading')}</div>
            )}
            {state.error !== null && lastActionRef.current === 'load' && (
              <div className={css.error}>
                <span>{t('error.action', { message: state.error })}</span>
                <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
              </div>
            )}
            {state.failures.map(failure => (
              <div className={css.warning} key={failure.id}>
                <span>{t('warning.groupLoad', { name: failure.id === 'deepseek-account' ? t('provider.account') : failure.name, message: failure.message })}</span>
                <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
              </div>
            ))}
            <div
              ref={groupsRef}
              id={`${id}-models`}
              className={css.sections}
              role="group"
              aria-label={t('menu.model')}
              hidden={visibleChoices.length === 0}
            >
              {sections.map(section => (
                <section className={css.section} key={section.id} aria-label={sectionLabel(section)}>
                  <h3 className={css.sectionTitle}>
                    {section.vendor !== undefined && <VendorIcon vendor={section.vendor} />}
                    {sectionLabel(section)}
                  </h3>
                  {section.kind === 'recent' || section.kind === 'frequent'
                    ? <div className={css.chipRow}>{section.choices.map(choice => renderChoice(choice, true))}</div>
                    : <div className={css.grid}>{section.choices.map(choice => renderChoice(choice, false))}</div>}
                </section>
              ))}
            </div>
            {state.status === 'ready' && visibleChoices.length === 0 && (
              <div className={css.empty} role="status">{t(choices.length === 0 ? 'empty.models' : 'search.empty')}</div>
            )}
          </div>
        )}
        {pane === 'effort' && (
          <div ref={effortRef} className={css.effortPane} role="group" aria-label={t('menu.effort')}>
            <button type="button" className={css.effortBack} onClick={backToModels}>
              <IconChevronRightOutlineRegular className={css.effortBackIcon} />
              {t('menu.model')}
            </button>
            {state.error !== null && lastActionRef.current === 'load' && (
              <div className={css.error}>
                <span>{t('error.action', { message: state.error })}</span>
                <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
              </div>
            )}
            {effortChoices.length === 0
              ? <div className={css.empty}>{t('empty.efforts')}</div>
              : effortChoices.map(level => (
                <button
                  ref={itemRef()}
                  type="button"
                  aria-pressed={effectiveEffort === level.effort}
                  className={clsx(css.option, effectiveEffort === level.effort && css.selected)}
                  key={level.key}
                  disabled={busy}
                  onClick={() => { chooseEffort(level.effort) }}
                >
                  <span className={css.optionCopy}>
                    <span className={css.modelName}>{level.label}</span>
                  </span>
                  <span className={css.check}>
                    {pending !== null && pending.provider === state.current?.provider
                      && pending.model === state.current.model && pending.reasoningEffort === level.effort
                      ? <StateDot state="ongoing" />
                      : effectiveEffort === level.effort ? <IconCheckOutlineRegular /> : null}
                  </span>
                </button>
              ))}
          </div>
        )}
      </Modal>

      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
