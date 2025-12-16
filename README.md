# Anthropic Bridge

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aliom-v/anthropic-bridge)

将 Anthropic API 请求转换为 OpenAI 格式，让 Claude Code CLI 可以使用 iFlow 等 OpenAI 兼容服务。

---

## 一键部署到 Cloudflare Workers

### 方式 1：点击按钮部署

点击上方 **Deploy to Cloudflare Workers** 按钮，按提示操作。

> ⚠️ 部署后还需要手动创建 KV 并配置，见下方步骤。

### 方式 2：手动部署

#### 步骤 1：Fork 或 Clone 仓库

```bash
git clone https://github.com/aliom-v/anthropic-bridge.git
cd anthropic-bridge
npm install
```

#### 步骤 2：登录 Cloudflare

```bash
# 方式 A：浏览器登录（推荐）
npx wrangler login

# 方式 B：使用 API Token（如果方式 A 失败）
# 1. 访问 https://dash.cloudflare.com/profile/api-tokens
# 2. 创建 Token，权限：Workers KV Storage (Edit) + Workers Scripts (Edit)
# 3. 设置环境变量
set CLOUDFLARE_API_TOKEN=你的Token   # Windows CMD
export CLOUDFLARE_API_TOKEN=你的Token # Linux/macOS
```

#### 步骤 3：创建 KV 命名空间

```bash
npx wrangler kv:namespace create "CFG"
```

记录输出的 `id`，例如：
```
{ binding = "CFG", id = "abc123def456" }
```

#### 步骤 4：修改配置

编辑 `wrangler.toml`：

```toml
name = "anthropic-bridge"
main = "src/worker.js"
compatibility_date = "2024-11-01"

kv_namespaces = [
  { binding = "CFG", id = "你的KV-ID" }  # 填入上一步的 id
]

[vars]
ADMIN_KEY = "设置你的管理密钥"  # 用于管理接口鉴权
```

> 💡 `account_id` 可以删除，Wrangler 会自动检测

#### 步骤 5：部署

```bash
npm run deploy
```

成功后显示：`https://anthropic-bridge.你的子域名.workers.dev`

#### 步骤 6：配置上游 API

部署后，通过管理接口配置你的 API 地址和密钥：

```bash
curl -X POST https://anthropic-bridge.你的子域名.workers.dev/admin/config \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "iflow_api_key": "你的API-Key",
    "iflow_openai_base": "http://你的VPS-IP:8080",
    "iflow_openai_path": "/v1/chat/completions"
  }'
```

---

## 配置客户端

### Claude Code CLI

```bash
# Linux/macOS
export ANTHROPIC_BASE_URL=https://anthropic-bridge.你的子域名.workers.dev
export ANTHROPIC_API_KEY=any

# Windows CMD
set ANTHROPIC_BASE_URL=https://anthropic-bridge.你的子域名.workers.dev
set ANTHROPIC_API_KEY=any
```

### Cherry Studio

1. 打开设置 → 模型服务
2. 选择 `Anthropic`
3. Base URL: `https://anthropic-bridge.你的子域名.workers.dev`
4. API Key: 任意字符串

---

## 自定义域名（可选）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages** → 你的 Worker
3. **Settings** → **Domains & Routes** → **Add** → **Custom Domain**
4. 输入你的域名（必须已托管在 Cloudflare）

---

## API 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/messages` | POST | Anthropic Messages API（核心） |
| `/v1/models` | GET | 返回模型列表 |
| `/admin/config` | GET/POST | 管理接口（需要 ADMIN_KEY） |
| `/debug` | GET | 检查配置状态 |
| `/health` | GET | 健康检查 |

---

## 可配置项

通过 `/admin/config` 接口可配置：

| 配置项 | 说明 |
|--------|------|
| `iflow_openai_base` | 上游 API 地址 |
| `iflow_openai_path` | API 路径（默认 `/v1/chat/completions`） |
| `iflow_api_key` | API Key |
| `model_mapping` | 模型映射表（JSON 对象） |

---

## 架构图

```
Claude Code CLI / Cherry Studio
        │
        │ Anthropic /v1/messages
        ▼
┌─────────────────────────┐
│   anthropic-bridge      │  ← Cloudflare Workers
│   (协议转换)             │
└───────────┬─────────────┘
            │ OpenAI /v1/chat/completions
            ▼
    上游 API (iFlow / CLIProxyAPI / 其他)
```

---

## 完整部署文档

详细的本地部署和 VPS 部署指南请查看 [DEPLOY.md](./DEPLOY.md)

---

## License

MIT
