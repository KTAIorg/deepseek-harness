# 上游同步与 Fork 开发策略（deepseek-harness）

日期：2026-08-14
状态：生效
规范来源：kt-agent-skills/oss-fork-maintenance

## 仓库角色

- `upstream` = <https://github.com/deepseek-ai/deepseek-harness>（只读，禁止 push）
- `origin` = KTAIorg/deepseek-harness（KT fork，真 fork，保留完整上游历史）

上游信息（采纳时点）：MIT 协议；TypeScript pnpm monorepo；上游默认分支 `master`，
尚无 release tag（Developer Preview，npm 版本线 0.1.0-rc.x）。上游一旦出 tag，
同步目标立即切换为 tag。

## 分支模型

| 分支 | 职责 |
|---|---|
| `main` | KT 生产线 = 上游基线（upstream/master）+ 白名单域定制；fork 默认分支 |
| `upstream-sync` | 上游跟随缓冲线：merge upstream/master 或指定 tag，在此解冲突 |
| `gitops-test` | Argo CD watch（TEST，`deploy/k8s-ack-test`） |
| `gitops-prod` | Argo CD watch（PROD，`deploy/k8s-ack-prod`） |

## KT 定制边界（白名单，超出需 PR 论证）

1. **容器化**：`Dockerfile`、`.dockerignore`、`deploy/nginx/dsh-web.conf`
2. **K8s 部署清单**：`deploy/k8s-ack-test/**`、`deploy/k8s-ack-prod/**`
3. **CI/交付**：`.github/workflows/release-ack.yml`（及后续同步/发布 workflow）、
   `.github/scripts/**`
4. **治理文档**：`docs/development/**`

当前**没有** ktpay / kt-identity / 品牌定制。上游 Web 端无内建认证且 Agent
具备代码执行能力，公网暴露前必须先落地认证门面（评估方向：上游若内建认证则
直接对接 kt-identity OIDC；否则在入口层做 Cloudflare Access / Auth Gateway），
该改动届时按白名单新增域走 PR 论证。

## 上游特殊性（同步时必须记住）

- 上游默认分支是 `master`（不是 main）；`git merge-base` / 落后量检查用
  `upstream/master`。
- 上游处于 Developer Preview，声明会有破坏兼容性变更；**同步频率高于常规
  项目**，但只合 commit 已验证的节点，不追 HEAD。
- 上游安全设计：`dsh web` 拒绝绑定 `0.0.0.0`（RCE 防护）。KT 容器化遵循该
  立场：容器内绑 `127.0.0.1:3080`，由 nginx sidecar 暴露 Pod 端口。禁止
  以定制名义绕过该限制（如改用 `::` 或 patch 掉检查）。
- 数据目录 `DSH_HOME`（默认 `~/.dsh`）承载会话/存储，容器内固定挂载 PVC。

## 同步频率

- 安全修复：即时
- Developer Preview 期：每 1–2 周评估一次 upstream/master；上游出 release tag
  后改为每 release 评估；季度至少一次兜底。

## 冲突优先级

安全修复以上游为准 > 上游已内建则收敛 KT 定制 > 白名单域定制保留重施 >
纯风格以上游为准。

生成物冲突（pnpm-lock.yaml）优先取上游版本后本地 `pnpm install` 重新生成，
不手工合并 lock 文件。

## 验证清单

- [ ] `pnpm install --frozen-lockfile` + `pnpm run build` 通过
- [ ] `node apps/cli/lib/bin.js web` 本地启动，`/` 返回 200
- [ ] CI 构建镜像（linux/amd64）推送 GHCR 成功
- [ ] TEST 环境 rollout 完成，nginx sidecar `/` 探测 200
- [ ] KT 定制域回归：镜像 digest 写回 gitops-test/gitops-prod 链路正常
- [ ] 上游安全 fix 确认已含（列出 from→to commit 中的 security 相关项）

## 同步记录

| 日期 | 上游 from→to | 冲突摘要 | 验证 | 操作者 |
|---|---|---|---|---|
| 2026-08-14 | 无→47f94385（Day 0 fork） | 无 | 本地 build + web 200 | Hermes Agent |
