#!/usr/bin/env bash
# Triggers the Prisma sync container on Dokploy and waits for that specific
# deployment to finish.
#
# The pre-trigger deployment id is captured first so the wait loop cannot match
# the previous run's record and report success before the new one starts.
# Requires: DOKPLOY_API_URL, DOKPLOY_API_TOKEN, DOKPLOY_PRISMA_APP_ID
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./dokploy-api.sh
. "${SCRIPT_DIR}/dokploy-api.sh"

if [ -z "${DOKPLOY_API_URL:-}" ] || [ -z "${DOKPLOY_API_TOKEN:-}" ] || [ -z "${DOKPLOY_PRISMA_APP_ID:-}" ]; then
  echo "Missing Dokploy configuration. Set DOKPLOY_API_URL, DOKPLOY_API_TOKEN and DOKPLOY_PRISMA_APP_ID secrets."
  exit 1
fi

API_URL="$(dokploy_base_url "${DOKPLOY_API_URL}")"
APP_ID="${DOKPLOY_PRISMA_APP_ID}"

# The baseline must be read reliably: an empty value means "no deployment yet",
# so mistaking a failed request for an empty list would let the wait loop below
# match a stale deployment and report success before the new run starts.
if ! BASELINE_RESPONSE=$(dokploy_curl -sS \
  --retry 3 \
  --retry-delay 3 \
  --retry-connrefused \
  "${API_URL}/api/deployment.all?applicationId=${APP_ID}" \
  -H 'accept: application/json' \
  -H "x-api-key: ${DOKPLOY_API_TOKEN}"); then
  echo "Failed to fetch the current deployment list from Dokploy." >&2
  exit 1
fi

if ! printf '%s' "${BASELINE_RESPONSE}" | jq -e 'type == "array"' >/dev/null 2>&1; then
  echo "Dokploy deployment.all did not return a JSON array; refusing to continue." >&2
  printf '%s\n' "${BASELINE_RESPONSE}" | head -c 300 >&2
  echo "" >&2
  exit 1
fi

BASELINE=$(printf '%s' "${BASELINE_RESPONSE}" | jq -r 'if length > 0 then .[0].deploymentId else "" end')
echo "Baseline deployment (pre-trigger): ${BASELINE:-none}"

dokploy_curl -X 'POST' \
  --retry 3 \
  --retry-delay 5 \
  --retry-connrefused \
  "${API_URL}/api/application.deploy" \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -H "x-api-key: ${DOKPLOY_API_TOKEN}" \
  -d "{\"applicationId\":\"${APP_ID}\"}" \
  --fail --silent --show-error

echo "Prisma sync container triggered for application ${APP_ID}."

fetch_deployments() {
  dokploy_curl -sS \
    --retry 2 \
    --retry-delay 3 \
    --retry-connrefused \
    "${API_URL}/api/deployment.all?applicationId=${APP_ID}" \
    -H 'accept: application/json' \
    -H "x-api-key: ${DOKPLOY_API_TOKEN}" \
    || true
}

fetch_logs() {
  dokploy_curl -sS \
    --retry 2 \
    --retry-delay 3 \
    --retry-connrefused \
    "${API_URL}/api/deployment.readLogs?deploymentId=${1}&tail=300" \
    -H 'accept: application/json' \
    -H "x-api-key: ${DOKPLOY_API_TOKEN}" \
    || true
}

RETRIES=45
CONSECUTIVE_ERRORS=0
MAX_CONSECUTIVE_ERRORS=6
for i in $(seq 1 "${RETRIES}"); do
  RESPONSE=$(fetch_deployments)
  if ! printf '%s' "$RESPONSE" | jq -e 'type == "array"' >/dev/null 2>&1; then
    CONSECUTIVE_ERRORS=$((CONSECUTIVE_ERRORS + 1))
    echo "Attempt ${i}/${RETRIES}: deployment.all did not return an array (${CONSECUTIVE_ERRORS}/${MAX_CONSECUTIVE_ERRORS} consecutive transient errors). Response snippet:"
    printf '%s\n' "$RESPONSE" | head -c 300
    echo ""
    if [ "$CONSECUTIVE_ERRORS" -ge "$MAX_CONSECUTIVE_ERRORS" ]; then
      echo "Exceeded maximum consecutive API errors from Dokploy endpoint. Exiting."
      exit 1
    fi
    sleep 10
    continue
  fi
  CONSECUTIVE_ERRORS=0

  DEPLOYMENT=$(printf '%s' "$RESPONSE" | jq -r 'if length > 0 then .[0] else empty end' 2>/dev/null || true)
  DEPLOYMENT_ID=$(printf '%s' "$DEPLOYMENT" | jq -r '.deploymentId // empty' 2>/dev/null || true)
  STATUS=$(printf '%s' "$DEPLOYMENT" | jq -r '.status // empty' 2>/dev/null || true)

  if [ -z "$DEPLOYMENT_ID" ]; then
    echo "Attempt ${i}/${RETRIES}: no deployment record yet, waiting..."
    sleep 10
    continue
  fi

  if [ "$DEPLOYMENT_ID" = "$BASELINE" ]; then
    echo "Attempt ${i}/${RETRIES}: still on previous deployment (${DEPLOYMENT_ID}, ${STATUS}), waiting for new one..."
    sleep 10
    continue
  fi

  echo "Attempt ${i}/${RETRIES}: deployment ${DEPLOYMENT_ID} status: ${STATUS}"

  case "$STATUS" in
    done)
      echo "Prisma sync deployment ${DEPLOYMENT_ID} completed successfully."
      printf '%s\n' "$(fetch_logs "$DEPLOYMENT_ID")" | tail -n 50
      exit 0
      ;;
    error|failed|cancelled)
      echo "Prisma sync deployment ${DEPLOYMENT_ID} ended with status: ${STATUS}"
      printf '%s\n' "$(fetch_logs "$DEPLOYMENT_ID")" | tail -n 50
      exit 1
      ;;
    *)
      sleep 10
      continue
      ;;
  esac
done

echo "Timed out waiting for Prisma sync deployment to finish."
exit 1
