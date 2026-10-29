#!/usr/bin/env bash
set -euo pipefail

# The public hostname comes from apply-to-gce.sh (PROXY_HOSTNAME in deploy.env)
PROXY_HOSTNAME="${1:-${PROXY_HOSTNAME:-}}"
if ! [[ "$PROXY_HOSTNAME" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "❌ Usage: setup.sh <proxy-hostname>  (got: '${PROXY_HOSTNAME}')"
  exit 1
fi

echo "=========================================================="
echo "🛡️  Configuring Hardened Clash Proxy & Caddy on GCE VM"
echo "=========================================================="

# 1. Update packages & install base dependencies
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg ufw unattended-upgrades

# Enable automated security updates
dpkg-reconfigure -f noninteractive -p low unattended-upgrades || true

# 2. Install Node.js 22 (LTS) if not already installed or on an older version
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  CURRENT_NODE_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v')
  if [ "$CURRENT_NODE_MAJOR" -ge 22 ]; then
    echo "✅ Node.js $(node -v) is already installed."
    NEED_NODE=0
  fi
fi

if [ "$NEED_NODE" -eq 1 ]; then
  echo "📦 Installing Node.js 22 LTS..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi

# 3. Install Caddy web server if not already installed
if ! command -v caddy >/dev/null 2>&1; then
  echo "📦 Installing Caddy web server..."
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# 4. Create isolated system user 'clashproxy' if it does not exist
if ! id -u clashproxy >/dev/null 2>&1; then
  echo "👤 Creating system user clashproxy..."
  useradd -r -s /usr/sbin/nologin -d /opt/clash-proxy clashproxy
fi

# 5. Create app directory and copy application files
mkdir -p /opt/clash-proxy
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cp "$SCRIPT_DIR/package.json" /opt/clash-proxy/package.json
cp "$SCRIPT_DIR/package-lock.json" /opt/clash-proxy/package-lock.json
cp "$SCRIPT_DIR/server.js" /opt/clash-proxy/server.js

cd /opt/clash-proxy
npm ci --omit=dev
chown -R clashproxy:clashproxy /opt/clash-proxy

# 6. Set up secure environment file in /etc/clash-proxy/env (Mode 600, root:root)
mkdir -p /etc/clash-proxy
if [ ! -f /etc/clash-proxy/env ]; then
  echo "🔑 Generating /etc/clash-proxy/env with fresh random PROXY_KEY..."
  GENERATED_KEY=$(head -c 32 /dev/urandom | xxd -p -c 32 2>/dev/null || openssl rand -hex 32)
  cat << ENV_EOF > /etc/clash-proxy/env
# Clash Proxy Secret Environment Configuration
# Owned by root:root, mode 600. Loaded by systemd EnvironmentFile=.
PROXY_KEY=${GENERATED_KEY}
COC_API_TOKEN=REPLACE_WITH_YOUR_NEW_COC_TOKEN
PORT=8080
ENV_EOF
  chmod 600 /etc/clash-proxy/env
  chown root:root /etc/clash-proxy/env
  echo "⚠️  Created new /etc/clash-proxy/env. Please insert your Supercell API token into COC_API_TOKEN!"
else
  echo "✅ /etc/clash-proxy/env already exists. Preserving existing secrets."
fi

# 7. Install and start clash-proxy systemd service
echo "⚙️  Configuring clash-proxy systemd service..."
cp "$SCRIPT_DIR/clash-proxy.service" /etc/systemd/system/clash-proxy.service
systemctl daemon-reload
systemctl enable clash-proxy
systemctl restart clash-proxy

# 8. Install Caddyfile and reload Caddy
echo "🌐 Configuring Caddy HTTPS reverse proxy..."
sed "s/__PROXY_HOSTNAME__/${PROXY_HOSTNAME}/g" "$SCRIPT_DIR/Caddyfile.template" > /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

echo "=========================================================="
echo "✅ Hardened Clash Proxy installation completed!"
echo "   Proxy endpoint: http://127.0.0.1:8080 (internal)"
echo "   Public HTTPS:   https://${PROXY_HOSTNAME}"
echo "=========================================================="
