# KT fork 定制（白名单域：容器化）。上游不提供 Dockerfile。
#
# 运行模型：dsh web 遵循上游安全策略只绑定 127.0.0.1:3080，
# K8s 侧由 nginx sidecar（deploy/k8s-ack-*/dsh-web.conf）暴露 Pod 端口。
#
# 构建产物验证方式（本地）：
#   docker build -t dsh-local . && \
#   docker run --rm -p 127.0.0.1:3099:3080 dsh-local
#   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3099/

FROM node:24-slim AS build

# node-pty 等原生模块需要 node-gyp 编译
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# packageManager 字段（pnpm@11.7.0）由 corepack 解析
RUN corepack enable

WORKDIR /repo
COPY . .

# CI=true 跳过 lefthook git hooks 安装（上游脚本在 CI 环境自动 no-op）
RUN CI=true pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:24-slim

ENV NODE_ENV=production \
    DSH_HOME=/dsh-home

WORKDIR /app
# 运行时需要完整 workspace：CLI bundle 通过 node_modules 解析 workspace 包
# （web profile 的 webserver/apiproxy/frontend 等），故整体携带构建产物。
COPY --from=build /repo ./

# 会话、存储、agent presets 落 DSH_HOME，K8s 挂 PVC
RUN mkdir -p /dsh-home

EXPOSE 3080

ENTRYPOINT ["node", "apps/cli/lib/bin.js", "web"]
CMD ["--host", "127.0.0.1", "--port", "3080"]
