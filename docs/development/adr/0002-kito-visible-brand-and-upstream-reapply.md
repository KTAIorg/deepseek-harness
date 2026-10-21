# ADR 0002：Kito 可见品牌与上游合并重放清单

日期：2026-10-18

状态：已接受

## 背景

Kito Harness 跟着 DeepSeek Harness 的发行 tag 合并。可见名称如果直接改上游文案，下一次合并会把「DSH 本地构建」、鱼标和 DeepSeek 标题带回来，Agent 也不知道哪些改动必须重放。ADR 0001 已经把产品名定为 Kito Harness，并要求定制留在白名单里。

本仓的操作清单是 `docs/development/upstream-sync-policy.md`。Agent 接到本仓任务时先读它和本 ADR。另写一份 Skill 会和仓库脱节：Skill 不随 PR 走，下一次换机器或换 Agent 就会漏。

## 决策

可见品牌走客户端插槽和单独的构建 profile，不改上游对话文案。

- 侧栏标志和名称由 `packages/client/ui-brand-kito` 占用 `sidebar.brand.mark` 与 `sidebar.brand.name`。`official` profile 不登记，官方鱼标和字标保持原样。
- 标志使用 `apps/desktop/resources/icon.png`。
- 本地构建显示「Kito Harness」、本地标记和产品版本，不显示提交号和 `dirty`。
- 打包构建使用 `DSH_BUILD_CLIENT_PROFILE=kito`。它把 `DSH_CLIENT_TITLE` 固定为 `Kito Harness`，侧栏只显示产品名。桌面命令是 `pnpm --dir apps/desktop run build:client`。
- 桌面开发构建不设置 profile，只把 `DSH_CLIENT_TITLE` 设为 `Kito Harness`，以便保留本地版本行。
- 空会话标题、预览徽章和模型 id 展示保持上游原文。

每次把上游发行 tag 合并进 `upstream-sync/*` 时，按下表重放。表里没有的上游行为直接采用上游。

| 表面 | 必须仍在 | 不要重放成 Kito |
|---|---|---|
| 侧栏品牌 | `ui-brand-kito` 仍挂在 `packages/bundle/web-app/cordis.patch.yml`，依赖仍在该包的 `package.json` | 官方 `ui-brand-official` 的 `official` 分支 |
| 窗口标题 | 开发构建写入 `DSH_CLIENT_TITLE=Kito Harness`；打包构建使用 `kito` profile | `scripts/client-build-environment.ts` 里的 `OFFICIAL_CLIENT_BUILD_ENVIRONMENT` |
| 桌面壳 | 产品名 Kito Harness、图标、欢迎页、`~/.kito-harness`、更新源 `https://updates.ktyun.cc` | 上游安装器里与产品名无关的新检查 |
| 身份与模型 | `kt/kito-provider` 和桌面登录仍指向 KT Identity 与 `https://ktapi.cc/v1` | 官方模型目录 `deepseek-flash` / `deepseek-v4-pro` |
| 账号与充值 | 侧栏和设置里的账号页显示 Telegram 昵称、KT 账号编号、Telegram 用户名和 NewAPI 可花余额，编号和用户名可以复制；余额打开 `https://www.ktapi.cc/wallet`。登录过期时用 `KITO_IDENTITY_REFRESH_TOKEN` 续期；没有登录但模型密钥有效时显示余额和登录按钮；退出删除 Identity 凭据、保留模型密钥。语言切换在侧栏账号下方，写入现有界面语言偏好 | 不另建一套账本，不另做一套语言包 |
| 开发错误收集 | `apps/desktop/src/kito-sentry.ts` 在致命失败时上报；DSN 只来自 `DSH_SENTRY_DSN` | 不把 DSN 写进仓库，不挂 Telegram 或分派 hook |
| 网页版 | 镜像用 `pnpm run build:kito` 构建，侧栏品牌和语言切换与打包桌面一致；Telegram 账号入口只在桌面壳（`dshDesktop`）登记，网页由 `dsh-auth-gateway` 登录 | 不在网页显示 Telegram 登录和 `dsh-app://` 账号入口 |
| 会话首屏 | 保持上游 | 不把「探索未至之境」改成 Kito 文案 |
| Agent | 保持上游 | 不改 agent loop、会话格式、工具实现 |

合并冲突时，安全修复以上游为准。上表里的 Kito 表面在解完冲突后按本表核对，缺一项就补回，并在同步记录里写明。

## 理由

插槽和 profile 是上游已经提供的扩展点。品牌包是新增文件，合并时不会和上游正文冲突；需要重放的只有挂载点和构建 profile。清单放在本 ADR，执行顺序放在同步策略，Agent 读仓库就能知道合并什么、留下什么。

## 非目标

- 不把这份清单做成 Skill。
- 不改空会话文案和模型选择器里的原始 id。
- 不替换官方 DeepSeek 产物的标题和品牌。

## 约束

- 同步只合上游发行 tag。
- 新增可见品牌时先改本表，再改代码。
- `official` profile 的环境断言保持 DeepSeek Harness。
