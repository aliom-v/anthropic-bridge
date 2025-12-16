# Anthropic Bridge

将 Anthropic API 请求转换为 OpenAI 格式，让 Claude Code CLI 可以使用 iFlow 等 OpenAI 兼容服务。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 创建 KV 命名空间

```bash
npx wrangler kv:namespace create "CFG"
```

复制输出的 `id`，填入 `wrangler.toml`:

```toml
kv_namespaces = [
  { binding = "CFG", id = "你的实际ID" }
]
```

### 3. 配置环境变量

编辑 `wrangler.toml`:

```toml
[vars]
IFLOW_OPENAI_BASE = "https://你的iflow地址"
IFLOW_OPENAI_PATH = "/v1/chat/completions"
DEFAULT_MODEL = "gpt-4"
ADMIN_KEY = "你的管理密钥"
```

### 4. 部署

```bash
npm run deploy
```

### 5. 初始化配置

部署后，通过管理接口配置 iFlow 凭据:

**方式 A: API Key 模式（推荐，不过期）**

```bash
curl -X POST https://你的域名.workers.dev/admin/config \
  -H "Authorization: Bearer 你的管理密钥" \
  -H "Content-Type: application/json" \
  -d '{
    "iflow_api_key": "你的iflow-api-key",
    "iflow_openai_base": "https://你的iflow地址",
    "iflow_openai_path": "/v1/chat/completions"
  }'
```

**方式 B: Token 模式（会过期，自动刷新）**

```bash
curl -X POST https://你的域名.workers.dev/admin/config \
  -H "Authorization: Bearer 你的管理密钥" \
  -H "Content-Type: application/json" \
  -d '{
    "iflow_access_token": "你的access-token",
    "iflow_refresh_token": "你的refresh-token",
    "iflow_refresh_url": "https://iflow刷新token的接口",
    "iflow_expires_at": "过期时间戳"
  }'
```

---

## Claude Code CLI 配置

```bash
export ANTHROPIC_BASE_URL=https://你的域名.workers.dev
export ANTHROPIC_API_KEY=any-string
```

或在 `~/.claude/settings.json`:

```json
{
  "apiBaseUrl": "https://你的域名.workers.dev",
  "apiKey": "any-string"
}
```

---

## Cherry Studio 配置

1. 打开设置 → 模型服务
2. 选择 `Anthropic` 或 `自定义 Anthropic`
3. Base URL: `https://你的域名.workers.dev`
4. API Key: 任意字符串

---

## API 接口

### POST /v1/messages

Anthropic Messages API 兼容接口（核心）

### GET /v1/models

返回可用模型列表

### GET/POST /admin/config

管理接口，需要 `Authorization: Bearer {ADMIN_KEY}` 鉴权

**GET** - 读取配置（敏感信息脱敏）
**POST** - 写入配置

可配置项:
- `iflow_openai_base` - iFlow API 地址
- `iflow_openai_path` - API 路径
- `iflow_api_key` - API Key（不过期模式）
- `iflow_access_token` - Access Token
- `iflow_refresh_token` - Refresh Token
- `iflow_refresh_url` - Token 刷新接口
- `iflow_expires_at` - Token 过期时间戳
- `model_mapping` - 模型映射表（JSON 对象）

---

## 模型映射

默认映射:

| Anthropic 模型 | iFlow 模型 |
|---------------|-----------|
| claude-3-5-sonnet-* | DEFAULT_MODEL |
| claude-3-opus-* | DEFAULT_MODEL |
| claude-3-haiku-* | DEFAULT_MODEL |

自定义映射:

```bash
curl -X POST https://你的域名.workers.dev/admin/config \
  -H "Authorization: Bearer 你的管理密钥" \
  -H "Content-Type: application/json" \
  -d '{
    "model_mapping": {
      "claude-3-5-sonnet-latest": "gpt-4-turbo",
      "claude-3-opus-latest": "gpt-4",
      "claude-3-haiku-20240307": "gpt-3.5-turbo"
    }
  }'
```

---

## 本地开发

```bash
npm run dev
```

默认运行在 `http://localhost:8787`

---

## 可用模型列表

当前支持的模型（在 Cherry Studio 或 Claude Code 中使用这些名称）：

| 模型名称 | 说明 |
|---------|------|
| Qwen3-Max | 通义千问3 旗舰版 |
| Qwen3-Max-Preview | 通义千问3 预览版 |
| Kimi-K2 | Kimi K2 |
| Kimi-K2-Instruct-0905 | Kimi K2 指令版 |
| GLM-4.6 | 智谱 GLM-4.6 |
| Qwen3-VL-Plus | 通义千问3 视觉版 |
| Qwen3-235B-A22B-Thinking | 通义千问3 思考模型 |
| Qwen3-235B-A22B-Instruct | 通义千问3 指令版 |

> 模型名称会直接透传到后端 iFlow API，无需额外映射。

---

## 调试端点

### GET /debug

检查配置状态（无需鉴权）：

```bash
curl https://你的域名.workers.dev/debug
```

返回示例：
```json
{
  "status": "ok",
  "config": {
    "has_api_key": true,
    "base_url": "https://api.iflow.example.com",
    "path": "/v1/chat/completions",
    "upstream_url": "https://api.iflow.example.com/v1/chat/completions"
  }
}
```

### GET /health

健康检查：

```bash
curl https://你的域名.workers.dev/health
```

---

## Windows 下的 curl 命令

Windows CMD 和 PowerShell 的引号处理与 Linux/Mac 不同，以下是适配示例：

### CMD 命令提示符

```cmd
curl -X POST https://你的域名.workers.dev/admin/config ^
  -H "Authorization: Bearer ab123456" ^
  -H "Content-Type: application/json" ^
  -d "{\"iflow_api_key\": \"你的key\", \"iflow_openai_base\": \"https://api.iflow.example.com\"}"
```

### PowerShell

```powershell
$body = @{
    iflow_api_key = "你的key"
    iflow_openai_base = "https://api.iflow.example.com"
    iflow_openai_path = "/v1/chat/completions"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://你的域名.workers.dev/admin/config" `
  -Method Post `
  -Headers @{
    "Authorization" = "Bearer ab123456"
    "Content-Type" = "application/json"
  } `
  -Body $body
```

### 或使用 Git Bash

如果安装了 Git，可以用 Git Bash 直接运行 Linux 风格的 curl 命令。

---

## 常见问题 FAQ

### Q: 请求返回 "Upstream API not configured"

**原因**: 没有配置 iFlow API 地址或凭据

**解决**:
1. 访问 `/debug` 端点检查配置状态
2. 通过 `/admin/config` 接口配置 `iflow_openai_base` 和 `iflow_api_key`

### Q: 请求返回 "Missing iflow_refresh_token or iflow_api_key in KV"

**原因**: KV 中没有存储 API Key 或 Token

**解决**: 调用管理接口设置凭据：
```bash
curl -X POST https://你的域名.workers.dev/admin/config \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"iflow_api_key": "你的iflow-api-key"}'
```

### Q: Cherry Studio 中提示连接失败

**检查步骤**:
1. 确认 Workers 已部署：访问 `https://你的域名.workers.dev/health`
2. 确认选择的提供商是 `Anthropic`（不是 OpenAI）
3. 确认 Base URL 末尾没有多余的 `/`

### Q: 返回 401 Unauthorized

**原因**: 管理接口的 `ADMIN_KEY` 不正确

**解决**: 检查 `wrangler.toml` 中的 `ADMIN_KEY` 配置，确保请求头中的 Bearer token 一致

### Q: 模型返回乱码或格式错误

**可能原因**:
- 后端 iFlow 不支持该模型
- 模型名称拼写错误

**解决**: 使用 `/v1/models` 接口查看支持的模型列表

### Q: 流式响应中断

**可能原因**:
- 网络不稳定
- Cloudflare Workers 超时（免费版限制 30 秒 CPU 时间）

**解决**:
- 检查网络连接
- 对于长对话，考虑升级 Cloudflare Workers 套餐

---

## 架构图

```
Claude Code CLI / Cherry Studio
        │
        │ Anthropic /v1/messages
        ▼
┌─────────────────────────┐
│   anthropic-bridge      │
│   (Cloudflare Workers)  │
└───────────┬─────────────┘
            │ OpenAI /v1/chat/completions
            ▼
        iFlow API
```

---

## License

MIT
