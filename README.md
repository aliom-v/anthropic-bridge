# Anthropic Bridge

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aliom-v/anthropic-bridge)

将 Anthropic API 请求转换为 OpenAI 格式，让 Claude Code CLI 可以使用 iFlow 等 OpenAI 兼容服务。

---

## 目录

- [快速开始](#快速开始)
- [部署方案](#部署方案)
- [Cloudflare Workers 部署](#cloudflare-workers-部署)
- [VPS 部署 CLIProxyAPI](#vps-部署-cliproxyapi)
- [本地部署 CLIProxyAPI](#本地部署-cliproxyapi)
- [客户端配置](#客户端配置)
- [可用模型列表](#可用模型列表)
- [API 接口](#api-接口)
- [健康检查与诊断](#健康检查与诊断)
- [自定义域名](#自定义域名)
- [常见问题](#常见问题)

---

## 快速开始

### 最简方案（推荐）

1. 在 VPS 或本地安装 CLIProxyAPI
2. 配置 Claude Code CLI 指向 CLIProxyAPI
3. 开始使用

```bash
# 配置 Claude Code CLI
export ANTHROPIC_BASE_URL=http://你的VPS-IP:8080
export ANTHROPIC_API_KEY=any
```

---

## 部署方案

| 方案 | 复杂度 | 成本 | Token 续期 | 适合场景 |
|------|--------|------|-----------|---------|
| **VPS + CLIProxyAPI** | ⭐⭐ | ¥30-50/月 | 自动 | 24小时在线，多设备共享 |
| **本地 CLIProxyAPI** | ⭐ | 免费 | 自动 | 电脑常开，个人使用 |
| **Workers + CLIProxyAPI** | ⭐⭐⭐ | 免费 | 自动 | 需要自定义域名 |

### 架构图

```
Claude Code CLI / Cherry Studio
        │
        │ Anthropic /v1/messages
        ▼
┌─────────────────────────┐
│   CLIProxyAPI           │  ← VPS 或 本地
│   (协议转换 + Token续期) │
└───────────┬─────────────┘
            │ iFlow OAuth
            ▼
        iFlow API
```

> CLIProxyAPI 同时支持 Anthropic 和 OpenAI 两种协议，无需额外的 Workers。

---

## VPS 部署 CLIProxyAPI

### 步骤 1：安装依赖

```bash
# SSH 连接到 VPS
ssh root@你的VPS-IP

# 更新系统
apt update && apt install -y curl wget

# 安装 Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# 安装 iFlow CLI
npm install -g @iflow-ai/iflow-cli@latest
```

### 步骤 2：登录 iFlow

```bash
iflow
```

选择 **Login with iFlow**（选项 1）。

> **无法打开浏览器？** 终端会显示授权 URL，复制到本地浏览器打开完成授权。

### 步骤 3：安装 CLIProxyAPI

```bash
# 创建目录
mkdir -p /opt/cliproxyapi && cd /opt/cliproxyapi

# 下载（根据最新版本调整）
wget https://github.com/router-for-me/CLIProxyAPI/releases/download/v6.6.18/CLIProxyAPI_6.6.18_linux_amd64.tar.gz

# 解压
tar -xzf CLIProxyAPI_6.6.18_linux_amd64.tar.gz
```

### 步骤 4：创建配置文件

```bash
printf 'port: 8080
host: "0.0.0.0"
providers:
  - iflow
log-level: "info"
auth-dir: "/root/.cli-proxy-api"
' > /opt/cliproxyapi/config.yaml
```

### 步骤 5：复制认证文件

```bash
mkdir -p /root/.cli-proxy-api
cp /root/.iflow/oauth_creds.json /root/.cli-proxy-api/
```

### 步骤 6：创建 systemd 服务

```bash
printf '[Unit]
Description=CLIProxyAPI Service
After=network.target

[Service]
Type=simple
User=root
Environment="HOME=/root"
WorkingDirectory=/opt/cliproxyapi
ExecStart=/opt/cliproxyapi/cli-proxy-api --config /opt/cliproxyapi/config.yaml
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
' > /etc/systemd/system/cliproxyapi.service
```

### 步骤 7：启动服务

```bash
systemctl daemon-reload
systemctl enable cliproxyapi
systemctl start cliproxyapi
```

### 步骤 8：开放防火墙

```bash
ufw allow 8080/tcp
```

### 步骤 9：验证部署

```bash
# 一键诊断
echo "=== 服务状态 ===" && systemctl is-active cliproxyapi
echo "=== 端口监听 ===" && ss -tlnp | grep 8080
echo "=== API 测试 ===" && curl -s http://localhost:8080/v1/models | head -c 200
echo "=== 认证状态 ===" && journalctl -u cliproxyapi -n 5 --no-pager | grep -E "(clients|auth)"
```

正常输出：
```
=== 服务状态 ===
active
=== 端口监听 ===
LISTEN 0 4096 *:8080 *:* users:(("cli-proxy-api",...))
=== API 测试 ===
{"data":[],"object":"list"}
=== 认证状态 ===
... 1 clients (1 auth files + ...)
```

---

## 本地部署 CLIProxyAPI

### Windows

1. 下载 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI/releases)（选择 `windows_amd64.zip`）
2. 解压到 `C:\CLIProxyAPI`
3. 安装并登录 iFlow CLI：
   ```cmd
   npm install -g @iflow-ai/iflow-cli@latest
   iflow
   ```
4. 创建 `config.yaml`：
   ```yaml
   port: 8080
   host: "127.0.0.1"
   providers:
     - iflow
   log-level: "info"
   auth-dir: "C:/Users/你的用户名/.cli-proxy-api"
   ```
5. 复制认证文件：
   ```cmd
   mkdir C:\Users\你的用户名\.cli-proxy-api
   copy C:\Users\你的用户名\.iflow\oauth_creds.json C:\Users\你的用户名\.cli-proxy-api\
   ```
6. 启动：
   ```cmd
   cli-proxy-api.exe --config config.yaml
   ```

### macOS / Linux

```bash
# 下载并解压
wget https://github.com/router-for-me/CLIProxyAPI/releases/download/v6.6.18/CLIProxyAPI_6.6.18_darwin_arm64.tar.gz
tar -xzf CLIProxyAPI_*.tar.gz

# 安装并登录 iFlow CLI
npm install -g @iflow-ai/iflow-cli@latest
iflow

# 创建配置
cat > config.yaml << 'EOF'
port: 8080
host: "127.0.0.1"
providers:
  - iflow
log-level: "info"
auth-dir: "~/.cli-proxy-api"
EOF

# 复制认证文件
mkdir -p ~/.cli-proxy-api
cp ~/.iflow/oauth_creds.json ~/.cli-proxy-api/

# 启动
./cli-proxy-api --config config.yaml
```

---

## Cloudflare Workers 部署

> 如果你需要自定义域名或额外的协议转换层，可以部署 Workers。

### 方式 1：一键部署

点击上方 **Deploy to Cloudflare Workers** 按钮。

### 方式 2：手动部署

```bash
# 克隆仓库
git clone https://github.com/aliom-v/anthropic-bridge.git
cd anthropic-bridge
npm install

# 登录 Cloudflare
npx wrangler login

# 创建 KV
npx wrangler kv:namespace create "CFG"
# 记录输出的 id

# 编辑 wrangler.toml，填入 KV ID
# 部署
npm run deploy
```

### 配置上游 API

```bash
curl -X POST https://你的域名.workers.dev/admin/config \
  -H "Authorization: Bearer 你的ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "iflow_api_key": "placeholder",
    "iflow_openai_base": "http://你的VPS-IP:8080",
    "iflow_openai_path": "/v1/chat/completions"
  }'
```

---

## 客户端配置

### Claude Code CLI

```bash
# Linux/macOS
export ANTHROPIC_BASE_URL=http://你的VPS-IP:8080
export ANTHROPIC_API_KEY=any

# Windows CMD
set ANTHROPIC_BASE_URL=http://你的VPS-IP:8080
set ANTHROPIC_API_KEY=any

# Windows PowerShell
$env:ANTHROPIC_BASE_URL = "http://你的VPS-IP:8080"
$env:ANTHROPIC_API_KEY = "any"
```

### Cherry Studio

1. 打开设置 → 模型服务
2. 选择 `Anthropic`
3. Base URL: `http://你的VPS-IP:8080`
4. API Key: 任意字符串

### Cursor / 其他 OpenAI 兼容客户端

- Base URL: `http://你的VPS-IP:8080/v1`
- API Key: 任意字符串

---

## 可用模型列表

CLIProxyAPI 支持 iFlow 提供的所有模型：

### 通用模型

| 模型名称 | 说明 | 特点 |
|---------|------|------|
| `Qwen3-Max` | 通义千问3 旗舰版 | 综合能力强 |
| `Qwen3-Max-Preview` | 通义千问3 预览版 | 最新特性 |
| `Kimi-K2` | Kimi K2 | 长上下文 |
| `Kimi-K2-Instruct-0905` | Kimi K2 指令版 | 指令遵循 |
| `GLM-4.6` | 智谱 GLM-4.6 | 中文优化 |

### 视觉模型

| 模型名称 | 说明 | 特点 |
|---------|------|------|
| `Qwen3-VL-Plus` | 通义千问3 视觉版 | 图像理解 |

### 推理模型

| 模型名称 | 说明 | 特点 |
|---------|------|------|
| `Qwen3-235B-A22B-Thinking` | 通义千问3 思考模型 | 深度推理 |
| `Qwen3-235B-A22B-Instruct` | 通义千问3 指令版 | 复杂任务 |

> 模型名称直接透传到 iFlow API，使用 iFlow 支持的任意模型名即可。

### 查看可用模型

```bash
curl http://你的VPS-IP:8080/v1/models
```

---

## API 接口

CLIProxyAPI 同时支持两种协议：

### Anthropic 格式

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/messages` | POST | Anthropic Messages API |

### OpenAI 格式

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/chat/completions` | POST | OpenAI Chat Completions API |
| `/v1/models` | GET | 模型列表 |

### 测试 API

```bash
# 测试 Anthropic 格式
curl -X POST http://你的VPS-IP:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: any" \
  -d '{
    "model": "Qwen3-Max",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": [{"type": "text", "text": "你好"}]}]
  }'

# 测试 OpenAI 格式
curl -X POST http://你的VPS-IP:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3-Max",
    "messages": [{"role": "user", "content": "你好"}],
    "max_tokens": 100
  }'
```

---

## 健康检查与诊断

### VPS 一键诊断

```bash
echo "=========================================="
echo "       CLIProxyAPI 健康检查"
echo "=========================================="
echo ""
echo "1. 服务状态:"
systemctl is-active cliproxyapi && echo "   ✅ 服务运行中" || echo "   ❌ 服务未运行"
echo ""
echo "2. 端口监听:"
ss -tlnp | grep 8080 > /dev/null && echo "   ✅ 端口 8080 正在监听" || echo "   ❌ 端口 8080 未监听"
echo ""
echo "3. API 响应:"
curl -s http://localhost:8080/v1/models > /dev/null && echo "   ✅ API 正常响应" || echo "   ❌ API 无响应"
echo ""
echo "4. 认证状态:"
AUTH_COUNT=$(journalctl -u cliproxyapi -n 20 --no-pager 2>/dev/null | grep -oP '\d+ clients' | tail -1)
if [ -n "$AUTH_COUNT" ]; then
    echo "   ✅ $AUTH_COUNT"
else
    echo "   ⚠️ 无法获取认证状态"
fi
echo ""
echo "=========================================="
```

### 常用运维命令

```bash
# 查看服务状态
systemctl status cliproxyapi

# 重启服务
systemctl restart cliproxyapi

# 查看实时日志
journalctl -u cliproxyapi -f

# 查看最近日志
journalctl -u cliproxyapi -n 50 --no-pager

# 检查端口
ss -tlnp | grep 8080

# 测试 API
curl http://localhost:8080/v1/models
```

### 外部连通性测试

从本地电脑测试 VPS 是否可访问：

```bash
# 测试连通性
curl http://你的VPS-IP:8080/v1/models

# 测试聊天
curl -X POST http://你的VPS-IP:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"Qwen3-Max","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'
```

---

## 自定义域名

### Cloudflare Workers 自定义域名

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages** → 你的 Worker
3. **Settings** → **Domains & Routes** → **Add** → **Custom Domain**
4. 输入你的域名（必须已托管在 Cloudflare）

### VPS 使用 Nginx 反向代理

```bash
# 安装 Nginx
apt install -y nginx

# 配置反向代理
cat > /etc/nginx/sites-available/cliproxyapi << 'EOF'
server {
    listen 80;
    server_name api.你的域名.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# 启用配置
ln -s /etc/nginx/sites-available/cliproxyapi /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 安装 SSL 证书（可选）
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.你的域名.com
```

---

## 常见问题

### Q: Token 多久过期？

CLIProxyAPI 每 15 分钟自动刷新 Token，无需手动操作。

### Q: 服务显示 0 clients

**原因**：认证文件没有复制到 auth-dir

**解决**：
```bash
cp /root/.iflow/oauth_creds.json /root/.cli-proxy-api/
systemctl restart cliproxyapi
```

### Q: 外部无法访问

**检查步骤**：
1. 确认服务运行：`systemctl status cliproxyapi`
2. 确认端口监听：`ss -tlnp | grep 8080`
3. 确认防火墙开放：`ufw status`
4. 确认云服务商安全组开放 8080 端口

### Q: YAML 配置文件格式错误

**错误**：`yaml: line 2: mapping values are not allowed in this context`

**原因**：复制时带了多余的空格

**解决**：确保每行顶格（只有 `- iflow` 需要缩进两个空格）

### Q: API Key 填什么？

填任意字符串即可（如 `any`），CLIProxyAPI 不校验 API Key。

### Q: 如何更新 CLIProxyAPI？

```bash
cd /opt/cliproxyapi
systemctl stop cliproxyapi
wget https://github.com/router-for-me/CLIProxyAPI/releases/download/v新版本/CLIProxyAPI_新版本_linux_amd64.tar.gz
tar -xzf CLIProxyAPI_新版本_linux_amd64.tar.gz
systemctl start cliproxyapi
```

---

## 成本对比

| 方案 | 成本/月 | 优点 | 缺点 |
|------|---------|------|------|
| VPS 部署 | ¥30-50 | 24小时在线、多设备共享 | 有月租成本 |
| 本地部署 | 免费 | 简单、免费 | 需要电脑常开 |

---

## License

MIT
