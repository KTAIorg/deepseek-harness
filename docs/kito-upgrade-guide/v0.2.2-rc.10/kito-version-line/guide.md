---
kind: upgrade-guide
description: "Kito Harness now numbers its releases apart from the dsh packages it bundles, so the installed dsh command reports 0.2.2-rc.1 and plugin dsh requirements are checked against that version."
---

# Kito Harness version line

English | [中文](guide.zh.md)

## Change

Kito Harness releases through `0.2.2-rc.10` wrote their release number into every `package.json`. That number belongs to the DeepSeek Harness version line, whose latest release is `0.2.2-rc.1`.

Every `package.json` now keeps the dsh version of the merged upstream release, `0.2.2-rc.1`. The Kito Harness release version lives in `kt/kito-harness/version.json`. The application version, installer file names, the update feed, and the version shown in the interface use the Kito Harness version. ADR 0005 (`docs/development/adr/0005-kito-harness-version-line.md`) records the rule.

This affects:

- The installed `dsh --version`, which reports the dsh version and so changes from `0.2.2-rc.10` to `0.2.2-rc.1`.
- A plugin that declares a dsh requirement through `engines.dsh` or a `@deepseek-ai/dsh-*` peer range. The requirement is checked against `0.2.2-rc.1`, so a range that needs `0.2.2-rc.2` through `0.2.2-rc.10` is reported as incompatible.
- Release work. `pnpm release:dsh` no longer numbers a Kito Harness release, a `--build-version` must extend the Kito Harness version, and the fork repository no longer carries the tags `dsh-v0.2.2-rc.5`, `rc.7`, `rc.8`, `rc.9`, and `rc.10`.

Installed applications are unaffected: the next release is `1.0.0-rc.1`, which the updater orders above `0.2.2-rc.10`.

## Migration

1. In a plugin written against Kito Harness version numbers, change the dsh requirement to the upstream version it needs, for example `>=0.2.2-rc.1`.
2. In a script that identifies the Kito Harness release from `dsh --version`, read the application version instead; the installer file name and the About dialog carry it.
3. To release, set `version` in `kt/kito-harness/version.json`, merge that change, and tag the merged commit `kito-harness-v<version>`. Do not run `pnpm release:dsh` and do not push a `dsh-v*` tag.
4. In an existing clone, delete the removed tags so that `git push --tags` does not restore them: `git tag -d dsh-v0.2.2-rc.5 dsh-v0.2.2-rc.7 dsh-v0.2.2-rc.8 dsh-v0.2.2-rc.9 dsh-v0.2.2-rc.10`.
