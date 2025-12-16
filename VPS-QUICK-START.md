# VPS 快速部署 CLIProxyAPI 指南

让 Claude Code CLI 使用 iFlow 国产大模型，支持自动 Token 续期。

---

## 最终效果

```
Claude Code CLI → VPS CLIProxyAPI → iFlow API
                  (自动续期Token)    (国产大模型)
```

- **支持格式**：Anthropic (`/v1/messages`) + OpenAI (`/v1/chat/completions`)
- **自动续期**：CLIProxyAPI 每 15 分钟自动刷新 iFlow Token
- **HTTPS**：Let's Encrypt 免费证书，自动续期

---

## 准备工作

1. 一台 VPS（Ubuntu 22.04/24.04，1核1G即可，约 ¥30-50/月）
2. 一个域名（托管在 Cloudflare 或其他 DNS 服务商）
3. iFlow 账号（https://iflow.cn 注册）

---

## 第一步：连接 VPS

```bash
ssh root@你的VPS-IP
```

---

## 第二步：安装 CLIProxyAPI

```bash
# 更新系统
apt update && apt install -y curl wget

# 创建目录
mkdir -p /opt/cliproxyapi && cd /opt/cliproxyapi

# 下载 CLIProxyAPI（替换为最新版本）
wget https://github.com/router-for-me/CLIProxyAPI/releases/download/v6.6.18/CLIProxyAPI_6.6.18_linux_amd64.tar.gz

# 解压
tar -xzf CLIProxyAPI_6.6.18_linux_amd64.tar.gz
```

---

## 第三步：创建配置文件

```bash
echo 'host: "0.0.0.0"' > /opt/cliproxyapi/config.yaml
echo 'port: 8080' >> /opt/cliproxyapi/config.yaml
echo 'auth-dir: "/root/.cli-proxy-api"' >> /opt/cliproxyapi/config.yaml

# 创建认证目录
mkdir -p /root/.cli-proxy-api

# 验证配置
cat /opt/cliproxyapi/config.yaml
```

应该输出：
```yaml
host: "0.0.0.0"
port: 8080
auth-dir: "/root/.cli-proxy-api"
```

---

## 第四步：登录 iFlow 认证

这是最关键的一步。

### 4.1 在 VPS 上启动登录

```bash
cd /opt/cliproxyapi
./cli-proxy-api -config config.yaml -iflow-login -no-browser
```

会显示类似：
```
Visit the following URL to continue authentication:
https://iflow.cn/oauth?client_id=...&redirect=http://localhost:11451/oauth2callback&state=...
Waiting for iFlow authentication callback...
```

### 4.2 在本地电脑建立 SSH 隧道

**保持 VPS 终端不要关**，在本地电脑新开一个终端：

```bash
ssh -L 11451:127.0.0.1:11451 root@你的VPS-IP -p 22
```

> **遇到 "REMOTE HOST IDENTIFICATION HAS CHANGED" 错误？**
> 运行 `ssh-keygen -R 你的VPS-IP` 清除旧密钥，然后重新连接。

### 4.3 浏览器完成授权

1. 复制 VPS 显示的 `https://iflow.cn/oauth?...` URL
2. 在本地浏览器打开
3. 用手机号登录 iFlow
4. 授权完成

### 4.4 确认成功

VPS 终端会显示：
```
iFlow authentication successful
Saving credentials to /root/.cli-proxy-api/iflow-xxxxx.json
iFlow authentication successful!
```

---

## 第五步：创建 systemd 服务

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

# 启动服务
systemctl daemon-reload
systemctl enable cliproxyapi
systemctl start cliproxyapi

# 检查状态
systemctl status cliproxyapi
```

应该显示 `Active: active (running)`。

---

## 第六步：验证部署

```bash
# 测试模型列表
curl http://localhost:8080/v1/models

# 测试聊天
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "glm-4.6", "messages": [{"role": "user", "content": "hi"}], "max_tokens": 20}'
```

---

## 第七步：配置域名（可选但推荐）

### 7.1 DNS 解析

在你的域名服务商（如 Cloudflare）添加 A 记录：
- 类型：A
- 名称：api（或其他子域名）
- 内容：你的VPS-IP
- 代理状态：关闭（灰色云朵）

### 7.2 安装 Nginx + HTTPS 证书

```bash
# 安装 Nginx 和 Certbot
apt install -y nginx certbot python3-certbot-nginx

# 创建 Nginx 配置（替换 api.你的域名.com）
echo 'server {
    listen 80;
    server_name api.你的域名.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}' > /etc/nginx/sites-available/cliproxyapi

# 启用配置
ln -s /etc/nginx/sites-available/cliproxyapi /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 申请 SSL 证书（替换域名）
certbot --nginx -d api.你的域名.com
```

按提示输入邮箱，同意条款（输入 Y）。

证书有效期 90 天，certbot 会自动续期。

---

## 第八步：使用 Claude Code CLI

### Windows PowerShell

```powershell
$env:ANTHROPIC_BASE_URL = "https://api.你的域名.com"
$env:ANTHROPIC_API_KEY = "any"
claude --model glm-4.6
```

### Windows CMD

```cmd
set ANTHROPIC_BASE_URL=https://api.你的域名.com
set ANTHROPIC_API_KEY=any
claude --model glm-4.6
```

### Linux/macOS

```bash
export ANTHROPIC_BASE_URL=https://api.你的域名.com
export ANTHROPIC_API_KEY=any
claude --model glm-4.6
```

---

## 可用模型列表

| 模型名称 | 说明 | 推荐场景 |
|---------|------|---------|
| `glm-4.6` | 智谱 GLM-4.6 | 中文对话 |
| `deepseek-v3.2` | DeepSeek V3.2 | 综合能力强 |
| `deepseek-v3.2-reasoner` | DeepSeek 推理版 | 复杂推理 |
| `qwen3-max` | 通义千问旗舰版 | 综合能力 |
| `qwen3-coder-plus` | 通义编程增强版 | 代码生成 |
| `kimi-k2` | Kimi K2 | 长上下文 |
| `kimi-k2-thinking` | Kimi 思考版 | 深度推理 |
| `deepseek-r1` | DeepSeek R1 | 推理模型 |

> **注意**：模型名称区分大小写，请使用小写。

查看全部模型：
```bash
curl https://api.你的域名.com/v1/models
```

---

## 常见问题

### Q: 显示 "unknown provider for model xxx"

**原因**：认证文件格式不正确

**解决**：
```bash
rm -rf /root/.cli-proxy-api/*
cd /opt/cliproxyapi
./cli-proxy-api -config config.yaml -iflow-login -no-browser
# 完成认证后
systemctl restart cliproxyapi
```

### Q: 外部无法访问

**检查**：
```bash
# 服务是否运行
systemctl is-active cliproxyapi

# 端口是否监听
ss -tlnp | grep 8080

# 防火墙是否开放
ufw allow 8080/tcp
```

### Q: SSH 隧道 "Permission denied"

**解决**：使用密钥登录
```bash
ssh -i /path/to/key.pem -L 11451:127.0.0.1:11451 root@VPS-IP
```

### Q: SSH 隧道 "REMOTE HOST IDENTIFICATION HAS CHANGED"

**解决**：清除旧密钥
```bash
ssh-keygen -R 你的VPS-IP
```

---

## 运维命令

```bash
# 查看服务状态
systemctl status cliproxyapi

# 重启服务
systemctl restart cliproxyapi

# 查看日志
journalctl -u cliproxyapi -n 50 --no-pager

# 实时日志
journalctl -u cliproxyapi -f

# 健康检查
curl http://localhost:8080/v1/models
```

---

## 费用说明

| 项目 | 费用 |
|------|------|
| VPS | ¥30-50/月 |
| 域名 | ¥10-50/年 |
| iFlow | 免费额度 |
| SSL证书 | 免费（Let's Encrypt） |

---

## 技术支持

- CLIProxyAPI：https://github.com/router-for-me/CLIProxyAPI
- iFlow 论坛：https://vibex.iflow.cn
- QQ 群：188637136
