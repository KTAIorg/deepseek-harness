---
kind: upgrade-guide
description: "Kito Harness Desktop registers only the kito-harness URL scheme, so links and scripts that reopen its window with dsh://open must use kito-harness://open."
---

# Kito Desktop URL scheme

English | [中文](guide.zh.md)

## Change

Kito Harness Desktop previously registered the `dsh` and `kito-harness` URL schemes and reopened its window for `dsh://open`. `dsh` is the DeepSeek Harness scheme. With both products installed, the operating system delivered `dsh://open` to whichever application registered last.

Desktop now registers only `kito-harness` and reopens its window only for `kito-harness://open`. At startup it withdraws its own earlier `dsh` registration. ADR 0004 (`docs/development/adr/0004-kito-names-apart-from-deepseek-harness.md`) records the rule.

This affects links, shortcuts, and scripts that open `dsh://open` to bring Kito Harness forward.

## Migration

1. Replace `dsh://open` with `kito-harness://open` wherever it targets Kito Harness.
2. Start the updated Kito Harness once so that it withdraws its `dsh` registration.
3. If DeepSeek Harness is installed and `dsh://open` does not reach it afterwards, start DeepSeek Harness once; it registers the scheme at startup.
