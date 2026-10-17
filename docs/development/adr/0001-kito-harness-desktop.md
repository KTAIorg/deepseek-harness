# ADR 0001：Kito 以独立桌面集成 DeepSeek Harness

日期：2026-10-17

状态：已接受

## 背景

Kito 今天是 OpenCode 的独立桌面，和 KT 客户端平级，共用 KT Identity 与 NewAPI。DeepSeek Harness `dsh-v0.2.1-rc.2` 自己带完整 Electron 桌面：壳、Web 客户端和 dsh 运行时按同一个版本发布，并独占 `$DSH_HOME/profiles/desktop`。ACK 上的 `dsh-auth-gateway` 只守公网 Web 入口。

## 决策

Kito Harness 是和 Kito（OpenCode）平级的独立桌面，基线为上游发行 tag，不嵌进 Kito 进程。

复用方式是 wrap：

- 上游保留 Agent loop、会话格式、工具、沙箱和 Web 客户端。
- `KTAIorg/deepseek-harness` 只保留部署白名单、`kt/kito-provider`，以及以后的桌面壳（品牌、欢迎页、更新地址、独立 `DSH_HOME`）。
- KT Identity 登录和 `https://ktapi.cc/v1` 模型路由放在 `kt/kito-provider`。它不加入 pnpm workspace，用 `dsh plugin add ./kt/kito-provider` 装进 profile。
- 模型密钥经凭证引用 `KITO_NEWAPI_API_KEY` 解析。安装包不内置共享 NewAPI key。
- 设备登录沿用已注册的 `client_type=kito_desktop`、`client_id=kito-desktop`。Identity 当前只接受 `kt_cli` 与 `kito_desktop`。托管 token 名沿用 `kito`，两个桌面共用同一把账号 key。
- 发布走 Kito Release Service 的单独 app id。Tag 用 `kito-harness-v*`，不打上游的 `vX.Y.Z` / `dsh-v*`。
- ACK Web 继续由 `dsh-auth-gateway` 做入口认证。桌面不经过这个网关。

## 理由

Harness 的扩展点是插件和 `cordis.patch.yml`，不是改 agent loop。把整仓当 OpenCode 那样大面积打补丁，会在 pre-stable API 上每发一个 tag 都重放一遍。2026-07-26 已否决把 OpenCode 嵌进 KT 客户端；Harness 的单实例锁、profile 所有权和更新单元使嵌进程更不成立。

## 非目标

- 不把 Harness 嵌进 Kito 或旧 KT Desktop。
- 不复制 Kito 的 Zen 100 次软限额。Harness 没有免登录免费模型。
- 不在本 ADR 里改欢迎页、签名或更新源。那是壳层后续 PR。
- 不新开一套按 `kt_account_id` 发 NewAPI token 的服务。沿用 Kito 已在用的 `/api/iam/token/ensure`，404 时回落到 `/api/iam/ensure` 会话换票。

## 约束

- 同步只合上游发行 tag。安全修复立即评估。
- 定制超出 `docs/development/upstream-sync-policy.md` 白名单时，PR 必须写明现有扩展点为什么不够。
- Identity Bearer 与 NewAPI key 分开存放。配置文件里只有凭证名。
- 桌面数据目录与官方 DeepSeek Harness 隔离，避免抢 `profiles/desktop`。

## 待定问题

对外名称已定为 **Kito Harness**（应用标识 `cc.ktapi.harness`，数据目录 `~/.kito-harness`，生产更新源 `https://updates.ktyun.cc/kito-harness/`）。它和现有 Kito 桌面分开，避免抢 `userData` 和 `~/.dsh`。打包时仍通过 `DSH_DESKTOP_APP_ID` 传入 `cc.ktapi.harness`。更新清单要发到这个源之后，已安装的客户端才能检查更新。
