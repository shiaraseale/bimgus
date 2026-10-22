#!/bin/bash
set -e

PROJECT_ID="your-project-id"
ZONE="us-central1-a"
REGION="us-central1"
VM_NAME="clash-proxy"

echo "=========================================================="
echo "🚀 Provisioning GCP Free-Tier Static IP Proxy for Bimgus"
echo "=========================================================="

# 1. Firewall rule
gcloud compute firewall-rules create allow-bimgus-proxy \
  --project="$PROJECT_ID" \
  --allow=tcp:80 \
  --target-tags="clash-proxy" 2>/dev/null || true

# 2. Write startup script to local file
cat << 'EOF' > startup.sh
#!/bin/bash
apt-get update
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
mkdir -p /opt/clash-proxy

cat << 'JSON' > /opt/clash-proxy/package.json
{
  "name": "clash-api-proxy",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "axios": "^1.7.9",
    "cors": "^2.8.5",
    "express": "^4.21.2"
  }
}
JSON

cat << 'JS' > /opt/clash-proxy/server.js
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = 80;

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", proxy: "Bimgus CoC Proxy Active" });
});

app.all("/v1/*", async (req, res) => {
  const targetPath = req.originalUrl;
  const targetUrl = `https://api.clashofclans.com${targetPath}`;
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      params: req.query,
      data: req.body,
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      timeout: 15000,
      validateStatus: () => true,
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(502).json({ error: "Proxy gateway error", message: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Clash Proxy running on port ${PORT}`);
});
JS

cd /opt/clash-proxy && npm install

cat << 'SERVICE' > /etc/systemd/system/clash-proxy.service
[Unit]
Description=Bimgus Clash Proxy
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/clash-proxy
ExecStart=/usr/bin/node /opt/clash-proxy/server.js
Restart=always

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable clash-proxy
systemctl start clash-proxy
EOF

# 3. Create the VM instance using --metadata-from-file
gcloud compute instances create "$VM_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --machine-type=e2-micro \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=10GB \
  --boot-disk-type=pd-standard \
  --tags="clash-proxy,http-server" \
  --metadata-from-file startup-script=startup.sh

rm -f startup.sh

# 4. Promote and print static IP
VM_IP=$(gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
gcloud compute addresses create bimgus-proxy-ip --addresses="$VM_IP" --region="$REGION" --project="$PROJECT_ID" 2>/dev/null || true

echo ""
echo "=========================================================="
echo "🎉 SUCCESS! Your Permanent Static Proxy IP is: $VM_IP"
echo "=========================================================="
