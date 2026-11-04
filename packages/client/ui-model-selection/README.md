---
description: "Model selection for the Web GUI: the /model popup and the composer model seat over one per-session provider-grouped directory; for users and maintainers of model routing."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-model-selection

English | [中文](README.zh.md)

Desktop product events use the optional [product analytics service](../product-analytics/README.md); ordinary Web interactions are excluded.

## Summary

The Web GUI lets users switch the model and reasoning effort for an existing session through either the `/model` popup or the composer's model control. Both surfaces present the same catalog grouped the same way: by vendor family, with each group carrying its brand mark. The selected model determines the available effort names and default. A complete selection applies to the next request; a running step keeps the model and effort it started with.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

DeepSeek account and API-key routes appear as separate provider groups, each exposing the same configured model catalog.

When no model is selected or the saved selection is absent from the catalog, the composer shows “Select model” in regular weight and hides the reasoning effort caption. Clicking it opens the model list directly; Escape and Shift+Tab close it. An empty catalog hides the model menu from display and the accessibility tree and displays “No models available.” in a status region.

Mount this plugin alongside `ui-conversation` and the commands package; the composer then shows the model seat next to the pending indicator, and `/model` opens the same directory as a popup. Opening the seat shows a page-sized dialog over the shared directory: search is always present and focused on desktop, recent and frequently used models stay pinned as chips above the vendor groups, and the catalog's remaining rows are laid out in a responsive card grid under one heading per vendor. `↑`/`↓` move the highlighted row while search keeps the keyboard; Enter and Tab settle it; Escape and `Shift+Tab` leave the effort list first and otherwise close back to the trigger. The effort chip beside search opens the effort list for the current model. Phones and tablets open the dialog without focusing search and reach it only after explicit input. The composer shows the catalog name while the selected model is available. Removing a model or provider, including account sign-out, preserves the stored provider, model, and reasoning effort without displaying their IDs. Restoring the catalog entry restores its name and effort caption.

Mouse selection uses native browser clicks, including their cancellation behavior; a press alone never selects. Opening the dialog focuses its trigger, then the search field on desktop; the dialog closes from its close button, Escape, or the mask and returns focus to the trigger. Search focus and the search-clear button show the same fill for keyboard focus and hover, without a native outline. Selecting a model or effort returns focus to the trigger without a focus ring; leaving the trigger or reopening the menu restores its normal focus indication. While a selection from either entry is pending, focus stays on the trigger, the trigger shows a spinner in place of its chevron, and each row whose value the selection carries shows one in place of its check; a rejected selection leaves the dialog open. Tab returns to model search with the current model highlighted.

### Model and effort

The composer panel always shows search because its rows are grouped by vendor rather than by provider; the `/model` command keeps its search field as well. Both match model names and ids case-insensitively, including nonconsecutive characters in order; leading and trailing spaces are ignored. Results rank prefix matches first, then word prefixes, then ordered subsequences, breaking ties by newer version and then name. Empty groups are hidden. Empty catalogs and queries without matches are announced through a status region. Search keeps focus while arrow keys cycle the highlighted result across sections; Enter or Tab selects it. Left and right arrows keep their native caret behavior. Opening highlights the current model, and editing the query resets the highlight to the first result. Reopening the panel clears the query. Ids that cannot serve a chat conversation, such as `gpt-image-1.5`, are never offered, and ids that name the same model through a vendor prefix or a `sub2api-` mirror fold into one row that submits the canonical id and shows an alias-count badge.

Model and reasoning-effort names use weight 400 (regular) in the composer menu, including the selected item. The search field follows the command popup's compact treatment with transparent background and border in both palettes, with no leading icon and a caption-tone placeholder. Its text is 16px on devices with a coarse primary pointer to avoid Safari focus zoom; fine pointers retain 12px. The clear button appears for a nonempty query and restores the full list with focus in the search field.

Both surfaces group rows by vendor family — DeepSeek, Anthropic, OpenAI, xAI, Google, Moonshot, Qwen, Z.ai, Composer, and Other — and both show a brand mark beside the vendor name ([Brand marks](#brand-marks)). The composer dialog pins the recent and frequently used chip sections first; the vendor used most recently leads the remaining groups. The `/model` popup keeps its shared, asynchronously observed sticky headings from [ui-primitives](../ui-primitives/README.md#understand-the-implementation): transparent at rest, with the theme's 94%-opaque fill only while pinned, and `md` corners outside macOS Desktop; the composer dialog uses plain section headings above a responsive card grid instead. Navigation chevrons use `--dsw-alias-menu-icon`. Both surfaces show derived display names as row labels and no catalog descriptions, and rows whose ids fold into the same model submit the canonical id. Its search placeholder, no-match text, and empty-catalog text use the same localized labels as the composer dialog. The popup applies the selected model's default effort; the composer can then choose any advertised effort. An adapter without reasoning metadata leaves the Effort row absent; there is no arbitrary effort input.

The composer replaces the model and effort text with the Models icon when the expanded controls cannot share one line, and restores the text when space permits. The full selection remains available in the trigger's accessible name, tooltip, and menu.

### Model label extensions

`conversation.input.model.label` is a session-scoped, inline `single` slot for the composer trigger (`placement: 'trigger'`) and each model option (`'option'`). Its owner props provide `provider: { id, name }`, the catalog `model` (its `name` is the label the picker shows — the catalog name, or a readable name derived from the id when the catalog repeats it — while `id` stays exact), `placement`, and `selected`. Provider names are localized display names; match channels by `provider.id`, and identify a model by the provider/model ID pair. Connection URLs and credentials are not passed to the slot.

Contributions must render non-interactive inline content, such as a colored name or badge. The selector owns clicks, search, focus, disabled states, check marks, reasoning effort, and trigger accessibility text. An absent contribution, including after plugin disposal, displays the catalog name with its optional `model.badge` before the name in the trigger and after it in menus: a `Tag` in the badge's tone whose text is resolved for the active locale. Long catalog names ellipsize within the available width while the badge remains visible. A contribution replaces both and receives the badge in its owner props. The trigger and root-menu value use the slot only when the selected model is present in the displayed catalog; otherwise they keep the built-in placeholder. During refresh, retained catalog entries continue to use the slot. Open menus track label size changes to stay inside the viewport. `/model` command rows use the command popup's separate rendering API.
Import this package's `/client` declarations type-only, then register through `ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register({ name: 'conversation.input.model.label' }, ModelLabel))`. Derive `ModelLabel` props from `PropsRuntime<'conversation.input.model.label'>`; use provider IDs to choose CSS Module classes and retain `model.name` as the text. Registration follows the declaration and contributing plugin lifetimes. Without a component replacement, styles can target the enclosing label's `data-provider-id` and `data-model-id` attributes in all three placements.

### Brand marks

Vendor headings pair the brand noun with the owner's mark. The marks are vendored under [`src/client/assets/vendors`](src/client/assets/vendors/NOTICE.md): [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons) `packages/static-svg`, MIT License, Copyright (c) 2023 LobeHub — files are copied unmodified apart from their local names, and [`NOTICE.md`](src/client/assets/vendors/NOTICE.md) maps every local file to its upstream name. The marks belong to their owners and appear only to identify the provider a group routes to.

Colored marks (DeepSeek, Anthropic, Google/Gemini, Qwen) render as an `<img>` so the asset keeps its brand colors. Monochrome marks (OpenAI, xAI, Moonshot, Z.ai, Composer/Cursor) render through `mask` with `background: currentColor`, so they follow the theme's heading color instead of painting the SVG's own black. `VendorIcon` owns that split; both the composer dialog and the `/model` popup render the same component, and the command popup carries it through `SelectOptionGroup.icon` into the shared `MenuGroup` heading.

MIT license text: Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

### Unroutable sessions

Catalog availability does not block sending with a saved selection; request execution reports missing credentials or unavailable models. Refreshes and refresh failures retain the last displayed selection and groups. A Host reset clears that display. Sign-out hides the account provider from the picker while preserving the saved provider/model ID and reasoning effort. Signing in restores the catalog name when that model is available again. Existing session logs remain unchanged.

### Selection failures

When another writer owns the Session, model-selection failures tell the user to quit other running DSH instances and retry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

Menus use the shared `MenuSurface` material, including the macOS backing for background blur; custom content follows the [menu rules](../../../docs/web-styling.md#component-rules). The composer menu uses a fixed body portal. `useAnchoredPosition` normalizes the trigger's fixed-position coordinates and updates placement on scroll, resize, visual-viewport changes, and menu-size changes. Opening the menu and changing panes measure and place the panel synchronously before paint. Placement starts above the trigger with right edges aligned and an 8px gap; both axes shift to retain a 12px viewport margin without flipping below the trigger. Panel dimensions are capped to the visible viewport, including while the keyboard is open. Model names ellipsize within the panel width while badges stay visible. Model and reasoning-effort lists scroll vertically within the panel height limit.

<details>
<summary>Implementation internals — click to expand</summary>

The composer `ModelSelect` and `/model` option builder share [provider ordering](src/client/provider-order.ts); the `/model` search uses `rankByName` within each provider, while the composer dialog uses its own vendor-aware matcher. The command supplies optional groups and `searchMode: 'fuzzy-label'` through the [popupSelect API](../ui-commands/README.md#use-this-package); both entries use `MenuGroup` and rebuild its sticky observer when the rendered groups change. The command popup fills the composer overlay and keeps `MenuGroup`'s sticky observer, while the composer dialog renders its own sections.

Two entries over ONE per-session directory owned by `ModelDirectoryResolver` (`ctx.modelDirectories`): the `/model` popupSelect contribution (registered through `ctx.commandUi`) and the composer's named `conversation.input.model` seat both load the session's available directory through `session.models` and submit through `session.selectModel` via the same `ModelDirectory` instance, so a switch made in either entry is what the other shows next. Directory loads and selections share a generation counter so an older response never overwrites a newer one. The directory publishes the latest submitted selection as `pending` until it settles or a connection reset invalidates it; a connection reset drops every resident projection and repulls the Host-restored selection before display. Directories are per-session, resolved lazily, and disposed with the session scope; addressed subagent sessions expose neither entry. Every resident directory refetches directly on forwarded `llm/adapters-updated`, `llm/models-updated`, `settings/document-updated`, and credential update events.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the model surface is not enough. They move from the browser surfaces to the command popup shell and the selection contract.

- [ui-commands](../ui-commands/README.md) — the popupSelect shell the `/model` contribution registers into.
- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.model` seat.
- [dsh-agent-default-model](../../core/agent-default-model/README.md) — the default-model service for sessions that never choose.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `session.selectModel` selection both entries submit: the Host snapshots the complete `ModelSelection` at the next prompt-assembly boundary and owns the model-visible effect, while a running step keeps its assembled selection.

#### KV Cache effect

Switching the route can reduce or invalidate provider-side cache reuse for subsequent requests; the prompt prefix itself is untouched.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current model surface. They are current package constraints, not a general model-router comparison or a task backlog.

- **No create-time or addressed-subagent selection** — both entries require an existing ordinary session's Agent; there is no draft-phase model choice to fold into session creation, and subagent continuation deliberately exposes no independent model-selection contract.
- **Directory names are presentation-only** — selection and persistence use provider/model/effort ids; a provider whose catalog or exact-model metadata lookup fails lists as an unselectable failure row until reload.
- **No arbitrary effort input** — the composer offers only the exact model's adapter-advertised levels; an adapter without reasoning metadata leaves the Effort row absent.
- **Badges label the composer seat only** — `/model` popup rows, the trigger's accessible name, and its tooltip keep the plain catalog name.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
