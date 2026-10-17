# @kito/dsh-kito-provider

DeepSeek Harness `dsh-v0.2.1-alpha.1` 的 Kito 插件。它不改 agent loop。

装进 profile 后做两件事：

- 在 `llm-pi-ai` 上增加 `kito` 路由，指向 `https://ktapi.cc/v1`，密钥引用 `KITO_NEWAPI_API_KEY`。
- 注册 KT Identity 登录（Telegram 设备流或账号密码）。登录成功后用 Identity Bearer 换名为 `kito` 的 NewAPI key，写入凭证存储。Identity Bearer 留在授权记录里，不写进配置文件。

设备客户端沿用已注册的 `client_type=kito_desktop`、`client_id=kito-desktop`。和 Kito（OpenCode）共用同一把托管 key。

## 安装

在 Harness 仓库根目录：

```sh
dsh plugin --profile web add ./kt/kito-provider
```

桌面 profile 名是 `desktop`。后写的 `cordis.patch.yml` 会整段替换 `llm-pi-ai` 的 config，改模型列表时要保留 `providers.kito`。

## 环境变量

| 变量 | 默认 |
|---|---|
| `KT_IDENTITY_BASE_URL` | `https://login.ktyun.cc` |
| `KITO_NEWAPI_BASE_URL` | `https://ktapi.cc` |

安装包不内置 NewAPI key。

## 测试

```sh
node --test kt/kito-provider/tests/*.test.js
```
