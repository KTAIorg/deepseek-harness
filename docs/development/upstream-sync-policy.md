# 上游同步与 Fork 开发策略（deepseek-harness）

日期：2026-10-18

状态：生效

规范来源：kt-agent-skills/oss-fork-maintenance

- **当前基线**：`kito-harness-v0.2.2-rc.6`（`cc2b31b28b`，2026-11-08）。

## 仓库角色

- `upstream` = <https://github.com/deepseek-ai/deepseek-harness>（只读，禁止 push）
- `origin` = KTAIorg/deepseek-harness（KT fork，真 fork，保留完整上游历史）

上游是 MIT 协议的 TypeScript pnpm monorepo，默认分支 `master`。同步检查用 `upstream/master` 与发行 tag，不用 fork 的 `main`。当前基线是发行 tag `kito-harness-v0.2.2-rc.6`（`cc2b31b28b`，2026-11-08）；上一个上游对比点是 `66491b05`（`release: dsh@0.2.2-rc.1`）。公共 API 仍是 pre-stable，只合已发行 tag，不追 `master` HEAD。

## 分支模型

| 分支 | 职责 |
|---|---|
| `main` | KT 生产线 = 上游发行 tag + 白名单域定制；fork 默认分支 |
| `upstream-sync/*` | 上游跟随缓冲线：merge 指定 tag，在此解冲突，经 PR 进入 `main` |
| `gitops-test` | Argo CD watch（TEST，`deploy/k8s-ack-test`） |
| `gitops-prod` | Argo CD watch（PROD，`deploy/k8s-ack-prod`） |

## KT 定制边界（白名单，超出需 PR 论证）

1. **容器化**：`Dockerfile`、`.dockerignore`、`deploy/k8s-ack-*/dsh-web.conf`
2. **K8s 部署清单**：`deploy/k8s-ack-test/**`、`deploy/k8s-ack-prod/**`
3. **CI/交付**：`.github/workflows/release-ack.yml`、`.github/workflows/mirror-running-tag-to-zot.yml`、`.github/scripts/**`
4. **治理文档**：`docs/development/**`
5. **认证门面**：上游 Web 无认证且 Agent 可执行代码，ACK 暴露前必须挂认证网关。实现在独立仓库 `KTAIorg/dsh-auth-gateway`。本仓只保留 sidecar 接线：Deployment 的 `auth-gateway` 容器、Service targetPort、`dsh-auth-secrets` 引用（值走 KTSecret，禁止入 Git）。授权策略 = kt-identity `ADMIN` 角色 ∪ 白名单，默认拒绝。公网路由资源（`gateway.yaml` / `httproute.yaml`）属于部署清单域。
6. **Kito 桌面壳**：`apps/desktop` 中的产品名 Kito Harness、图标、欢迎页 Telegram 登录、更新源 `https://updates.ktyun.cc`，以及默认数据目录 `~/.kito-harness`（覆盖入口 `KITO_HARNESS_HOME`）和 URL 协议 `kito-harness`。Agent loop、会话格式、工具实现留在上游。打包应用标识用 `cc.ktapi.harness`（`DSH_DESKTOP_APP_ID`）。
7. **Kito 身份与模型路由**：`packages/llm/llm-ktapi/**`（工作区内包，由 `packages/bundle/*/cordis.patch.yml` 挂载）与 `packages/llm/llm-pi-ai/**` 中的 live catalog 读取层。对接 KT Identity 与 `https://ktapi.cc/v1`，不改 agent loop。
8. **Kito 品牌与账号 UI**：`packages/client/ui-brand-kito/**`、`packages/client/ui-settings-account/**`、`packages/client/ui-model-selection/**`。这三处是**有意为之的重写级定制**（模型选择器 +2,349/−885），后续上游合并按本文件的登记逐项重放，不视为漂移。
9. **桌面壳扩展文件**：`apps/desktop/src/kito-*.ts`、`apps/desktop/src/desktop-log.ts`、`apps/desktop/tests/kito-*.spec.ts`、`apps/desktop/tests/desktop-log.spec.ts`。

## 上游特殊性（同步时必须记住）

- 上游默认分支是 `master`。落后量用 `git rev-list --count main..upstream/<tag>` 对发行 tag 计算，并单独对 `gitops-prod` 再算一次，避免只推进部署分支。
- 上游安全设计：`dsh web` 拒绝绑定 `0.0.0.0`。KT 容器内绑 `127.0.0.1:3080`，由 nginx sidecar 暴露 Pod 端口。禁止改用 `::` 或去掉该检查。
- 数据目录 `DSH_HOME`（默认 `~/.dsh`）承载会话与存储，容器内挂 PVC。桌面产品使用独立 home，不读取继承来的 `DSH_HOME`，不和官方 DeepSeek Harness 抢 `profiles/desktop`；名字划分见 [ADR 0004](adr/0004-kito-names-apart-from-deepseek-harness.md)。
- `/api` 按请求 Host 判定信任：loopback 放行，公网域名必须在 `--trusted-host` 登记。现状 TEST/PROD 为 `dsh-test.ktyun.cc` / `dsh.ktyun.cc`。新增域名必须同步追加该参数。
- 桌面壳、Web 客户端、dsh 运行时按同一个版本一起发布。KT 桌面产品跟随上游发行 tag，不把壳和运行时拆开升级。

## 同步频率

- 安全修复：立即评估并同步。
- 每个上游发行 tag：评估后合并到 `upstream-sync/*`，再 PR 到 `main`。
- 季度至少一次兜底审计。

## 冲突优先级

安全修复以上游为准 > 上游已内建则收敛 KT 定制 > 白名单域定制保留重施 > 纯风格以上游为准。

生成物冲突（`pnpm-lock.yaml`）取上游版本后本地 `pnpm install` 重新生成，不手工合并 lock 文件。

## 每次合并后核对

可见品牌和登录路由的重放清单在 [ADR 0002](adr/0002-kito-visible-brand-and-upstream-reapply.md)，数据目录和 URL 协议的重放清单在 [ADR 0004](adr/0004-kito-names-apart-from-deepseek-harness.md)。合并完成后按这两张表核对，不另建 Skill。缺一项就补回，并写入下面的同步记录。

## 验证清单

- [ ] `pnpm install --frozen-lockfile` + `pnpm run build` 通过
- [ ] `node apps/cli/lib/bin.js web` 本地启动，`/` 返回 200
- [ ] CI 构建镜像（linux/amd64）推送 GHCR 成功
- [ ] TEST 环境 rollout 完成，nginx sidecar `/` 探测 200
- [ ] KT 定制域回归：镜像 digest 写回 gitops-test / gitops-prod 链路正常
- [ ] 认证门面仍是 Service 唯一入口，dsh 不直接对 Pod 网络暴露
- [ ] `node --test kt/kito-provider/tests/*.test.js`
- [ ] 上游安全 fix 确认已含（列出 from→to 中的 security 相关项）

桌面壳与 Kito 插件合入后，另加：KT Identity 登录、`ktapi.cc` 路由、安装包不内置共享 API key。

## 同步记录

| 日期 | 上游 from→to | 冲突摘要 | 验证 | 操作者 |
|---|---|---|---|---|
| 2026-08-14 | 无→47f94385（Day 0 fork） | 无 | 本地 build + web 200 | Hermes Agent |
| 2026-10-17 | 47f94385→`dsh-v0.2.1-alpha.1`（`5badb15009`） | 无。KT 侧 13 个提交只新增部署/CI/治理文件，与上游路径不重叠 | merge 无冲突；fork 定制文件相对 tag 仍在 | KT |
| 2026-10-18 | `dsh-v0.2.1-alpha.1`→`dsh-v0.2.1-rc.2`（`687f282e86`） | 桌面 README、安装文案、产物名和上传清单。上游新增目录替换文案、未公证产物后缀和 nightly-only 清单；Kito 产品名、`kito-harness` 路径和 `updates.ktyun.cc` 保留 | 本地开发客户端窗口版本 `0.2.1-rc.2`，模型菜单为 Kito 网关目录 | KT |
| 2026-11-07 | `dsh-v0.2.1-rc.2`→`dsh@0.2.2-rc.1`（`66491b05`） | 上游主干合并；KT 侧保留品牌、桌面壳、部署清单与治理文档（白名单 1–6） | 构建 + 桌面安装包冒烟 | KT |
| 2026-11-08 | 无新上游 tag；本仓 `0.2.2-rc.1`→`0.2.2-rc.6` | 无上游冲突。期间新增白名单 7–9（`llm-ktapi`、`llm-pi-ai` live catalog、Kito 品牌/账号/模型选择器、桌面壳扩展文件） | `pnpm run build` + 各包测试 + 桌面发布流水线 | KT |
