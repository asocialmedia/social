#!/usr/bin/env bash
# Resolves which Dokploy application and health endpoint belong to an app, and
# whether deployment/health observation is actually configured. Emits step
# outputs so the workflow can gate later steps on them.
#
# Usage: resolve-deploy-targets.sh <app-name>
# Requires: GITHUB_OUTPUT and the DOKPLOY_*/WEB_/AUTH_/MEDIA_ env vars.
set -euo pipefail

app="${1:?usage: resolve-deploy-targets.sh <app-name>}"
output="${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

app_id=""
health_url=""

case "${app}" in
  web)
    app_id="${DOKPLOY_WEB_APP_ID:-}"
    health_url="${WEB_HEALTH_URL:-}"
    ;;
  auth)
    app_id="${DOKPLOY_AUTH_APP_ID:-}"
    health_url="${AUTH_HEALTH_URL:-}"
    ;;
  media-processing)
    app_id="${DOKPLOY_MEDIA_APP_ID:-}"
    health_url="${MEDIA_HEALTH_URL:-}"
    ;;
esac

deploy_enabled="false"
if [ -n "${DOKPLOY_API_URL:-}" ] && [ -n "${DOKPLOY_API_TOKEN:-}" ] && [ -n "${app_id}" ]; then
  deploy_enabled="true"
fi

health_enabled="false"
if [ -n "${health_url}" ]; then
  health_enabled="true"
fi

{
  echo "app_id=${app_id}"
  echo "health_url=${health_url}"
  echo "health_initial_delay=30"
  echo "health_retries=10"
  echo "health_retry_interval=10"
  echo "deploy_enabled=${deploy_enabled}"
  echo "health_enabled=${health_enabled}"
} >>"${output}"
