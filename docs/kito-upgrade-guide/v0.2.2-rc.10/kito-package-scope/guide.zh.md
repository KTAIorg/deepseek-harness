---
kind: upgrade-guide
description: "只存在于 Kito Harness 的两个包从 @deepseek-ai scope 移到 @kito，因此按名字引用它们的 profile 和配置必须改用新名字。"
---

# Kito Harness 包名

[English](guide.md) | 中文

## 变更

有两个包只存在于 Kito Harness，却起名在 DeepSeek Harness 的 `@deepseek-ai` scope 下。它们现在使用 `@kito` scope：

| 之前 | 之后 |
|---|---|
| `@deepseek-ai/dsh-llm-ktapi` | `@kito/dsh-llm-ktapi` |
| `@deepseek-ai/dsh-client-ui-brand-kito` | `@kito/dsh-client-ui-brand-kito` |

它们的目录、条目 id（`llm-ktapi`、`ui-brand-kito`）、配置字段和 `ktapi` provider id 都不变。规则记录在 ADR 0004（`docs/development/adr/0004-kito-names-apart-from-deepseek-harness.md`）。

Kito Harness 桌面应用在下一次启动时改写它自己的 `desktop` profile 里的这一项。其它 bundle 和你安装的插件保持原样。这里不需要任何操作。

其它按名字引用这两个包的地方都受影响：

- 桌面以外的 profile，在 `dsh.profile.bundles` 里列有 `@deepseek-ai/dsh-llm-ktapi`。加载器报告 `skipping profile bundle "@deepseek-ai/dsh-llm-ktapi"`，启动后没有 `ktapi` 路由。
- `cordis.yml` 或 `cordis.patch.yml` 里 `name` 为旧包名的条目。
- 使用旧名字的 `package.json` 依赖或源码 import。

## 迁移

1. 在每个受影响的 profile 里打开 `package.json`，把 `dsh.profile.bundles` 下的 `@deepseek-ai/dsh-llm-ktapi` 换成 `@kito/dsh-llm-ktapi`。
2. 在你自己的 `cordis.yml` 和 `cordis.patch.yml` 里，替换条目 `name` 字段中的旧包名。条目的 `id` 保持不变。
3. 在依赖这两个包的代码和清单里，替换 `dependencies` 和 import 说明符中的旧名字。
4. 运行 `dsh --profile <name> --dump-config`，确认输出里没有 `skipping profile bundle` 这一行，并且包含 `@kito/dsh-llm-ktapi`。
