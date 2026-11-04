# @kito/dsh-kito-provider

DeepSeek Harness `dsh-v0.2.1-rc.3` 的 Kito 插件。它不改 agent loop。

装进 profile 后做两件事：

- 在 `llm-pi-ai` 上增加 `kito` 与 `kito-claude` 路由。两者都携带 `KITO_IDENTITY_TOKEN`，并通过 `X-Kito-Token-Name` 让 NewAPI 在服务端选择对应的托管 relay token；明文 relay key 不下发本机。
- 注册 KT Identity 登录（Telegram 设备流或账号密码）。登录成功后只保存 Identity Bearer 和可选刷新令牌；授权记录保留账号信息，不写进配置文件。

设备客户端沿用已注册的 `client_type=kito_desktop`、`client_id=kito-desktop`。与 Kito（OpenCode）共用同一 KT Identity 账号；relay 凭据由 NewAPI 服务端按路由选择。

## 安装

在 Harness 仓库根目录：

```sh
dsh plugin --profile web add ./kt/kito-provider
```

桌面 profile 名是 `desktop`。后写的 `cordis.patch.yml` 会整段替换 `llm-pi-ai` 的 config，改模型列表时要保留 `providers.kito` 与 `providers.kito-claude`。

## 环境变量

| 变量 | 默认 |
|---|---|
| `KT_IDENTITY_BASE_URL` | `https://login.ktyun.cc` |

安装包不内置模型 relay key，本机也不保存服务端托管 key。

## 测试

```sh
node --test kt/kito-provider/tests/*.test.js
```
