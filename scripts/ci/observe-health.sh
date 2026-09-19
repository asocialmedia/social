#!/usr/bin/env bash
# Fire-and-forget health probe.
#
# The edge blocks everything but app traffic, so GitHub runners can never reach
# the public health URL; Dokploy's own container healthcheck gates rollout. This
# probe must therefore never fail the workflow, which is why the calling step
# sets continue-on-error.
#
# Requires: HEALTH_URL, HEALTH_INITIAL_DELAY, HEALTH_RETRIES, HEALTH_RETRY_INTERVAL
set -uo pipefail

health_url="${HEALTH_URL:?HEALTH_URL is required}"
initial_delay="${HEALTH_INITIAL_DELAY:-30}"
retries="${HEALTH_RETRIES:-10}"
retry_interval="${HEALTH_RETRY_INTERVAL:-10}"

echo "Waiting ${initial_delay}s for container to start..."
sleep "${initial_delay}"

echo "Checking health endpoint..."
for i in $(seq 1 "${retries}"); do
  if curl -sfL "${health_url}" >/dev/null; then
    echo "Health check passed!"
    exit 0
  fi

  echo "Attempt ${i}/${retries} failed, retrying in ${retry_interval}s..."
  sleep "${retry_interval}"
done

echo "Health endpoint unreachable from the runner (expected when the edge blocks external traffic). Deployment continues via Dokploy's own healthcheck."
