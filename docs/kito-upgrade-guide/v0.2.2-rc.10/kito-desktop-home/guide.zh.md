---
kind: upgrade-guide
description: "Kito Harness Desktop 及其安装的命令改为读取 KITO_HARNESS_HOME，不再读取 DSH_HOME，因此用 DSH_HOME 迁移过主目录的启动环境必须设置新变量。"
---

# Kito Desktop 主目录变量

[English](guide.md) | 中文

## 变更

Kito Harness Desktop 原先把继承来的 `DSH_HOME` 当作自己的主目录，它安装的 `dsh` 命令使用 `DSH_HOME` 或 `~/.dsh`。`DSH_HOME` 和 `~/.dsh` 是 DeepSeek Harness 主目录的名字，因此这两条路径都可能在 DeepSeek Harness 的主目录里准备 Kito 的 profile，并把 `ktapi` bundle 写进该产品的 `desktop` profile。

Desktop 和安装的命令现在读取 `KITO_HARNESS_HOME`，默认使用 `~/.kito-harness`。它们忽略继承来的 `DSH_HOME`，并把解析出的主目录作为 `DSH_HOME` 传给自己启动的进程。Windows 卸载程序保护 `KITO_HARNESS_HOME` 指向的目录。规则记录在 ADR 0004（`docs/development/adr/0004-kito-names-apart-from-deepseek-harness.md`）。

受影响的是用 `DSH_HOME` 迁移 Kito Harness 主目录的启动环境，以及在终端里依赖 `~/.dsh` 使用安装命令的场景。未设置 `DSH_HOME` 启动的 Desktop 不受影响。npm 安装的 `dsh` 命令没有变化。

## 迁移

1. 在启动 Kito Harness 的环境中，把 `DSH_HOME=<目录>` 换成 `KITO_HARNESS_HOME=<目录>`。这两个变量都不从登录 shell 环境读取。
2. 使用安装的命令时，在终端里设置 `KITO_HARNESS_HOME`，或者把你用该命令在 `~/.dsh` 下创建的 profile 和 Session 移到 `~/.kito-harness`。DeepSeek Harness 安装的 `desktop` profile 留在原处。
3. 在 Windows 上，主目录位于安装目录内时，运行卸载程序之前先设置 `KITO_HARNESS_HOME`。
4. 如果 DeepSeek Harness 的 `desktop` profile 在 `package.json` 的 `dsh.profile.bundles` 中列有 `@deepseek-ai/dsh-llm-ktapi`，退出该应用后删除这一项。DeepSeek Harness 不携带这个包。
