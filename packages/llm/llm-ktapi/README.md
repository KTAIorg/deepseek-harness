---
description: "The ktapi model catalog: normalizes the gateway listing, applies the curated Kito picks, and attaches pricing."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-ktapi

## Summary

The catalog layer for the Kito model route. ktapi names one model several ways
(`DeepSeek Latest`, `DeepSeek-Latest`, `deepseek/deepseek-latest`, `deepseek-latest`)
and prices it in a separate payload, so a selector that rendered the raw listing
would show the same model four times. This package folds every spelling into one
normalized request id, intersects the account's own listing with the curated Kito
picks, and attaches the pricing a selector shows.

The account's listing comes from `GET {baseURL}/models` with the relay key derived
from the KT Identity login; pricing comes from the shared `GET /api/pricing`, which
needs no credential.

## Use this package

```ts
import { buildKtapiCatalog } from '@deepseek-ai/dsh-llm-ktapi'

const catalog = buildKtapiCatalog(await modelsResponse.json(), await pricingResponse.json())
// catalog[0] === { id: 'deepseek-latest', name: 'DeepSeek-Latest', defaultVisible: true, … }
```

| Export | Purpose |
| --- | --- |
| `buildKtapiCatalog` | Join listing and pricing into the selector's catalog, curated picks first |
| `normalizeModelId` | Fold one spelling into the lowercase request id |
| `pickDefaultVisibleModelIds` | Choose at most one id per curated group |
| `parseModelsPayload` / `parsePricingPayload` | Read either payload defensively |
| `contextFromTags` | Read a context window from a pricing size tag |
| `KTAI_DEFAULT_VISIBLE_PICKS` | The curated table shared with the Kito coding client |

Curated order is product priority: the first alias a group carries that the
account's listing also carries becomes that group's single entry.

## Model Experience

None. This package shapes a selector's catalog; nothing here reaches a model request.

#### KV Cache effect

None; it assembles no prompt material.

## Known Limitations and Deferred Work

- **No provider registration yet** — this package is the catalog half of the ktapi
  route. Registering it as a model provider (credential resolution, request
  transport, discovery) stays with the route's owner, so the parsing stays testable
  without a gateway.
- **Output cap is a fixed default** — pricing rows publish no output-token cap, so
  every entry advertises `DEFAULT_OUTPUT` until a listing field supplies one.
- **Pricing is account-independent** — the shared payload cannot express a per-account
  ratio, so a discounted account still shows the shared price.
