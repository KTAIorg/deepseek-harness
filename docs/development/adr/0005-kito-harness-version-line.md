# ADR 0005：Kito Harness 用自己的版本线

日期：2026-11-10

状态：已接受

## 背景

Kito Harness 每次发版都运行 `pnpm release:dsh <版本>`，把根目录、`apps/*` 和 `packages/*/*` 共 380 个 `package.json` 的版本号一起改掉。这个版本号是 DeepSeek Harness 的版本线，上游才发到 `0.2.2-rc.1`，fork 已经用到 `0.2.2-rc.10`。由此有三个问题：

- 上游发到 `0.2.2-rc.5` 以后，同一个版本号在两边指向不同的代码。fork 远端还推过 5 个 `dsh-v0.2.2-rc.*` tag，其中 `rc.7` 和同号的 `kito-harness-v` tag 指向不同的提交。这些 tag 没有被任何工作流使用。
- 上游每个发布提交都改这 380 行，fork 每次合并都在这些行上冲突。
- 插件用 `engines.dsh` 或 dsh peer 版本声明兼容范围，运行时按清单版本判断。fork 自增的版本号让这个判断偏离上游的真实版本。

ADR 0004 把它列为待定问题。

## 决策

版本号分成两条线。

| | 来源 | 谁读它 |
|---|---|---|
| dsh 版本 | 各 `package.json` 的 `version`，等于已合并的上游发行版本 | 随包运行时、自带 `dsh` 命令的 `--version`、插件兼容性判断、`pnpm run constraints` 的版本一致性检查 |
| Kito Harness 版本 | `kt/kito-harness/version.json` 的 `version` | 安装包文件名；应用的 `app.getVersion()`（“关于”、更新源比较、Sentry release）；`kito` 客户端构建的 `DSH_CLIENT_VERSION`（界面版本号、账户请求里的客户端版本） |

- fork 不运行 `pnpm release:dsh` 来发版，不推送 `dsh-v*` tag。fork 自有的包（`packages/llm/llm-ktapi`、`packages/client/ui-brand-kito`）的清单版本跟随上游版本。
- 发版时只改 `kt/kito-harness/version.json`，tag 用 `kito-harness-v<Kito Harness 版本>`。
- 这个文件现在是 `0.2.2-rc.10`，即最后一个已发布的版本。下一次发版把它改成 `1.0.0-rc.1`，之后沿 `1.x` 递增。新版本必须大于 `0.2.2-rc.10`，已安装的客户端只向上更新。
- 打包时传入的构建版本（`--build-version`、`DSH_DESKTOP_BUILD_VERSION`）必须以 Kito Harness 版本为前缀。
- 只在 fork 里存在的破坏性变更，升级指南写在 `docs/kito-upgrade-guide/v<Kito Harness 版本>/`。`docs/upgrade-guide/` 只放随上游合并进来的指南。目录里的版本是写指南时 `kt/kito-harness/version.json` 的值，指南描述从那个版本升级到下一个版本要做的事。

读取点是 `scripts/kito-harness-version.mjs`。

## 理由

上游的打包脚本已经区分“清单声明的版本”和“这次构建发布的版本”，并在打包后按清单版本核对随包运行时。Kito Harness 版本接在“发布的版本”这一侧，改动只有三个调用点，运行时的核对不受影响。

上游已有的构建版本号（`0.2.2-rc.1.<日期>.<序号>`）不能直接用：它在语义化版本里排在 `0.2.2-rc.10` 之前，已安装的 `0.2.2-rc.10` 不会更新到它。

## 上游合并时重放

| 文件 | 必须仍在 |
|---|---|
| `scripts/client-build-environment.ts` | `kito` 构建档的 `DSH_CLIENT_VERSION` 取 Kito Harness 版本 |
| `apps/desktop/scripts/electron-builder-config.mjs` | 发布版本以 Kito Harness 版本为基础；打包后核对运行时仍用清单版本 |
| `apps/desktop/scripts/package-target.ts` | 三处发布版本以 Kito Harness 版本为基础 |
| `scripts/verify-upgrade-guides.ts` | 同时检查 `docs/kito-upgrade-guide` |
| `.agents/skills/dsh-create-upgrade-guide/SKILL.md` | 说明 fork 独有变更的指南位置 |

合并上游发行 tag 之后，把 `packages/llm/llm-ktapi/package.json` 和 `packages/client/ui-brand-kito/package.json` 的版本改成上游的新版本；`pnpm run constraints` 会指出遗漏。

## 后果

- 自带 `dsh` 命令的 `--version` 从 `0.2.2-rc.10` 变成 `0.2.2-rc.1`。它报告的是 dsh 版本。
- 声明了 `0.2.2-rc.2` 到 `0.2.2-rc.10` 之间 dsh 版本要求的插件，在新版本里判为不兼容。上游没有发布过这些版本，这样的声明只可能来自针对 fork 版本号编写的插件。
- 开发模式（`pnpm run dev:desktop`）和未选 `kito` 构建档的客户端显示 dsh 版本。
- 上游的桌面上传和发布脚本（`desktop-upload-plan.ts`、`desktop-ci-version.mjs`、`retain-desktop-ci.ts` 等）仍按清单版本校验。fork 不运行这些流程；要运行时再接到 Kito Harness 版本上。

## 非目标

- “关于”窗口不显示上游基线版本。基线版本是发布 tag 处根 `package.json` 的 `version`，写进 Release 说明。
- 不移动 `packages/llm/llm-ktapi` 和 `packages/client/ui-brand-kito`，不改它们的 `@deepseek-ai` 包名。这仍是 ADR 0004 的待定问题。
