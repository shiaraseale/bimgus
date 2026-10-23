#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="your-project-id"
ZONE="us-central1-a"
VM_NAME="clash-proxy"

echo "=========================================================="
echo "🛡️  Deploying Hardened Proxy to GCP Compute Engine ($VM_NAME)"
echo "=========================================================="

# 1. Update firewall rules: allow port 443 (HTTPS) and port 80 (ACME challenge) on tag clash-proxy
echo "🔒 Configuring firewall rules..."
gcloud compute firewall-rules update allow-bimgus-proxy \
  --project="$PROJECT_ID" \
  --allow=tcp:80,tcp:443 \
  --target-tags="clash-proxy" 2>/dev/null || \
gcloud compute firewall-rules create allow-bimgus-proxy \
  --project="$PROJECT_ID" \
  --allow=tcp:80,tcp:443 \
  --target-tags="clash-proxy"

# Remove the broad 'http-server' tag from VM if present, keeping only 'clash-proxy'
echo "🔒 Removing broad http-server network tag..."
gcloud compute instances remove-tags "$VM_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --tags="http-server" 2>/dev/null || true

gcloud compute instances add-tags "$VM_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --tags="clash-proxy" 2>/dev/null || true

# 2. Upload proxy folder to VM and execute setup.sh
echo "📤 Uploading proxy files to $VM_NAME..."
gcloud compute scp --recurse \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  proxy "$VM_NAME":~/

echo "🚀 Executing setup.sh on $VM_NAME..."
gcloud compute ssh "$VM_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --command="sudo bash ~/proxy/setup.sh"

echo "=========================================================="
echo "✅ VM Hardening Deployment Finished!"
echo "=========================================================="
