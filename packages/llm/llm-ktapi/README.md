---
description: "The ktapi model catalog: folds the gateway listing into one entry per model, orders the curated Kito picks first, and attaches pricing."
kind: "package-bundle"
---

# @kito/dsh-llm-ktapi

## Summary

The catalog layer and default bundle for the Kito model route. ktapi lists one model under several ids (`DeepSeek Latest`, `deepseek/deepseek-latest`, `claude-opus-4.8`, `claude-opus-4-8`, `claude-opus-4-5-20251101`) and prices it in a separate payload, so the raw listing shows one model up to six times. This package folds those ids into one entry per model that sends a listed id, attaches the pricing a selector shows, and serves every model the account may call with the curated Kito picks first (`showAllModels`, default on; `false` restores the curated shortlist of one entry per group).

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

### Install into a profile

```text
dsh plugin --profile <name> add @kito/dsh-llm-ktapi
dsh plugin --profile <name> remove @kito/dsh-llm-ktapi
```

Mounting the package applies `cordis.patch.yml`, inserting the `llm-ktapi` provider row (`ktapi`) and configuring `agent-default-model` (`provider: ktapi`, `model: deepseek-latest`). The account's listing is read by the shared pi-ai live-catalog reader (`GET {baseURL}/models` with the relay key derived from the KT Identity login); pricing comes from the shared `GET /api/pricing`, which needs no credential.

The route reads two credential references: the relay key (`KITO_NEWAPI_API_KEY`)
and the KT Identity session the desktop derives it from (`KITO_IDENTITY_TOKEN`).
A stored session with no relay key fails the route instead of offering nothing,
because the account is signed in and a derivation that silently produced no key
would otherwise be indistinguishable from an empty catalog.

### What you get

```ts
import { buildKtapiCatalog } from '@kito/dsh-llm-ktapi'

const catalog = buildKtapiCatalog(await fetchLiveCatalog(modelsUrl, apiKey), await pricingResponse.json())
// catalog[0] === { id: 'deepseek-latest', name: 'DeepSeek Latest', aliases: ['deepseek/deepseek-latest', …], defaultVisible: true, … }
```

| Export | Purpose |
| --- | --- |
| `buildKtapiCatalog` | Join listing and pricing into the selector's catalog, curated picks first |
| `foldListing` | Fold the listed ids into one entry per model, keyed by fold key |
| `modelFoldKey` | Key shared by every listed id of one model version |
| `normalizeModelId` | Reduce one spelling to the lowercase form spellings are compared in |
| `pickDefaultVisibleKeys` | Choose at most one fold key per curated group |
| `parsePricingPayload` | Read the pricing payload defensively, keyed by the exact id each row prices |
| `contextFromTags` | Read a context window from a pricing size tag |
| `KTAI_DEFAULT_VISIBLE_PICKS` | The curated table shared with the Kito coding client |

Curated order is product priority: the first alias a group carries that the
account's listing also carries becomes that group's single entry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Ids fold into one entry when they differ only by case, a vendor prefix, spaces or underscores for hyphens, or a dot for a hyphen between two version digits (`claude-opus-4.8`, `claude-opus-4-8`). A dated snapshot (`claude-opus-4-5-20251101`) folds into its undated id only when the listing also carries that undated id.

An entry sends one of the ids the gateway listed, never an id rebuilt from another spelling, because the gateway routes and prices each listed id on its own. Among the listed ids of one model the entry sends, in order of preference: an undated id over a dated snapshot, an id in normalized form over a display spelling, a bare id over a vendor-prefixed one, then the shorter id, then the id that sorts first by code unit. The other ids are the entry's `aliases`. Price and groups are those of the id the entry sends.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

See [packages/llm/llm-pi-ai](../llm-pi-ai/README.md) for the underlying OpenAI-compatible transport and live-catalog reader.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package shapes a selector's catalog and adds nothing to model requests.

#### KV Cache effect

None; it assembles no prompt material.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Reasoning depends on the gateway declaring it** — a listing row without a
  `reasoning` object describes a model that reads no reasoning parameter, because
  the route has no installed catalog entry to inherit capability from.
- **Output cap is a fixed default** — pricing rows publish no output-token cap, so
  every entry advertises `DEFAULT_OUTPUT` until a listing field supplies one.
- **A folded id is not a model of this route** — only an entry's request id is advertised and callable. A Session or `agent-default-model` setting that names one of its `aliases` must select the entry again.
- **Pricing is account-independent** — the shared payload cannot express a per-account
  ratio, so a discounted account still shows the shared price.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
