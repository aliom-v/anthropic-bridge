#!/bin/bash
# ============================================
# CLIProxyAPI VPS 一键部署脚本
# 适用于 Ubuntu/Debian 系统
# ============================================

set -e

echo "=========================================="
echo "  CLIProxyAPI 一键部署脚本"
echo "=========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否为 root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}请使用 root 用户运行此脚本${NC}"
  echo "使用: sudo bash vps-setup.sh"
  exit 1
fi

# 创建工作目录
WORK_DIR="/opt/cliproxyapi"
mkdir -p $WORK_DIR
cd $WORK_DIR

echo -e "${GREEN}[1/6] 更新系统包...${NC}"
apt-get update -y
apt-get install -y curl wget unzip

# 检测系统架构
ARCH=$(uname -m)
case $ARCH in
  x86_64)
    ARCH="amd64"
    ;;
  aarch64)
    ARCH="arm64"
    ;;
  *)
    echo -e "${RED}不支持的架构: $ARCH${NC}"
    exit 1
    ;;
esac

echo -e "${GREEN}[2/6] 下载 CLIProxyAPI...${NC}"
# 获取最新版本
LATEST_VERSION=$(curl -s https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
echo "最新版本: $LATEST_VERSION"

DOWNLOAD_URL="https://github.com/router-for-me/CLIProxyAPI/releases/download/${LATEST_VERSION}/CLIProxyAPI_Linux_${ARCH}.tar.gz"
echo "下载地址: $DOWNLOAD_URL"

wget -O cliproxyapi.tar.gz "$DOWNLOAD_URL"
tar -xzf cliproxyapi.tar.gz
chmod +x cliproxyapi

echo -e "${GREEN}[3/6] 安装 Node.js 和 iFlow CLI...${NC}"
# 安装 Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# 安装 iFlow CLI
npm install -g @iflow-ai/iflow-cli@latest

echo -e "${GREEN}[4/6] 创建配置文件...${NC}"
# 创建配置目录
mkdir -p $WORK_DIR/auths

# 创建配置文件
cat > $WORK_DIR/config.yaml << 'EOF'
# CLIProxyAPI 配置文件
port: 8080
host: "0.0.0.0"

# 认证目录
auth-dir: "./auths"

# 启用的提供商
providers:
  - iflow

# 日志配置
log-level: "info"
request-logging: true

# 安全配置 (可选)
# api-key: "your-secret-api-key"
EOF

echo -e "${GREEN}[5/6] 创建 systemd 服务...${NC}"
cat > /etc/systemd/system/cliproxyapi.service << EOF
[Unit]
Description=CLIProxyAPI Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$WORK_DIR
ExecStart=$WORK_DIR/cliproxyapi --config $WORK_DIR/config.yaml
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable cliproxyapi

echo -e "${GREEN}[6/6] 完成!${NC}"
echo ""
echo "=========================================="
echo -e "${YELLOW}下一步操作:${NC}"
echo "=========================================="
echo ""
echo "1. 登录 iFlow (在 VPS 上执行):"
echo "   iflow"
echo "   选择 'Login with iFlow' 并完成网页授权"
echo ""
echo "2. 启动 CLIProxyAPI 服务:"
echo "   systemctl start cliproxyapi"
echo ""
echo "3. 检查服务状态:"
echo "   systemctl status cliproxyapi"
echo ""
echo "4. 查看日志:"
echo "   journalctl -u cliproxyapi -f"
echo ""
echo "5. 测试 API:"
echo "   curl http://localhost:8080/v1/models"
echo ""
echo "=========================================="
echo -e "${GREEN}CLIProxyAPI 将运行在: http://你的VPS-IP:8080${NC}"
echo "=========================================="
