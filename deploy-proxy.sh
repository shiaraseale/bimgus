#!/bin/bash
set -euo pipefail

# Provisions the proxy VM, its firewall rule and a static IP. proxy/apply-to-gce.sh then installs
# the proxy on it. Settings come from deploy.env (copy deploy.env.example).

ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE not found. Copy deploy.env.example to deploy.env and fill it in."
  exit 1
fi
set -a
source "$ENV_FILE"
set +a
for key in GCP_PROJECT_ID GCP_REGION GCP_ZONE PROXY_VM_NAME PROXY_NETWORK_TAG PROXY_FIREWALL_RULE PROXY_STATIC_IP_NAME; do
  if [ -z "${!key:-}" ]; then
    echo "❌ $key is not set in deploy.env."
    exit 1
  fi
done

echo "=========================================================="
echo "🚀 Provisioning GCP Free-Tier Static IP Proxy for Bimgus"
echo "=========================================================="

# 1. Firewall rule: 443 for HTTPS, 80 for Caddy's certificate (ACME) challenge
gcloud compute firewall-rules create "$PROXY_FIREWALL_RULE" \
  --project="$GCP_PROJECT_ID" \
  --allow=tcp:80,tcp:443 \
  --target-tags="$PROXY_NETWORK_TAG" 2>/dev/null || true

# 2. Create the VM. Node, Caddy and the proxy are installed by proxy/apply-to-gce.sh.
gcloud compute instances create "$PROXY_VM_NAME" \
  --project="$GCP_PROJECT_ID" \
  --zone="$GCP_ZONE" \
  --machine-type=e2-micro \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=10GB \
  --boot-disk-type=pd-standard \
  --tags="$PROXY_NETWORK_TAG"

# 3. Promote the VM's IP to a static one and print it
VM_IP=$(gcloud compute instances describe "$PROXY_VM_NAME" --zone="$GCP_ZONE" --project="$GCP_PROJECT_ID" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
gcloud compute addresses create "$PROXY_STATIC_IP_NAME" --addresses="$VM_IP" --region="$GCP_REGION" --project="$GCP_PROJECT_ID" 2>/dev/null || true

echo ""
echo "=========================================================="
echo "🎉 SUCCESS! Your Permanent Static Proxy IP is: $VM_IP"
echo "   Next: set PROXY_HOSTNAME in deploy.env (e.g. ${VM_IP//./-}.sslip.io),"
echo "   then run ./proxy/apply-to-gce.sh"
echo "=========================================================="
