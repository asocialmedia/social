#!/usr/bin/env bash
# Triggers a Dokploy redeploy for one application.
#
# The API URL may be configured without a scheme and is normalised to HTTPS via
# the shared helper, so the API token is never sent in cleartext. Requires the
# DOKPLOY_API_URL, DOKPLOY_API_TOKEN and DOKPLOY_APP_ID env vars; exits 0 without
# deploying when the application id is unset (e.g. the optional worker app).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./dokploy-api.sh
. "${SCRIPT_DIR}/dokploy-api.sh"

if [ -z "${DOKPLOY_API_URL:-}" ] || [ -z "${DOKPLOY_API_TOKEN:-}" ] || [ -z "${DOKPLOY_APP_ID:-}" ]; then
  echo "Dokploy deploy skipped: DOKPLOY_API_URL, DOKPLOY_API_TOKEN and DOKPLOY_APP_ID must all be set."
  exit 0
fi

API_URL="$(dokploy_base_url "${DOKPLOY_API_URL}")"

dokploy_curl -X 'POST' \
  --retry 3 \
  --retry-delay 5 \
  --retry-connrefused \
  "${API_URL}/api/application.deploy" \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -H "x-api-key: ${DOKPLOY_API_TOKEN}" \
  -d "{\"applicationId\":\"${DOKPLOY_APP_ID}\"}" \
  --fail --silent --show-error

echo "Dokploy deploy triggered for application ${DOKPLOY_APP_ID}."
