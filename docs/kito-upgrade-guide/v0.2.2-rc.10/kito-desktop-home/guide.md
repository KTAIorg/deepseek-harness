---
kind: upgrade-guide
description: "Kito Harness Desktop and its installed command read KITO_HARNESS_HOME instead of DSH_HOME, so a launch environment that relocated the home with DSH_HOME must set the new variable."
---

# Kito Desktop home variable

English | [中文](guide.zh.md)

## Change

Kito Harness Desktop previously used an inherited `DSH_HOME` as its home, and its installed `dsh` command used `DSH_HOME` or `~/.dsh`. `DSH_HOME` and `~/.dsh` name the DeepSeek Harness home, so either path could prepare a Kito profile inside a DeepSeek Harness home and add the `ktapi` bundle to that product's `desktop` profile.

Desktop and the installed command now read `KITO_HARNESS_HOME` and default to `~/.kito-harness`. They ignore an inherited `DSH_HOME` and publish the resolved home as `DSH_HOME` to the processes they start. The Windows uninstaller protects the directory named by `KITO_HARNESS_HOME`. ADR 0004 (`docs/development/adr/0004-kito-names-apart-from-deepseek-harness.md`) records the rule.

This affects a launch environment that sets `DSH_HOME` to relocate Kito Harness, and terminal use of the installed command that relied on `~/.dsh`. Desktop started without `DSH_HOME` is unaffected. The npm `dsh` command is unchanged.

## Migration

1. In the environment that launches Kito Harness, replace `DSH_HOME=<directory>` with `KITO_HARNESS_HOME=<directory>`. The login-shell environment is not consulted for either variable.
2. For the installed command, set `KITO_HARNESS_HOME` in the terminal, or move the profiles and Sessions you created under `~/.dsh` with that command into `~/.kito-harness`. Leave the `desktop` profile of a DeepSeek Harness installation in place.
3. On Windows, set `KITO_HARNESS_HOME` before running the uninstaller when the home is inside the installation directory.
4. If a DeepSeek Harness `desktop` profile lists `@deepseek-ai/dsh-llm-ktapi` under `dsh.profile.bundles` in its `package.json`, quit that application and delete the entry. DeepSeek Harness does not carry the package.
