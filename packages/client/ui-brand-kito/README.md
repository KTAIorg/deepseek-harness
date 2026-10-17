---
description: "Kito Harness brand occupants for the sidebar. Official DeepSeek builds leave these slots empty."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-kito

## Summary

This package puts the Kito Harness name and desktop icon in the sidebar for every client build except the official DeepSeek profile. A local build also shows a short local marker and the product version, without the commit hash. A packaged `kito` build shows the name alone. The sidebar account row and the Settings account page show the signed-in Telegram name. It does not change the conversation hero or model requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin beside the official brand plugin. The official plugin registers only when `DSH_CLIENT_BUILD_PROFILE` is `official`; this plugin registers for every other profile, including an unset local build and the packaged `kito` profile. The mark is the desktop application icon at `apps/desktop/resources/icon.png`. The window title is `DSH_CLIENT_TITLE`, set to `Kito Harness` by the `kito` profile and by the desktop development build.

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
