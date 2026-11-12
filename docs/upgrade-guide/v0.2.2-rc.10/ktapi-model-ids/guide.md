---
kind: upgrade-guide
description: "The ktapi route now offers one model id per model, so a Session or default-model setting that names a folded spelling must select a model again."
---

# ktapi model ids

English | [中文](guide.zh.md)

## Change

The `ktapi` provider previously offered one model id per lowercase, prefix-stripped spelling of the gateway listing. A model that the gateway lists with a dotted and a hyphenated version, or with a dated snapshot, appeared several times: `claude-opus-4.5`, `claude-opus-4-5`, and `claude-opus-4-5-20251101` were three selectable ids. Some offered ids were rebuilt from a prefixed spelling and were not ids the gateway lists, for example `gpt-oss-120b` from `openai/gpt-oss-120b`.

The provider now offers one id per model, and that id is always one the gateway lists. `claude-opus-4-5` stands for all three spellings above, and `openai/gpt-oss-120b` replaces `gpt-oss-120b`. A dated snapshot stays a separate id when the gateway does not list its undated id. [`foldListing`](../../../../packages/llm/llm-ktapi/src/catalog.ts) documents which listed id is chosen.

An id that is no longer offered is not a model of the route. This affects a Session whose model is such an id and a profile whose `agent-default-model` names one: sending a message fails with "Select an available model before sending a message." until a model is selected. Price and group shown for an entry are now those of the id it sends; the gateway prices spellings of one model differently.

## Migration

1. Open the model selector in each affected Session and select the model again. The selector shows it once.
2. In `cordis.patch.yml` of the profile, set `model` under the `agent-default-model` configuration to an offered id: the hyphenated, undated id where the gateway lists one (`claude-opus-4-8`, not `claude-opus-4.8` or a `-2025…` snapshot), or the listed prefixed id (`openai/gpt-oss-120b`).
3. Send a message in the Session. The migration worked when the turn starts without the model prompt.
