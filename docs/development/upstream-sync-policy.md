# 上游同步与 Fork 开发策略（deepseek-harness）

日期：2026-10-17

状态：生效

规范来源：kt-agent-skills/oss-fork-maintenance

## 仓库角色

- `upstream` = <https://github.com/deepseek-ai/deepseek-harness>（只读，禁止 push）
- `origin` = KTAIorg/deepseek-harness（KT fork，真 fork，保留完整上游历史）

上游是 MIT 协议的 TypeScript pnpm monorepo，默认分支 `master`。同步检查用 `upstream/master` 与发行 tag，不用 fork 的 `main`。当前基线是发行 tag `dsh-v0.2.1-alpha.1`（`5badb15009ae1756c3afe0ae0cef1faafc290ccc`）。公共 API 仍是 pre-stable，只合已发行 tag，不追 `master` HEAD。

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
6. **Kito 桌面壳（后续 PR）**：`apps/desktop` 中的产品名、图标、欢迎页、更新地址，以及独立 `DSH_HOME`。Agent loop、会话格式、工具实现留在上游。
7. **Kito 身份与模型路由**：`kt/kito-provider/**`。这是独立插件包，不加入 pnpm workspace，不改 agent loop。用 `dsh plugin add ./kt/kito-provider` 装进 profile，对接 KT Identity 与 `https://ktapi.cc/v1`。

## 上游特殊性（同步时必须记住）

- 上游默认分支是 `master`。落后量用 `git rev-list --count main..upstream/<tag>` 对发行 tag 计算，并单独对 `gitops-prod` 再算一次，避免只推进部署分支。
- 上游安全设计：`dsh web` 拒绝绑定 `0.0.0.0`。KT 容器内绑 `127.0.0.1:3080`，由 nginx sidecar 暴露 Pod 端口。禁止改用 `::` 或去掉该检查。
- 数据目录 `DSH_HOME`（默认 `~/.dsh`）承载会话与存储，容器内挂 PVC。桌面产品使用独立 home，不和官方 DeepSeek Harness 抢 `profiles/desktop`。
- `/api` 按请求 Host 判定信任：loopback 放行，公网域名必须在 `--trusted-host` 登记。现状 TEST/PROD 为 `dsh-test.ktyun.cc` / `dsh.ktyun.cc`。新增域名必须同步追加该参数。
- 桌面壳、Web 客户端、dsh 运行时按同一个版本一起发布。KT 桌面产品跟随上游发行 tag，不把壳和运行时拆开升级。

## 同步频率

- 安全修复：立即评估并同步。
- 每个上游发行 tag：评估后合并到 `upstream-sync/*`，再 PR 到 `main`。
- 季度至少一次兜底审计。

## 冲突优先级

安全修复以上游为准 > 上游已内建则收敛 KT 定制 > 白名单域定制保留重施 > 纯风格以上游为准。

生成物冲突（`pnpm-lock.yaml`）取上游版本后本地 `pnpm install` 重新生成，不手工合并 lock 文件。

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
