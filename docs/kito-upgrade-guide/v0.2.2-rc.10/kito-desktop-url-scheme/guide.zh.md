---
kind: upgrade-guide
description: "Kito Harness Desktop 只注册 kito-harness URL 协议，因此用 dsh://open 找回其窗口的链接和脚本必须改用 kito-harness://open。"
---

# Kito Desktop URL 协议

[English](guide.md) | 中文

## 变更

Kito Harness Desktop 原先注册 `dsh` 和 `kito-harness` 两个 URL 协议，并在收到 `dsh://open` 时找回窗口。`dsh` 是 DeepSeek Harness 的协议。两个产品都安装时，操作系统把 `dsh://open` 交给最后注册的那个应用。

Desktop 现在只注册 `kito-harness`，只在收到 `kito-harness://open` 时找回窗口。启动时它会撤回自己以前登记的 `dsh`。规则记录在 ADR 0004（`docs/development/adr/0004-kito-names-apart-from-deepseek-harness.md`）。

受影响的是通过打开 `dsh://open` 把 Kito Harness 调到前台的链接、快捷方式和脚本。

## 迁移

1. 凡是指向 Kito Harness 的 `dsh://open`，都换成 `kito-harness://open`。
2. 启动一次更新后的 Kito Harness，让它撤回 `dsh` 的登记。
3. 如果装有 DeepSeek Harness，而之后 `dsh://open` 没有到达它，启动一次 DeepSeek Harness；它在启动时注册这个协议。
