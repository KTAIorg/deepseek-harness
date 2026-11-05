# Kito Harness 发布与运维手册

[English](kito-harness-release.md) | 中文

本文是 Kito Harness 的当前操作事实源，覆盖上游同步、双平台构建、GitHub Release、`kito.ktai.im`、验收和常见故障。以后接手发布或排查定制功能时，先读本文，不要依赖某次会话的临时记忆。

## 发布边界

Kito Harness 是 `deepseek-ai/deepseek-harness` 的 KT fork。生产代码事实源是 `kt-aihub/deepseek-harness` 的 `main`；上游使用 `deepseek-ai/deepseek-harness` 的 `master` 和 `dsh-v*` tag。

当前分发方式：

- macOS Apple Silicon：PKG（推荐）与 DMG。
- Windows x64：NSIS EXE。
- 当前安装包是未签名内部构建，页面必须保留安全提示，不能宣称 Apple 公证或 Windows 签名。
- `kito.ktai.im` 由 `kt-aihub/kito-download-page` 的 Cloudflare Worker 提供；正常发版只更新 Release 和 `kito-harness-latest/latest.json`，不改 Worker。

禁止把开发用 `.app` 直接当发布包。正式产物必须来自可追溯 commit 和 `Release · Desktop` 工作流，或在同一 commit 上通过等价的本地打包与冒烟验证。

## Kito 定制功能地图

| 功能 | 所有者 / 关键路径 | 丢失时的表现 |
|---|---|---|
| Kito 品牌、账户、余额、语言 | `packages/client/ui-brand-kito/`；`packages/bundle/web-app/package.json` 必须有该依赖 | 用户名、USD 余额、语言切换全部消失 |
| 模型选择与厂商分组 | `packages/client/ui-model-selection/` | 小菜单、长名称截断、厂商图标或别名丢失 |
| 实时模型目录与推理等级 | `packages/llm/llm-pi-ai/src/live-catalog.ts`、`adapter.ts`；NewAPI `/v1/models` 的 `reasoning` 元数据 | 等级被客户端臆造、等级缺失或协议错误 |
| 账户启动器与版本号 | `packages/client/ui-settings-account/src/client/AccountMenu.tsx` | 原「意见反馈」按钮应显示 `v${DSH_CLIENT_VERSION}`，点击仍打开反馈表单 |
| Kito 身份与桌面保活 | `apps/desktop/src/kito-identity-keepalive.ts`、`kito-wallet-window.ts`、`main.ts` | 登录回跳、余额刷新或退出清理异常 |
| 桌面恢复 | `apps/desktop/src/main.ts` 与 `tests/main-startup.spec.ts` | 前两次 renderer crash 自动重载，第三次进入 fatal recovery；测试也必须触发三次 |
| Kito 构建 | 根 `package.json` 的 `build:kito`、`DSH_BUILD_CLIENT_PROFILE=kito`、`cc.ktapi.harness` | 构建脚本不存在、产品名或 Bundle ID 错误 |

上游合并时，除关注源码冲突，还必须检查上述清单文件、资源导出、依赖声明和测试假设。`packages/bundle/web-app/package.json` 与 `cordis.patch.yml` 的依赖一致性是强制验收项。

## 标准发布流程

### 1. 同步上游并验证定制

优先合并上游正式 tag，不追未发布 HEAD。创建同步分支，解决冲突后至少运行：

```sh
pnpm run typecheck
pnpm exec vitest run packages/client/ui-settings-account/tests/account.client.spec.tsx
pnpm exec vitest run packages/client/ui-brand-kito/tests/browser-plugin.client.spec.tsx
pnpm exec vitest run apps/desktop/tests/main-startup.spec.ts
```

模型选择器、账户页和桌面恢复的回归测试不能只用上游旧交互替换。当前选择器是整页弹窗，账户启动器是 Kito 自有入口，桌面恢复有三次 crash 语义。

### 2. 提升版本并合入 main

```sh
VERSION=0.2.2-rc.2
git checkout -b release/kito-$VERSION
pnpm release:dsh "$VERSION"
git push -u ktaiorg "release/kito-$VERSION"
```

通过 PR 合入 `main`。版本提交必须先于构建；禁止未提交源码直接打正式发布包。发生版本不一致时先修复清单，不要用绕过检查的参数提交。

### 3. 原生双平台构建

main 合入后触发 `.github/workflows/release-desktop.yml`：

```sh
kt gh --owner kt-aihub --repo deepseek-harness api \
  -X POST repos/kt-aihub/deepseek-harness/actions/workflows/release-desktop.yml/dispatches \
  -f ref=main
```

macOS 在 macOS Runner 产出 DMG/PKG，Windows 在 Windows Runner 产出 EXE。不要从 macOS 伪造 Windows 包，也不要复用不同 commit 的 CI 产物替换本地产物。

等待 run 成功后，用固化脚本下载并解压 CI 产物：

```sh
RUN_ID=<actions-run-id>
python3 scripts/release/github_release_artifacts.py download "$RUN_ID" "/tmp/kito-$VERSION"
```

### 4. 创建 Release 并上传不可变资产

先创建 tag/Release，目标必须是已合入 main 的完整 commit SHA：

```sh
TAG="kito-harness-v$VERSION"
kt gh --owner kt-aihub --repo deepseek-harness release create "$TAG" \
  --target <full-main-commit-sha> \
  --title "Kito Harness $VERSION" \
  --notes "Kito Harness $VERSION: upstream sync plus Kito customizations. Apple Silicon PKG/DMG and Windows EXE, unsigned internal builds."
```

获取 release id 并上传三个安装包：

```sh
RELEASE_ID=$(curl -s "https://api.github.com/repositories/1334176894/releases/tags/$TAG" -H 'User-Agent: kito' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
python3 scripts/release/github_release_artifacts.py upload "$RELEASE_ID" \
  "/tmp/kito-$VERSION/kito-harness-$VERSION-mac-arm64-unsigned.pkg" \
  "/tmp/kito-$VERSION/kito-harness-$VERSION-mac-arm64-unsigned.dmg" \
  "/tmp/kito-$VERSION/kito-harness-$VERSION-win-x64-unsigned.exe"
```

脚本使用 `kt-ci-bot` 的短时 installation token，私钥和 token 不打印、不落盘。大文件不要用 GitHub 网页附件上传（25 MB 限制），也不要依赖 `kt gh release upload` 的大文件通道。

每个文件上传后检查 HTTP 201、资产大小和公开 URL。更新 `SHA256SUMS.txt`，并对公开下载重新计算哈希，不能只用本地产物哈希冒充线上验收。

### 5. 更新 latest.json 元数据

固定元数据地址：`https://github.com/kt-aihub/deepseek-harness/releases/download/kito-harness-latest/latest.json`。正常发版只替换该资产的版本、URL、大小和 SHA256：

```json
{
  "name": "kito-harness-desktop",
  "version": "0.2.2-rc.2",
  "downloads": {
    "windows-x64": { "versionedUrl": "<exe-url>", "filename": "<exe>", "sha256": "<sha256>", "size": 0 },
    "macos-arm64": { "versionedUrl": "<pkg-url>", "filename": "<pkg>", "sha256": "<sha256>", "size": 0 },
    "macos-arm64-dmg": { "versionedUrl": "<dmg-url>", "filename": "<dmg>", "sha256": "<sha256>", "size": 0 }
  }
}
```

先从 `kito-harness-latest` Release 的资产列表找到旧 `latest.json` 的 asset id，删除旧资产，再上传新 JSON。不要凭记忆使用旧 asset id。`version` 允许 RC 后缀；Windows、PKG 和 DMG 只在真实资产存在时展示。

### 6. 线上验收

```sh
curl -s https://kito.ktai.im/ | grep -E 'Kito Harness|0.2.2-rc.2|unsigned.(pkg|dmg|exe)'
```

必须同时确认：

- 页面显示目标版本；Windows x64 行和 Apple Silicon 行可见，未发布平台隐藏。
- 主按钮指向 PKG，DMG 与 EXE 均为真实 200 下载。
- 公开下载字节与本地产物 SHA256 完全一致。
- 启动验收包，账户名/余额、语言切换、版本号、模型弹窗均正常。
- 新建会话发送“仅回复 OK 两个字母，不要调用任何工具”，收到真实模型回复且无错误。

## 常见故障与固定处理

| 症状 / 错误 | 根因与处理 |
|---|---|
| 用户名、余额、语言切换全消失 | `packages/bundle/web-app/package.json` 缺少 `@deepseek-ai/dsh-client-ui-brand-kito`；恢复依赖并重建，不要只改 CSS |
| `Command "build:kito" not found` | 根 `package.json` 丢失 `build:kito`；恢复 `tsx scripts/build.ts --profile kito` |
| `Could not resolve "./assets/...svg"` | `ui-model-selection/package.json` 缺少 `"./assets/*": "./lib/assets/*"` 导出及 `lib/assets` files |
| `dsh release members must share one version` | 新 Kito 包仍停留在旧版本；统一 `pnpm release:dsh <version>`，不要逐包随意改号 |
| `Node-API headers missing` | 当前 Node 是 Codex/DSH 内置运行时而无头文件；使用带 `include/node/node_api.h` 的 Node 24 |
| Electron 下载超时 | 使用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`，重试原构建命令 |
| `DSH_CLIENT_COMMIT_HASH must match` | 构建与提交并发竞争；等 commit 固定后重新打包 |
| Windows `MANDATORY_UPDATE_CONFIG must be valid JSON` | PowerShell 转义错误；用单引号原样写入 JSON，不要写 `\"` |
| macOS CI `No files were found` | `upload-artifact` 不支持 `*.{dmg,pkg}`；改为多行 `*.dmg` 与 `*.pkg` 路径 |
| GitHub Release API 版本解析失败 | 仓库迁移导致 301；使用不可变 repository id `1334176894`，或固定 `kito-harness-latest/latest.json` |
| 大文件上传失败 / 网页 25 MB 限制 | 用 `scripts/release/github_release_artifacts.py` 和短时 App token 流式上传，必要时用 HTTP/1.1 重试 |
| `Issue policy` 查询上游 404 | 上游脚本硬编码仓库名，是 fork 既有 CI 问题；不要把它误报为本次业务测试失败 |

## 回滚

不要删除旧 Release。把 `kito-harness-latest/latest.json` 恢复到上一个已验证版本，等待 Worker 的 10 秒 manifest 缓存和 30 秒页面缓存过期后复核。需要撤回代码时用新的 revert PR，不改写历史 tag，不覆盖已经公开的同版本安装包。

## 交接检查

- [ ] `main` 上的版本、tag 和构建 commit 一致。
- [ ] CI 的 macOS 与 Windows 产物来自同一个 run，且上传的是该 run 的字节。
- [ ] Release、SHA256SUMS 和 latest.json 的版本/大小/哈希一致。
- [ ] 下载页、公开下载和实际启动验收通过。
- [ ] 本手册仍覆盖新出现的定制功能与故障；发现新问题先补这里，不要只留在会话中。
