---
kind: upgrade-guide
description: "Kito Harness 的发布版本现在和它随包携带的 dsh 包分开编号，因此安装的 dsh 命令报告 0.2.2-rc.1，插件的 dsh 版本要求也按这个版本检查。"
---

# Kito Harness 版本线

[English](guide.md) | 中文

## 变更

到 `0.2.2-rc.10` 为止，Kito Harness 每次发版都把发布版本号写进所有 `package.json`。这个编号属于 DeepSeek Harness 的版本线，而该版本线的最新发行版是 `0.2.2-rc.1`。

现在所有 `package.json` 保持已合并的上游发行版的 dsh 版本，即 `0.2.2-rc.1`。Kito Harness 的发布版本放在 `kt/kito-harness/version.json`。应用版本、安装包文件名、更新源和界面里显示的版本使用 Kito Harness 版本。规则记录在 ADR 0005（`docs/development/adr/0005-kito-harness-version-line.md`）。

受影响的是：

- 安装的 `dsh --version`。它报告 dsh 版本，因此从 `0.2.2-rc.10` 变为 `0.2.2-rc.1`。
- 通过 `engines.dsh` 或 `@deepseek-ai/dsh-*` peer 范围声明 dsh 版本要求的插件。要求按 `0.2.2-rc.1` 检查，因此需要 `0.2.2-rc.2` 到 `0.2.2-rc.10` 的范围会被报告为不兼容。
- 发布工作。`pnpm release:dsh` 不再为 Kito Harness 的发布编号，`--build-version` 必须以 Kito Harness 版本为前缀，fork 仓库不再带有 `dsh-v0.2.2-rc.5`、`rc.7`、`rc.8`、`rc.9` 和 `rc.10` 这些 tag。

已安装的应用不受影响：下一个发布版本是 `1.0.0-rc.1`，更新程序把它排在 `0.2.2-rc.10` 之后。

## 迁移

1. 针对 Kito Harness 版本号编写的插件，把 dsh 版本要求改成它实际需要的上游版本，例如 `>=0.2.2-rc.1`。
2. 用 `dsh --version` 识别 Kito Harness 发布版本的脚本，改为读取应用版本；安装包文件名和“关于”对话框带有它。
3. 发布时，设置 `kt/kito-harness/version.json` 里的 `version`，合并这项改动，并给合并后的提交打 `kito-harness-v<version>` tag。不要运行 `pnpm release:dsh`，也不要推送 `dsh-v*` tag。
4. 在已有的克隆里删除这些已移除的 tag，避免 `git push --tags` 把它们恢复：`git tag -d dsh-v0.2.2-rc.5 dsh-v0.2.2-rc.7 dsh-v0.2.2-rc.8 dsh-v0.2.2-rc.9 dsh-v0.2.2-rc.10`。
