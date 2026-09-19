#!/usr/bin/env bash
# Triggers a Dokploy redeploy for one application.
#
# Dokploy is often configured with a scheme-less host (dokploy.example.com/api),
# so a bare http:// is upgraded to https://. Requires the DOKPLOY_API_URL,
# DOKPLOY_API_TOKEN and DOKPLOY_APP_ID env vars; exits 0 without deploying when
# the application id is unset (e.g. the optional worker app).
set -euo pipefail

if [ -z "${DOKPLOY_API_URL:-}" ] || [ -z "${DOKPLOY_API_TOKEN:-}" ] || [ -z "${DOKPLOY_APP_ID:-}" ]; then
  echo "Dokploy deploy skipped: DOKPLOY_API_URL, DOKPLOY_API_TOKEN and DOKPLOY_APP_ID must all be set."
  exit 0
fi

API_URL="${DOKPLOY_API_URL%/}"
case "${API_URL}" in
  http://*) API_URL="https://${API_URL#http://}" ;;
esac

curl -L -X 'POST' \
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
