---
kind: upgrade-guide
description: "ktapi 路由现在每个模型只提供一个模型 id，因此指向被合并写法的 Session 或默认模型设置必须重新选择模型。"
---

# ktapi 模型 id

[English](guide.md) | 中文

## 变更

`ktapi` 提供方原先对网关列表中的每种写法，按小写并去掉前缀后各提供一个模型 id。网关同时列出点号版本和连字符版本，或同时列出带日期快照的模型，会出现多次：`claude-opus-4.5`、`claude-opus-4-5` 和 `claude-opus-4-5-20251101` 是三个可选 id。部分提供的 id 由带前缀的写法改写而来，并不是网关列出的 id，例如由 `openai/gpt-oss-120b` 得到的 `gpt-oss-120b`。

现在提供方每个模型只提供一个 id，且该 id 一定是网关列出的 id。`claude-opus-4-5` 代表上述三种写法，`openai/gpt-oss-120b` 取代 `gpt-oss-120b`。网关没有列出不带日期的 id 时，带日期的快照仍是独立的 id。[`foldListing`](../../../../packages/llm/llm-ktapi/src/catalog.ts) 的文档说明选用哪个列出的 id。

不再提供的 id 不是该路由的模型。这会影响模型为这类 id 的 Session，以及 `agent-default-model` 指向这类 id 的 profile：在重新选择模型之前，发送消息会失败并提示“Select an available model before sending a message.”。条目显示的价格和分组现在取自它实际发送的 id；网关对同一模型的不同写法定价不同。

## 迁移

1. 在每个受影响的 Session 中打开模型选择器，重新选择该模型。选择器中该模型只出现一次。
2. 在 profile 的 `cordis.patch.yml` 中，把 `agent-default-model` 配置下的 `model` 设为提供的 id：网关列出时使用连字符且不带日期的 id（`claude-opus-4-8`，而不是 `claude-opus-4.8` 或 `-2025…` 快照），或列出的带前缀 id（`openai/gpt-oss-120b`）。
3. 在该 Session 中发送一条消息。本轮对话不再出现模型提示即表示迁移成功。
