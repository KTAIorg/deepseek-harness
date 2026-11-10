---
kind: upgrade-guide
description: "The two packages that exist only in Kito Harness move from the @deepseek-ai scope to @kito, so profiles and configuration that name them must use the new names."
---

# Kito Harness package names

English | [中文](guide.zh.md)

## Change

Two packages exist only in Kito Harness and were named in DeepSeek Harness's `@deepseek-ai` scope. They now use the `@kito` scope:

| Before | After |
|---|---|
| `@deepseek-ai/dsh-llm-ktapi` | `@kito/dsh-llm-ktapi` |
| `@deepseek-ai/dsh-client-ui-brand-kito` | `@kito/dsh-client-ui-brand-kito` |

Their directories, entry ids (`llm-ktapi`, `ui-brand-kito`), configuration fields, and the `ktapi` provider id are unchanged. ADR 0004 (`docs/development/adr/0004-kito-names-apart-from-deepseek-harness.md`) records the rule.

The Kito Harness desktop application renames the entry in its own `desktop` profile at the next start. It leaves every other bundle and every plugin you installed as written. No action is needed there.

Every other place that names the packages is affected:

- A profile other than the desktop one that lists `@deepseek-ai/dsh-llm-ktapi` under `dsh.profile.bundles`. The loader reports `skipping profile bundle "@deepseek-ai/dsh-llm-ktapi"` and starts without the `ktapi` route.
- A `cordis.yml` or `cordis.patch.yml` entry whose `name` is one of the old package names.
- A `package.json` dependency or a source import that uses an old name.

## Migration

1. In each affected profile, open `package.json` and replace `@deepseek-ai/dsh-llm-ktapi` with `@kito/dsh-llm-ktapi` under `dsh.profile.bundles`.
2. In your own `cordis.yml` and `cordis.patch.yml` files, replace the old package names in entry `name` fields. Keep the entry `id` values.
3. In code and manifests that depend on the packages, replace the old names in `dependencies` and in import specifiers.
4. Run `dsh --profile <name> --dump-config` and confirm that the output has no `skipping profile bundle` line and contains `@kito/dsh-llm-ktapi`.
