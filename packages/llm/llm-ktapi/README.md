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

The account's listing is read by the shared pi-ai live-catalog reader (`GET {baseURL}/models`
with the relay key derived
from the KT Identity login; pricing comes from the shared `GET /api/pricing`, which
needs no credential.

The route reads two credential references: the relay key (`KITO_NEWAPI_API_KEY`)
and the KT Identity session the desktop derives it from (`KITO_IDENTITY_TOKEN`).
A stored session with no relay key fails the route instead of offering nothing,
because the account is signed in and a derivation that silently produced no key
would otherwise be indistinguishable from an empty catalog.

## Use this package

```ts
import { buildKtapiCatalog } from '@deepseek-ai/dsh-llm-ktapi'

const catalog = buildKtapiCatalog(await fetchLiveCatalog(modelsUrl, apiKey), await pricingResponse.json())
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

- **Reasoning depends on the gateway declaring it** — a listing row without a
  `reasoning` object describes a model that reads no reasoning parameter, because
  the route has no installed catalog entry to inherit capability from.
- **Output cap is a fixed default** — pricing rows publish no output-token cap, so
  every entry advertises `DEFAULT_OUTPUT` until a listing field supplies one.
- **Pricing is account-independent** — the shared payload cannot express a per-account
  ratio, so a discounted account still shows the shared price.
