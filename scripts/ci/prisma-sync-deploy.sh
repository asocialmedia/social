#!/usr/bin/env bash
# Triggers the Prisma sync container on Dokploy and waits for that specific
# deployment to finish.
#
# The pre-trigger deployment id is captured first so the wait loop cannot match
# the previous run's record and report success before the new one starts.
# Requires: DOKPLOY_API_URL, DOKPLOY_API_TOKEN, DOKPLOY_PRISMA_APP_ID
set -eu

CHECK_ONLY=false
case "${1:-}" in
  "") ;;
  --check) CHECK_ONLY=true ;;
  *) echo "Usage: $0 [--check]" >&2; exit 2 ;;
esac
if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi

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
if ! BASELINE_RESPONSE=$(dokploy_api_request \
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

# An empty list legitimately means "no deployment yet". A present record with a
# missing, null or non-string deploymentId is malformed: `jq -r` would yield the
# literal string "null", which never equals a real id, so the wait loop below
# would treat the previous deployment as new and could report success before the
# new run starts. Reject that rather than carry a bogus baseline.
RECORD_COUNT=$(printf '%s' "${BASELINE_RESPONSE}" | jq -r 'length')
if [ "${RECORD_COUNT}" -eq 0 ]; then
  BASELINE=""
else
  BASELINE=$(printf '%s' "${BASELINE_RESPONSE}" | jq -r '.[0].deploymentId | if type == "string" then . else "" end')
  if [ -z "${BASELINE}" ]; then
    echo "Dokploy returned a deployment record without a usable deploymentId; refusing to continue." >&2
    printf '%s\n' "${BASELINE_RESPONSE}" | head -c 300 >&2
    echo "" >&2
    exit 1
  fi
fi

echo "Baseline deployment (pre-trigger): ${BASELINE:-none}"

if [ "${CHECK_ONLY}" = true ]; then
  echo "Dokploy authentication and Prisma application access verified; no deployment triggered."
  exit 0
fi

dokploy_api_request -X 'POST' \
  --retry 3 \
  --retry-delay 5 \
  --retry-connrefused \
  "${API_URL}/api/application.deploy" \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -H "x-api-key: ${DOKPLOY_API_TOKEN}" \
  -d "{\"applicationId\":\"${APP_ID}\"}"

echo "Prisma sync container triggered for application ${APP_ID}."

fetch_deployments() {
  dokploy_api_request \
    --retry 2 \
    --retry-delay 3 \
    --retry-connrefused \
    "${API_URL}/api/deployment.all?applicationId=${APP_ID}" \
    -H 'accept: application/json' \
    -H "x-api-key: ${DOKPLOY_API_TOKEN}"
}

fetch_logs() {
  dokploy_api_request \
    --retry 2 \
    --retry-delay 3 \
    --retry-connrefused \
    "${API_URL}/api/deployment.readLogs?deploymentId=${1}&tail=300" \
    -H 'accept: application/json' \
    -H "x-api-key: ${DOKPLOY_API_TOKEN}" \
    || true
}

verify_prisma_task() {
  local application app_name server_id containers container_ids container_id config summaries latest
  if [ -z "${GITHUB_SHA:-}" ]; then
    echo "GITHUB_SHA is required to verify the deployed Prisma task revision." >&2
    return 1
  fi
  application=$(dokploy_api_request "${API_URL}/api/application.one?applicationId=${APP_ID}" -H "x-api-key: ${DOKPLOY_API_TOKEN}") || return 1
  app_name=$(printf '%s' "$application" | jq -er '.appName | select(type == "string" and length > 0)') || return 1
  server_id=$(printf '%s' "$application" | jq -r '.serverId // empty') || return 1
  local server_query=""
  if [ -n "$server_id" ]; then server_query="?serverId=${server_id}"; fi
  containers=$(dokploy_api_request "${API_URL}/api/docker.getContainers${server_query}" -H "x-api-key: ${DOKPLOY_API_TOKEN}") || { local request_status=$?; if [ "$request_status" -eq 77 ]; then return 1; fi; return 2; }
  container_ids=$(printf '%s' "$containers" | jq -er --arg app "$app_name" '[.[] | select(.name | startswith($app + ".")) | .containerId | select(type == "string" and length > 0)] | .[]') || return 2
  summaries="[]"
  for container_id in $container_ids; do
    local config_query="containerId=${container_id}"
    if [ -n "$server_id" ]; then config_query="${config_query}&serverId=${server_id}"; fi
    config=$(dokploy_api_request "${API_URL}/api/docker.getConfig?${config_query}" -H "x-api-key: ${DOKPLOY_API_TOKEN}") || { local request_status=$?; if [ "$request_status" -eq 77 ]; then return 1; fi; return 2; }
    config=$(printf '%s' "$config" | jq -ec 'if type == "string" then fromjson else . end | {created:.Created,state:.State,revision:.Config.Labels["org.opencontainers.image.revision"]}') || return 1
    summaries=$(printf '%s' "$summaries" | jq -c --argjson config "$config" '. + [$config]') || return 1
  done
  latest=$(printf '%s' "$summaries" | jq -c --arg revision "$GITHUB_SHA" '[.[] | select(.revision == $revision)] | sort_by(.created) | last') || return 1
  if [ "$latest" = "null" ]; then return 2; fi
  if printf '%s' "$latest" | jq -e '.state.Status == "exited" and .state.ExitCode == 0 and .state.OOMKilled == false' >/dev/null; then
    echo "Prisma task for revision ${GITHUB_SHA} exited successfully."
    return 0
  fi
  if printf '%s' "$latest" | jq -e '.state.Running == true or .state.Status == "created"' >/dev/null; then return 2; fi
  echo "Prisma task did not exit successfully; application deployments remain blocked." >&2
  printf '%s' "$latest" | jq -c '{revision,state:{Status:.state.Status,ExitCode:.state.ExitCode,OOMKilled:.state.OOMKilled}}' >&2
  return 1
}

RETRIES=45
CONSECUTIVE_ERRORS=0
MAX_CONSECUTIVE_ERRORS=6
for i in $(seq 1 "${RETRIES}"); do
  REQUEST_STATUS=0
  RESPONSE=$(fetch_deployments) || REQUEST_STATUS=$?
  if [ "${REQUEST_STATUS}" -eq 77 ]; then
    exit 1
  fi
  if [ "${REQUEST_STATUS}" -ne 0 ] || ! printf '%s' "$RESPONSE" | jq -e 'type == "array"' >/dev/null 2>&1; then
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
      TASK_STATUS=0
      verify_prisma_task || TASK_STATUS=$?
      if [ "$TASK_STATUS" -eq 2 ]; then
        echo "Waiting for the Prisma task for the current revision to finish."
        sleep 10
        continue
      fi
      if [ "$TASK_STATUS" -ne 0 ]; then exit 1; fi
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
