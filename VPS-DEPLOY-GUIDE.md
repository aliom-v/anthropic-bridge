# VPS 部署 CLIProxyAPI 完整指南

本指南将帮助你从零开始在 VPS 上部署 CLIProxyAPI，让 Claude Code CLI 可以使用 iFlow 提供的国产大模型。

---

## 目录

- [架构说明](#架构说明)
- [准备工作](#准备工作)
- [第一步：购买 VPS](#第一步购买-vps)
- [第二步：连接 VPS](#第二步连接-vps)
- [第三步：安装 CLIProxyAPI](#第三步安装-cliproxyapi)
- [第四步：登录 iFlow 认证](#第四步登录-iflow-认证)
- [第五步：配置 systemd 服务](#第五步配置-systemd-服务)
- [第六步：验证部署](#第六步验证部署)
- [第七步：配置客户端](#第七步配置客户端)
- [常见问题排查](#常见问题排查)
- [运维命令速查](#运维命令速查)

---

## 架构说明

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────┐
│  Claude Code    │     │   VPS               │     │   iFlow     │
│  CLI            │────▶│   CLIProxyAPI       │────▶│   API       │
│  (你的电脑)      │     │   (协议转换+Token续期) │     │   (大模型)   │
└─────────────────┘     └─────────────────────┘     └─────────────┘
```

**CLIProxyAPI 的作用：**
- 接收 Anthropic 格式的 API 请求
- 转换为 iFlow 支持的格式
- 自动管理和刷新 iFlow Token（每15分钟）
- 24小时在线，多设备可共享

---

## 准备工作

在开始之前，你需要：

1. **一台 VPS 服务器**
   - 推荐配置：1核 1G 内存即可
   - 系统：Ubuntu 22.04 或 24.04（本教程以此为例）
   - 月费：约 ¥30-50

2. **SSH 工具**
   - Windows：使用 PowerShell、CMD 或 [Termius](https://termius.com/)
   - macOS/Linux：终端自带 ssh 命令

3. **iFlow 账号**
   - 访问 [iFlow](https://iflow.cn) 注册账号
   - 需要手机号验证

---

## 第一步：购买 VPS

### 推荐 VPS 服务商

| 服务商 | 价格 | 特点 |
|--------|------|------|
| [Vultr](https://vultr.com) | $5/月起 | 按小时计费，随时删除 |
| [DigitalOcean](https://digitalocean.com) | $4/月起 | 稳定可靠 |
| [Bandwagon](https://bandwagonhost.com) | $49/年起 | 性价比高 |
| [腾讯云轻量](https://cloud.tencent.com/product/lighthouse) | ¥30/月起 | 国内访问快 |

### 购买要点

1. 选择 **Ubuntu 22.04** 或 **24.04** 系统
2. 选择距离你较近的机房
3. 记录下 VPS 的：
   - **IP 地址**（如 `23.95.28.213`）
   - **root 密码** 或 **SSH 密钥**

---

## 第二步：连接 VPS

### Windows 用户

打开 PowerShell 或 CMD：

```bash
ssh root@你的VPS-IP
```

例如：
```bash
ssh root@23.95.28.213
```

首次连接会提示确认指纹，输入 `yes`，然后输入密码。

### 使用 SSH 密钥连接

如果你的 VPS 使用密钥认证：

```bash
ssh -i C:\path\to\your-key.pem root@你的VPS-IP
```

### macOS/Linux 用户

```bash
ssh root@你的VPS-IP
```

---

## 第三步：安装 CLIProxyAPI

### 3.1 更新系统

```bash
apt update && apt install -y curl wget
```

### 3.2 创建工作目录

```bash
mkdir -p /opt/cliproxyapi
cd /opt/cliproxyapi
```

### 3.3 下载 CLIProxyAPI

访问 [CLIProxyAPI Releases](https://github.com/router-for-me/CLIProxyAPI/releases) 查看最新版本。

```bash
# 下载（以 v6.6.18 为例，请替换为最新版本）
wget https://github.com/router-for-me/CLIProxyAPI/releases/download/v6.6.18/CLIProxyAPI_Linux_amd64.tar.gz

# 解压
tar -xzf CLIProxyAPI_Linux_amd64.tar.gz

# 查看文件
ls -la
```

你应该看到 `cli-proxy-api` 可执行文件。

### 3.4 创建配置文件

```bash
echo 'host: "0.0.0.0"' > /opt/cliproxyapi/config.yaml
echo 'port: 8080' >> /opt/cliproxyapi/config.yaml
echo 'auth-dir: "/root/.cli-proxy-api"' >> /opt/cliproxyapi/config.yaml
echo 'debug: false' >> /opt/cliproxyapi/config.yaml
```

验证配置文件：
```bash
cat /opt/cliproxyapi/config.yaml
```

应该输出：
```yaml
host: "0.0.0.0"
port: 8080
auth-dir: "/root/.cli-proxy-api"
debug: false
```

### 3.5 创建认证目录

```bash
mkdir -p /root/.cli-proxy-api
```

---

## 第四步：登录 iFlow 认证

这是最关键的一步，CLIProxyAPI 需要 iFlow 的认证信息才能调用 API。

### 4.1 启动登录流程

```bash
cd /opt/cliproxyapi
./cli-proxy-api -config /opt/cliproxyapi/config.yaml -iflow-login -no-browser
```

你会看到类似输出：
```
CLIProxyAPI Version: 6.6.18
To authenticate from a remote machine, an SSH tunnel may be required.
================================================================================
  Run one of the following commands on your local machine (NOT the server):

  ssh -L 11451:127.0.0.1:11451 root@你的VPS-IP -p 22
================================================================================
Visit the following URL to continue authentication:
https://iflow.cn/oauth?client_id=...&redirect=http%3A%2F%2Flocalhost%3A11451%2Foauth2callback&state=...
Waiting for iFlow authentication callback...
```

### 4.2 建立 SSH 隧道

**保持当前终端不要关闭**，在你的**本地电脑**新开一个终端窗口：

```bash
ssh -L 11451:127.0.0.1:11451 root@你的VPS-IP -p 22
```

输入密码登录（保持这个连接不要关闭）。

### 4.3 完成浏览器授权

1. 复制 VPS 终端显示的 URL（`https://iflow.cn/oauth?...`）
2. 在本地浏览器打开这个 URL
3. 使用手机号登录 iFlow
4. 授权完成后，浏览器会自动跳转

### 4.4 确认登录成功

VPS 终端会显示：
```
iFlow authentication successful
Saving credentials to /root/.cli-proxy-api/iflow-xxxxx.json
iFlow authentication successful!
```

现在可以关闭 SSH 隧道的终端了。

---

## 第五步：配置 systemd 服务

让 CLIProxyAPI 作为系统服务运行，开机自启。

### 5.1 创建服务文件

```bash
echo '[Unit]' > /etc/systemd/system/cliproxyapi.service
echo 'Description=CLIProxyAPI Service' >> /etc/systemd/system/cliproxyapi.service
echo 'After=network.target' >> /etc/systemd/system/cliproxyapi.service
echo '' >> /etc/systemd/system/cliproxyapi.service
echo '[Service]' >> /etc/systemd/system/cliproxyapi.service
echo 'Type=simple' >> /etc/systemd/system/cliproxyapi.service
echo 'User=root' >> /etc/systemd/system/cliproxyapi.service
echo 'WorkingDirectory=/opt/cliproxyapi' >> /etc/systemd/system/cliproxyapi.service
echo 'ExecStart=/opt/cliproxyapi/cli-proxy-api --config /opt/cliproxyapi/config.yaml' >> /etc/systemd/system/cliproxyapi.service
echo 'Restart=always' >> /etc/systemd/system/cliproxyapi.service
echo 'RestartSec=10' >> /etc/systemd/system/cliproxyapi.service
echo '' >> /etc/systemd/system/cliproxyapi.service
echo '[Install]' >> /etc/systemd/system/cliproxyapi.service
echo 'WantedBy=multi-user.target' >> /etc/systemd/system/cliproxyapi.service
```

### 5.2 启动服务

```bash
# 重新加载 systemd
systemctl daemon-reload

# 设置开机自启
systemctl enable cliproxyapi

# 启动服务
systemctl start cliproxyapi

# 查看状态
systemctl status cliproxyapi
```

你应该看到 `Active: active (running)`。

---

## 第六步：验证部署

### 6.1 检查服务状态

```bash
systemctl is-active cliproxyapi
```

应该输出 `active`。

### 6.2 检查端口监听

```bash
ss -tlnp | grep 8080
```

应该看到类似：
```
LISTEN 0 4096 *:8080 *:* users:(("cli-proxy-api",...))
```

### 6.3 检查认证加载

```bash
journalctl -u cliproxyapi -n 20 --no-pager | grep -i client
```

应该看到类似：
```
Registered client iflow-xxxxx.json from provider iflow with 20 models
```

### 6.4 测试本地 API

```bash
# 测试模型列表
curl http://localhost:8080/v1/models

# 测试聊天（OpenAI 格式）
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "glm-4.6", "messages": [{"role": "user", "content": "hi"}], "max_tokens": 20}'

# 测试聊天（Anthropic 格式）
curl -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: any" \
  -d '{"model": "glm-4.6", "max_tokens": 20, "messages": [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]}'
```

### 6.5 测试外部访问

在你的**本地电脑**上测试：

```bash
curl http://你的VPS-IP:8080/v1/models
```

如果无法访问，检查防火墙设置（见常见问题）。

---

## 第七步：配置客户端

### Claude Code CLI

**Windows PowerShell：**
```powershell
$env:ANTHROPIC_BASE_URL = "http://你的VPS-IP:8080"
$env:ANTHROPIC_API_KEY = "any"

# 启动 Claude Code（指定模型）
claude --model glm-4.6
```

**Windows CMD：**
```cmd
set ANTHROPIC_BASE_URL=http://你的VPS-IP:8080
set ANTHROPIC_API_KEY=any

claude --model glm-4.6
```

**Linux/macOS：**
```bash
export ANTHROPIC_BASE_URL=http://你的VPS-IP:8080
export ANTHROPIC_API_KEY=any

claude --model glm-4.6
```

### 可用模型

| 模型名称 | 说明 |
|---------|------|
| `glm-4.6` | 智谱 GLM-4.6，中文优化 |
| `deepseek-v3.2` | DeepSeek V3.2，综合能力强 |
| `qwen3-max` | 通义千问3 旗舰版 |
| `kimi-k2` | Kimi K2，长上下文 |

> 完整模型列表：`curl http://你的VPS-IP:8080/v1/models`

---

## 常见问题排查

### 问题 1：服务启动失败

**症状：** `systemctl status cliproxyapi` 显示 `failed`

**排查：**
```bash
journalctl -u cliproxyapi -n 50 --no-pager
```

**常见原因：**
- 配置文件格式错误
- 端口被占用
- 认证文件不存在

### 问题 2：显示 0 clients

**症状：** 日志显示 `0 clients (0 auth files + ...)`

**原因：** 没有正确的 iFlow 认证文件

**解决：** 重新执行[第四步：登录 iFlow 认证](#第四步登录-iflow-认证)

**验证认证文件：**
```bash
ls -la /root/.cli-proxy-api/
```

应该有类似 `iflow-xxxxx.json` 的文件。

### 问题 3：unknown provider for model xxx

**症状：** API 返回 `unknown provider for model xxx`

**原因：**
1. 认证文件格式不正确（可能复制了 iFlow CLI 的文件而不是 CLIProxyAPI 生成的）
2. 模型名称错误

**解决：**
1. 删除旧认证文件：`rm -rf /root/.cli-proxy-api/*`
2. 用 CLIProxyAPI 重新登录：
   ```bash
   cd /opt/cliproxyapi
   ./cli-proxy-api -config /opt/cliproxyapi/config.yaml -iflow-login -no-browser
   ```
3. 使用正确的模型名（小写）：`glm-4.6` 而不是 `GLM-4.6`

### 问题 4：外部无法访问

**症状：** 本地 `curl http://VPS-IP:8080` 超时

**排查步骤：**

1. **确认服务运行：**
   ```bash
   systemctl is-active cliproxyapi
   ```

2. **确认端口监听：**
   ```bash
   ss -tlnp | grep 8080
   ```

3. **检查防火墙（Ubuntu）：**
   ```bash
   # 查看状态
   ufw status

   # 如果是 active，开放端口
   ufw allow 8080/tcp
   ```

4. **检查云服务商安全组：**
   - 登录云服务商控制台
   - 找到安全组/防火墙设置
   - 添加入站规则：TCP 8080

### 问题 5：SSH 隧道 Permission denied

**症状：** `ssh -L ... Permission denied (publickey,password)`

**原因：** VPS 禁用了密码登录，只允许密钥

**解决：**
```bash
ssh -i /path/to/your-key.pem -L 11451:127.0.0.1:11451 root@VPS-IP -p 22
```

### 问题 6：iFlow 登录超时

**症状：** 登录等待超时，没有收到回调

**原因：** SSH 隧道没有正确建立

**解决：**
1. 确保 SSH 隧道终端保持连接
2. 确保访问的是显示的完整 URL
3. 重新执行登录流程

### 问题 7：Failed after 3 attempts

**症状：** API 返回 `Failed after 3 attempts`

**原因：** iFlow 服务端问题或网络问题

**解决：**
1. 稍后重试
2. 检查 iFlow 服务状态
3. 查看详细日志：`journalctl -u cliproxyapi -f`

---

## 运维命令速查

### 服务管理

```bash
# 启动服务
systemctl start cliproxyapi

# 停止服务
systemctl stop cliproxyapi

# 重启服务
systemctl restart cliproxyapi

# 查看状态
systemctl status cliproxyapi

# 设置开机自启
systemctl enable cliproxyapi

# 取消开机自启
systemctl disable cliproxyapi
```

### 日志查看

```bash
# 查看最近日志
journalctl -u cliproxyapi -n 50 --no-pager

# 实时查看日志
journalctl -u cliproxyapi -f

# 查看今天的日志
journalctl -u cliproxyapi --since today
```

### 健康检查

```bash
# 一键诊断
echo "=== 服务状态 ===" && systemctl is-active cliproxyapi
echo "=== 端口监听 ===" && ss -tlnp | grep 8080
echo "=== 认证状态 ===" && journalctl -u cliproxyapi -n 20 --no-pager | grep -i "client"
echo "=== API 测试 ===" && curl -s http://localhost:8080/v1/models | head -c 100
```

### 更新 CLIProxyAPI

```bash
cd /opt/cliproxyapi
systemctl stop cliproxyapi

# 下载新版本（替换版本号）
wget https://github.com/router-for-me/CLIProxyAPI/releases/download/v新版本/CLIProxyAPI_Linux_amd64.tar.gz
tar -xzf CLIProxyAPI_Linux_amd64.tar.gz

systemctl start cliproxyapi
```

### 重新认证 iFlow

```bash
# 删除旧认证
rm -rf /root/.cli-proxy-api/*

# 停止服务
systemctl stop cliproxyapi

# 重新登录
cd /opt/cliproxyapi
./cli-proxy-api -config /opt/cliproxyapi/config.yaml -iflow-login -no-browser

# 完成认证后启动服务
systemctl start cliproxyapi
```

---

## 成本说明

| 项目 | 成本 |
|------|------|
| VPS | ¥30-50/月 |
| iFlow | 免费（有使用额度） |
| **总计** | **¥30-50/月** |

---

## 获取帮助

- **CLIProxyAPI 问题**：[GitHub Issues](https://github.com/router-for-me/CLIProxyAPI/issues)
- **iFlow 问题**：[iFlow 论坛](https://vibex.iflow.cn)
- **QQ 群**：188637136
- **Telegram**：https://t.me/CLIProxyAPI

---

## 下一步

部署完成后，你可以：

1. **配置自定义域名**：使用 Nginx 反向代理 + SSL 证书
2. **多账户轮询**：添加多个 iFlow 账户提高可用性
3. **监控告警**：配置服务监控和告警通知
