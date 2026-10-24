#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${SCRIPT_DIR}/dokploy-api.sh"

if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--check" ]; }; then
  echo "Usage: deploy-protocols-region.sh [--check]" >&2
  exit 2
fi

for variable in DOKPLOY_API_URL DOKPLOY_API_TOKEN DOKPLOY_APP_ID; do
  if [ -z "${!variable:-}" ]; then
    echo "Protocols deployment requires ${variable}; refusing to silently skip the region." >&2
    exit 1
  fi
done

API_URL="$(dokploy_base_url "${DOKPLOY_API_URL}")"
APPLICATION=$(dokploy_api_request --get "${API_URL}/api/application.one" \
  --data-urlencode "applicationId=${DOKPLOY_APP_ID}" \
  -H "x-api-key: ${DOKPLOY_API_TOKEN}")

if ! jq -e --arg id "${DOKPLOY_APP_ID}" \
  '.applicationId == $id and .sourceType == "docker" and .dockerImage == "ghcr.io/asocialmedia/asm-protocols:latest"' \
  <<<"${APPLICATION}" >/dev/null; then
  echo "Protocols target must be the configured application pulling ghcr.io/asocialmedia/asm-protocols:latest." >&2
  exit 1
fi

if [ "${1:-}" = "--check" ]; then
  echo "Protocols deployment credentials and image target verified; no deployment triggered."
  exit 0
fi

bash "${SCRIPT_DIR}/dokploy-deploy.sh"
