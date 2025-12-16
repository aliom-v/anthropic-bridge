# Anthropic Bridge 完整部署指南

> 让 Claude Code CLI 和其他 Anthropic 客户端使用 iFlow API

---

## 架构概览

本项目提供 **两种 API 格式**，一个地址同时支持：

| 协议 | 端点 | 适用客户端 |
|------|------|-----------|
| **Anthropic** | `/v1/messages` | Claude Code CLI, Cherry Studio (Anthropic 模式) |
| **OpenAI** | `/v1/chat/completions` | ChatGPT 客户端, Cursor, 其他 OpenAI 兼容工具 |

```
┌─────────────────────────────────────────────────────────────┐
│                      客户端                                  │
├─────────────────────────────────────────────────────────────┤
│  Claude Code CLI        │  ChatGPT 客户端 / Cursor          │
│  Cherry Studio          │  其他 OpenAI 兼容工具              │
│  (Anthropic 格式)       │  (OpenAI 格式)                     │
└────────────┬────────────┴──────────────┬────────────────────┘
             │                           │
             │ /v1/messages              │ /v1/chat/completions
             │ (Anthropic)               │ (OpenAI)
             ▼                           ▼
┌─────────────────────────────────────────────────────────────┐
│              CLIProxyAPI (本地 或 VPS)                       │
│                                                             │
│  • 同时支持 Anthropic 和 OpenAI 两种协议                      │
│  • Token 自动续期（每 15 分钟刷新）                           │
│  • 持久化登录状态                                            │
└─────────────────────────────────────────────────────────────┘
             │
             │ iFlow OAuth
             ▼
         iFlow API
```

---

## 部署方案对比

| 方案 | 复杂度 | 成本 | Token 续期 | 适合场景 |
|------|--------|------|-----------|---------|
| **方案 A**: 本地部署 | ⭐⭐ | 免费 | 自动 | 电脑常开，个人使用 |
| **方案 B**: VPS 部署 | ⭐⭐⭐ | ¥30-50/月 | 自动 | 24小时在线，多设备共享 |

---

# 方案 A：本地部署（推荐个人使用）

> 完全免费，Token 自动续期，电脑常开即可

## 步骤 1：安装 Node.js

### Windows

下载安装：https://nodejs.org/ （选择 LTS 版本）

### macOS

```bash
brew install node
```

### Linux

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
```

---

## 步骤 2：安装并登录 iFlow CLI

```bash
npm install -g @iflow-ai/iflow-cli@latest
iflow
```

选择 **Login with iFlow**（选项 1），浏览器会自动打开完成授权。

---

## 步骤 3：下载 CLIProxyAPI

访问 https://github.com/router-for-me/CLIProxyAPI/releases 下载对应版本：

| 系统 | 文件名 |
|------|--------|
| Windows | `CLIProxyAPI_6.6.18_windows_amd64.zip` |
| macOS Intel | `CLIProxyAPI_6.6.18_darwin_amd64.tar.gz` |
| macOS Apple Silicon | `CLIProxyAPI_6.6.18_darwin_arm64.tar.gz` |
| Linux | `CLIProxyAPI_6.6.18_linux_amd64.tar.gz` |

> ⚠️ **注意**：版本号会更新，请下载最新版本

---

## 步骤 4：解压并配置

### Windows

1. 解压 zip 文件到任意目录（如 `C:\CLIProxyAPI`）
2. 在该目录创建 `config.yaml` 文件：

```yaml
port: 8080
host: "127.0.0.1"
providers:
  - iflow
log-level: "info"
auth-dir: "C:/Users/你的用户名/.cli-proxy-api"
```

3. 创建 auth 目录并复制认证文件：

```cmd
mkdir C:\Users\你的用户名\.cli-proxy-api
copy C:\Users\你的用户名\.iflow\oauth_creds.json C:\Users\你的用户名\.cli-proxy-api\
```

### macOS / Linux

```bash
# 解压
tar -xzf CLIProxyAPI_*.tar.gz
cd CLIProxyAPI_*

# 创建配置文件
cat > config.yaml << 'EOF'
port: 8080
host: "127.0.0.1"
providers:
  - iflow
log-level: "info"
auth-dir: "~/.cli-proxy-api"
EOF

# 创建 auth 目录并复制认证文件
mkdir -p ~/.cli-proxy-api
cp ~/.iflow/oauth_creds.json ~/.cli-proxy-api/
```

---

## 步骤 5：启动服务

### Windows

```cmd
cd C:\CLIProxyAPI
cli-proxy-api.exe --config config.yaml
```

### macOS / Linux

```bash
./cli-proxy-api --config config.yaml
```

看到以下输出表示成功：
```
API server started successfully on: 127.0.0.1:8080
server clients and configuration updated: 1 clients
```

---

## 步骤 6：配置客户端

### Claude Code CLI（Anthropic 格式）

```bash
# Linux/macOS
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_API_KEY=any

# Windows CMD
set ANTHROPIC_BASE_URL=http://localhost:8080
set ANTHROPIC_API_KEY=any

# Windows PowerShell
$env:ANTHROPIC_BASE_URL = "http://localhost:8080"
$env:ANTHROPIC_API_KEY = "any"
```

### Cherry Studio（Anthropic 格式）

1. 打开设置 → 模型服务
2. 选择 `Anthropic` 或 `自定义 Anthropic`
3. Base URL: `http://localhost:8080`
4. API Key: 任意字符串

### OpenAI 兼容客户端（ChatGPT 客户端、Cursor 等）

- Base URL: `http://localhost:8080/v1`
- API Key: 任意字符串

---

## 步骤 7：测试

### 测试 Anthropic 格式

```bash
curl -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: any" \
  -d '{
    "model": "Qwen3-Max",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": [{"type": "text", "text": "你好"}]}]
  }'
```

### 测试 OpenAI 格式

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3-Max",
    "messages": [{"role": "user", "content": "你好"}],
    "max_tokens": 100
  }'
```

---

## Windows 开机自启（可选）

1. 按 `Win + R`，输入 `shell:startup`，回车
2. 在打开的文件夹中创建 `start-cliproxyapi.bat`：

```bat
@echo off
cd /d C:\CLIProxyAPI
start /min cli-proxy-api.exe --config config.yaml
```

---

# 方案 B：VPS 部署（推荐生产环境）

> 24小时在线，多设备共享，适合团队使用

## 步骤 1：准备 VPS

推荐配置：
- 系统：Ubuntu 22.04 / 24.04
- 配置：1核 1G 即可
- 成本：约 ¥30-50/月

---

## 步骤 2：安装依赖

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

---

## 步骤 3：登录 iFlow

```bash
iflow
```

选择 **Login with iFlow**（选项 1）。

> **无法打开浏览器？** 终端会显示一个授权 URL，复制到本地电脑浏览器打开完成授权。

---

## 步骤 4：安装 CLIProxyAPI

```bash
# 创建目录
mkdir -p /opt/cliproxyapi && cd /opt/cliproxyapi

# 下载（根据最新版本调整）
wget https://github.com/router-for-me/CLIProxyAPI/releases/download/v6.6.18/CLIProxyAPI_6.6.18_linux_amd64.tar.gz

# 解压
tar -xzf CLIProxyAPI_6.6.18_linux_amd64.tar.gz
```

---

## 步骤 5：创建配置文件

```bash
printf 'port: 8080
host: "0.0.0.0"
providers:
  - iflow
log-level: "info"
auth-dir: "/root/.cli-proxy-api"
' > /opt/cliproxyapi/config.yaml
```

---

## 步骤 6：复制认证文件

```bash
mkdir -p /root/.cli-proxy-api
cp /root/.iflow/oauth_creds.json /root/.cli-proxy-api/
```

---

## 步骤 7：创建 systemd 服务

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

---

## 步骤 8：启动服务

```bash
systemctl daemon-reload
systemctl enable cliproxyapi
systemctl start cliproxyapi

# 检查状态
systemctl status cliproxyapi
```

看到 `Active: active (running)` 表示成功。

---

## 步骤 9：开放防火墙

```bash
ufw allow 8080/tcp
```

或在云服务商控制台开放 8080 端口。

---

## 步骤 10：测试

### 在 VPS 本地测试

```bash
curl http://localhost:8080/v1/models
```

### 从外部测试

```bash
curl http://你的VPS-IP:8080/v1/models
```

---

## 步骤 11：配置客户端

### Claude Code CLI（Anthropic 格式）

```bash
# Linux/macOS
export ANTHROPIC_BASE_URL=http://你的VPS-IP:8080
export ANTHROPIC_API_KEY=any

# Windows CMD
set ANTHROPIC_BASE_URL=http://你的VPS-IP:8080
set ANTHROPIC_API_KEY=any
```

### OpenAI 兼容客户端

- Base URL: `http://你的VPS-IP:8080/v1`
- API Key: 任意字符串

---

# 可用模型列表

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

> 模型名称直接透传到 iFlow API，使用 iFlow 支持的任意模型名即可。

---

# VPS 运维命令

## 服务管理

```bash
# 查看状态
systemctl status cliproxyapi

# 重启服务
systemctl restart cliproxyapi

# 停止服务
systemctl stop cliproxyapi

# 查看实时日志
journalctl -u cliproxyapi -f

# 查看最近 50 行日志
journalctl -u cliproxyapi -n 50 --no-pager
```

## 检查服务是否正常

```bash
# 一键诊断
echo "=== 服务状态 ===" && systemctl is-active cliproxyapi
echo "=== 端口监听 ===" && ss -tlnp | grep 8080
echo "=== API 测试 ===" && curl -s http://localhost:8080/v1/models | head -c 200
```

## 更新 CLIProxyAPI

```bash
cd /opt/cliproxyapi

# 下载新版本
wget https://github.com/router-for-me/CLIProxyAPI/releases/download/v新版本号/CLIProxyAPI_新版本号_linux_amd64.tar.gz

# 停止服务
systemctl stop cliproxyapi

# 解压覆盖
tar -xzf CLIProxyAPI_新版本号_linux_amd64.tar.gz

# 启动服务
systemctl start cliproxyapi
```

---

# 避坑指南

## 1. YAML 配置文件格式错误

**错误**：`yaml: line 2: mapping values are not allowed in this context`

**原因**：复制时带了多余的空格

**正确格式**（每行顶格，只有 `- iflow` 需要缩进）：
```yaml
port: 8080
host: "0.0.0.0"
providers:
  - iflow
log-level: "info"
auth-dir: "/root/.cli-proxy-api"
```

## 2. 找不到认证目录

**错误**：`failed to create auth directory : mkdir : no such file or directory`

**解决**：
```bash
mkdir -p /root/.cli-proxy-api
cp /root/.iflow/oauth_creds.json /root/.cli-proxy-api/
```

## 3. 服务显示 0 clients

**原因**：认证文件没有复制到 auth-dir

**解决**：
```bash
cp ~/.iflow/oauth_creds.json ~/.cli-proxy-api/
```

## 4. 外部无法访问

**检查步骤**：
1. 确认服务运行：`systemctl status cliproxyapi`
2. 确认端口监听：`ss -tlnp | grep 8080`
3. 确认防火墙开放：`ufw status`
4. 确认云服务商安全组开放 8080 端口

## 5. CLIProxyAPI 下载 404

**原因**：文件名格式错误

**正确格式**：`CLIProxyAPI_6.6.18_linux_amd64.tar.gz`（带版本号）

**错误格式**：`CLIProxyAPI_Linux_amd64.tar.gz`（不带版本号）

## 6. VPS 无法打开浏览器登录 iFlow

**解决**：iflow 命令会显示授权 URL，复制到本地电脑浏览器打开完成授权

---

# 成本对比

| 方案 | 成本/月 | 优点 | 缺点 |
|------|---------|------|------|
| 本地部署 | **免费** | 简单、免费 | 需要电脑常开 |
| VPS 部署 | **¥30-50** | 24小时在线、多设备共享 | 有月租成本 |

---

# 常见问题 FAQ

### Q: Token 多久过期？

CLIProxyAPI 每 15 分钟自动刷新 Token，无需手动操作。

### Q: 支持哪些客户端？

- **Anthropic 格式**：Claude Code CLI, Cherry Studio
- **OpenAI 格式**：ChatGPT 客户端, Cursor, Continue, 等任何 OpenAI 兼容工具

### Q: 可以同时支持两种格式吗？

是的，CLIProxyAPI 同时提供 `/v1/messages` (Anthropic) 和 `/v1/chat/completions` (OpenAI) 两个端点。

### Q: API Key 填什么？

填任意字符串即可（如 `any`），CLIProxyAPI 不校验 API Key。

### Q: 如何查看支持的模型？

```bash
curl http://localhost:8080/v1/models
```

---

# License

MIT
