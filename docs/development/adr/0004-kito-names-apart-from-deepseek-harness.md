# ADR 0004：Kito 不占用 DeepSeek Harness 的名字，也不改用户写的配置

日期：2026-11-10

状态：已接受

## 背景

Kito Harness 和官方 DeepSeek Harness 可以装在同一台机器上。ADR 0001 已经把数据目录、Electron userData 和应用标识分开，但还有四处会碰到对方：

- Kito 把 `DSH_HOME` 当作自己数据目录的覆盖入口。`DSH_HOME` 是官方主目录的名字，启动环境里带着它时，Kito 会在那个目录准备 `profiles/desktop`，并把 `@deepseek-ai/dsh-llm-ktapi` 写进官方 profile 的 bundle 列表。官方应用不带这个包。
- 桌面自带的终端命令 `resources/runtime/cli/bin/dsh` 不设置主目录。没有 `DSH_HOME` 时它用默认的 `~/.dsh`，`plugin --profile desktop` 管理的是官方的 profile。
- Kito 的安装包和主进程都注册了 `dsh` URL 协议。两个应用同时安装时，`dsh://open` 由谁接收取决于系统最后登记的是谁。
- `kt/kito-provider` 的 README 教人把它装进 `desktop` profile。桌面已随包携带 `llm-ktapi`，再装一次就有两条到同一网关的路由，模型列表重复。

2026-11-10 在一台同时装有两个应用的机器上核实：官方 profile `~/.dsh/profiles/desktop` 的 bundle 列表里出现了 `@deepseek-ai/dsh-llm-ktapi`，它和同目录的 `cordis.yml` 在同一分钟被写入，桌面壳每次启动都会重写这个文件；Kito profile 同时挂着随包的 `ktapi` 路由和手动安装的 `kito` 路由；把用户目录换成临时目录后运行 0.2.2-rc.10 自带的命令，它写的是 `.dsh/profiles/desktop`。

## 决策

**名字。** 官方的名字 Kito 只读不写；Kito 自己的入口都用 Kito 的名字。

| 面 | 官方 | Kito |
|---|---|---|
| 数据目录 | `~/.dsh` | `~/.kito-harness` |
| 数据目录覆盖 | `DSH_HOME` | `KITO_HARNESS_HOME` |
| URL 协议 | `dsh` | `kito-harness` |
| Electron userData | `@deepseek-ai/dsh-desktop` | `Kito Harness` |
| 应用标识 | `com.deepseek.dsh` | `cc.ktapi.harness` |
| 随包的 fork 自有包 | `@deepseek-ai/*` | `@kito/dsh-llm-ktapi`、`@kito/dsh-client-ui-brand-kito` |

- 桌面主进程不读取继承来的 `DSH_HOME`。它解析出自己的主目录后写回 `DSH_HOME`，Host 子进程和各个 Harness 包照旧读这个变量。
- 桌面自带的终端命令在启动 CLI 之前把 `DSH_HOME` 设成 `KITO_HARNESS_HOME`，没有时设成 `~/.kito-harness`。
- 桌面只注册 `kito-harness` 协议，并在启动时交还以前登记的 `dsh`。找回窗口的链接是 `kito-harness://open`。
- Windows 卸载程序保护的是 `KITO_HARNESS_HOME`。
- fork 自有的包用 `@kito` scope，不在 `@deepseek-ai` 下起名。目录仍在 `packages/<group>/<pkg>`：workspace、构建、覆盖率和各个门都按这个位置找包，搬出去要另建一套构建。

**配置。** profile 里的内容分两层，产品只动自己那层。

- 产品层：随包携带的 bundle。桌面启动时用 `ensureProfileBundles` 把缺少的随包 bundle 补进 `dsh.profile.bundles`。产品以后要撤回或改名的，只能是产品自己写进去的条目。到 0.2.2-rc.10 为止，产品写入的 Kito bundle 名是 `@deepseek-ai/dsh-llm-ktapi`；桌面启动时 `renameRetiredKitoBundle` 把它原位改成 `@kito/dsh-llm-ktapi`，其它条目不动。
- 用户层：用户安装的插件和 `cordis.patch.yml`。产品不删除、不改写。和随包路由重复的用户配置由文档说明怎么移除，不做自动迁移。

`kt/kito-provider` 不再用于 `desktop` profile。

## 理由

官方应用和 CLI 只认 `DSH_HOME`、`dsh` 这些名字。Kito 只要不读、不注册它们，官方一侧的任何配置都不会把 Kito 带进官方目录，也不需要在运行时猜一个目录归谁。

自动迁移要在升级时删掉用户自己装的插件和自己写的配置。查过发布历史，没有任何版本安装过 `@kito/dsh-kito-provider` 或写过 `providers.kito`，它们只来自手动安装，所以归用户。

## 上游合并时重放

下列位置偏离上游，合并发行 tag 后逐项核对：

| 文件 | 必须仍在 |
|---|---|
| `apps/desktop/src/kito-home.ts`、`apps/desktop/src/main.ts` | 只读 `KITO_HARNESS_HOME`；启动时覆盖 `DSH_HOME`；只注册 `kito-harness`；处理 `kito-harness://open` |
| `apps/desktop/scripts/electron-builder-config.mjs`、`apps/desktop/scripts/development-app.ts` | 协议列表只有 `kito-harness`；开发启动器导出 `KITO_HARNESS_HOME` |
| `apps/desktop/cli/dsh`、`apps/desktop/cli/dsh.cmd` | 启动前设置 `DSH_HOME`，不沿用继承来的值 |
| `apps/desktop/scripts/dev.ts` | 开发主目录的覆盖入口是 `KITO_HARNESS_HOME` |
| `apps/desktop/scripts/installed-update-identity.mjs` | 同时设置 `KITO_HARNESS_HOME` |
| `apps/desktop/installer/uninstall.nsh`、`apps/desktop/tests/windows-uninstall-smoke.ps1` | 读取 `KITO_HARNESS_HOME` |
| `apps/desktop/src/project-manager.ts` | bundle 名取自 `kito-profile-bundles.ts`；`ensureProfileBundles` 之前调用 `renameRetiredKitoBundle` |
| `apps/cli/package.json`、`packages/bundle/web-app/package.json`、`packages/bundle/web-app/cordis.patch.yml`、`tsconfig.base.json` | 引用的是 `@kito/dsh-llm-ktapi`、`@kito/dsh-client-ui-brand-kito` |
| `tsconfig.base.json` | 生成区之外手写的 `@kito/dsh-llm-ktapi` 源码别名 |
| `scripts/release/families.ts` | dsh 发行族的成员允许 `@kito` scope；桌面打包按这个成员表打包随包运行时 |

## 非目标

- 不改 Host、CLI 和各个 Harness 包对 `DSH_HOME` 的读取。
- 不清理已经被写入 Kito bundle 的官方 profile。那是本机数据，由使用者决定。
- 不移动 `kt/kito-provider`。非桌面 profile 目前没有别的 KT Identity 路由。

## 待定问题

版本号、tag 和升级指南目录已由 [ADR 0005](0005-kito-harness-version-line.md) 决定。

- 命令名：桌面可以把自带的命令安装成 PATH 上的 `dsh`，和官方 CLI 同名。改名会影响已经写好的脚本和文档。
- 同一个 profile 里，用户手写的 `llm-pi-ai` provider 与随包 provider 同名（都叫 `ktapi`）时的行为没有验证。
