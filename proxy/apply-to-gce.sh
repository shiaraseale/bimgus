#!/usr/bin/env bash
set -euo pipefail

# Settings come from deploy.env at the repo root (copy deploy.env.example)
ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/deploy.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE not found. Copy deploy.env.example to deploy.env and fill it in."
  exit 1
fi
set -a
source "$ENV_FILE"
set +a
for key in GCP_PROJECT_ID GCP_ZONE PROXY_VM_NAME PROXY_NETWORK_TAG PROXY_FIREWALL_RULE PROXY_HOSTNAME; do
  if [ -z "${!key:-}" ]; then
    echo "❌ $key is not set in deploy.env."
    exit 1
  fi
done

echo "=========================================================="
echo "🛡️  Deploying Hardened Proxy to GCP Compute Engine ($PROXY_VM_NAME)"
echo "=========================================================="

# 1. Update firewall rules: allow port 443 (HTTPS) and port 80 (ACME challenge) on the proxy's network tag
echo "🔒 Configuring firewall rules..."
gcloud compute firewall-rules update "$PROXY_FIREWALL_RULE" \
  --project="$GCP_PROJECT_ID" \
  --allow=tcp:80,tcp:443 \
  --target-tags="$PROXY_NETWORK_TAG" 2>/dev/null || \
gcloud compute firewall-rules create "$PROXY_FIREWALL_RULE" \
  --project="$GCP_PROJECT_ID" \
  --allow=tcp:80,tcp:443 \
  --target-tags="$PROXY_NETWORK_TAG"

# Remove the broad 'http-server' tag from VM if present, keeping only the proxy's tag
echo "🔒 Removing broad http-server network tag..."
gcloud compute instances remove-tags "$PROXY_VM_NAME" \
  --project="$GCP_PROJECT_ID" \
  --zone="$GCP_ZONE" \
  --tags="http-server" 2>/dev/null || true

gcloud compute instances add-tags "$PROXY_VM_NAME" \
  --project="$GCP_PROJECT_ID" \
  --zone="$GCP_ZONE" \
  --tags="$PROXY_NETWORK_TAG" 2>/dev/null || true

# 2. Upload proxy folder to VM and execute setup.sh
echo "📤 Uploading proxy files to $PROXY_VM_NAME..."
gcloud compute scp --recurse \
  --project="$GCP_PROJECT_ID" \
  --zone="$GCP_ZONE" \
  proxy "$PROXY_VM_NAME":~/

echo "🚀 Executing setup.sh on $PROXY_VM_NAME..."
gcloud compute ssh "$PROXY_VM_NAME" \
  --project="$GCP_PROJECT_ID" \
  --zone="$GCP_ZONE" \
  --command="sudo bash ~/proxy/setup.sh '$PROXY_HOSTNAME'"

echo "=========================================================="
echo "✅ VM Hardening Deployment Finished!"
echo "=========================================================="
