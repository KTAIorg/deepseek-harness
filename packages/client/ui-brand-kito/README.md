---
description: "Kito Harness brand occupants for the sidebar. Official DeepSeek builds leave these slots empty."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-kito

## Summary

This package puts the Kito Harness name and desktop icon in the sidebar for every client build except the official DeepSeek profile. A local build also shows a short local marker and the product version, without the commit hash. A packaged `kito` build shows the name alone. On Desktop, a compact account row shows the Telegram name and usable balance, while Settings holds account details and sign-out. It does not change the conversation hero or model requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin beside the official brand plugin. The official plugin registers only when `DSH_CLIENT_BUILD_PROFILE` is `official`; this plugin registers for every other profile, including an unset local build and the packaged `kito` profile. The mark is the package-owned `src/client/assets/icon.png`, emitted under `lib/assets` and served through the standard client asset route. The window title is `DSH_CLIENT_TITLE`, set to `Kito Harness` by the `kito` profile and by the desktop development build. The compact language picker occupies `conversation.session.header.utilities` for an active Session, `conversation.hero.options` for a blank Session, and `conversation.header.trailing` without a selected Session. It shares the standard Menu placement and keyboard behavior and has no frame-wide overlay.

### Desktop account resource

On Desktop, `dsh-resource://kitoaccount/current` shares one validated snapshot of the shell's account projection between the sidebar, account Settings, and More. Initial loading does not offer a duplicate sign-in. A refresh failure retains the last successful snapshot and offers Retry; it never turns a failed refresh into a sign-out. The resource refreshes after the `kito-account` event, on window focus, and at the configured interval. `accountRefreshIntervalMs` is optional, defaults to `180000`, and accepts integers of at least `1000`. Releasing the last subscriber aborts an active read and removes its timer and listeners. A stored model key without Telegram keeps model access and its usable balance, with optional Telegram binding. The sidebar stays compact; Settings holds account identifiers, console links, and sign-out. Platforms with a compact rail show a state icon with an accessible name and tooltip; macOS hides the account row with the collapsed column.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits keep the brand on the slot boundary. They are current package constraints.

- **The conversation hero stays upstream** — this package does not occupy `conversation.hero.brand.mark` or replace the empty-session headline.
- **Telegram account state is Desktop-only** — ordinary Web clients do not mount the account resource, footer, or Settings account page.

### Dev Note

None.
