#!/usr/bin/env bash
# Shared Dokploy HTTP helpers.
#
# Sourced by the CI scripts that talk to Dokploy. Keeps the API token off
# cleartext transports: the base URL is normalised to HTTPS (including a
# scheme-less host, which curl would otherwise treat as http://) and curl is
# pinned to HTTPS for both the request and any redirect, so the x-api-key header
# can never be sent over http:// or downgraded mid-flight.
#
# Source with:  . "$(dirname "${BASH_SOURCE[0]}")/dokploy-api.sh"

# Normalises DOKPLOY_API_URL into the base that "/api/<endpoint>" is appended to.
#
# Two normalisations, both idempotent:
#   1. Enforce https. A scheme-less host is treated as https (curl would
#      otherwise assume http://), and any scheme is rewritten. Matching on the
#      "://" delimiter rather than a literal "https://" keeps this correct for
#      upper/mixed-case schemes, which RFC 3986 permits ("HTTPS://host").
#   2. Drop a trailing "/api", since Dokploy serves the API under /api. A
#      DOKPLOY_API_URL that already includes it is a natural mistake and would
#      otherwise produce /api/api/application.deploy and 404.
#
# A path prefix is preserved: "https://host/dokploy/api" -> "https://host/dokploy".
dokploy_base_url() {
  local url="${1%/}"
  if [ -z "${url}" ]; then
    printf '%s' ""
    return
  fi

  if [ "${url%%://*}" = "${url}" ]; then
    url="https://${url}"
  else
    url="https://${url#*://}"
  fi

  printf '%s' "${url%/api}"
}

# curl pinned to HTTPS for the request and every redirect. Callers deliberately
# do not pass -L: following a redirect would forward x-api-key to whatever host
# the endpoint names, and a 301/302 would also turn the deploy POST into a GET.
dokploy_curl() {
  curl --proto '=https' --proto-redir '=https' "$@"
}

dokploy_api_request() {
  local response_file http_status transport_status
  response_file=$(mktemp) || return 1
  transport_status=0
  http_status=$(dokploy_curl --silent --show-error \
    --connect-timeout 10 --max-time 60 \
    --output "${response_file}" --write-out '%{http_code}' "$@") || transport_status=$?

  if [ "${transport_status}" -ne 0 ]; then
    rm -f "${response_file}"
    echo "Dokploy API request failed before receiving a successful response (curl exit ${transport_status})." >&2
    return 1
  fi

  case "${http_status}" in
    2??)
      cat "${response_file}"
      rm -f "${response_file}"
      ;;
    401)
      rm -f "${response_file}"
      echo "Dokploy authentication failed (HTTP 401). Refresh the DOKPLOY_API_TOKEN Actions secret using an API key from the same instance configured by DOKPLOY_API_URL." >&2
      return 77
      ;;
    403)
      rm -f "${response_file}"
      echo "Dokploy authorization failed (HTTP 403). Check that DOKPLOY_API_TOKEN has access to the target application and organization." >&2
      return 77
      ;;
    3??)
      rm -f "${response_file}"
      echo "Dokploy API returned a redirect (HTTP ${http_status}). Set DOKPLOY_API_URL to the final HTTPS API instance; credentials were not forwarded." >&2
      return 1
      ;;
    *)
      rm -f "${response_file}"
      echo "Dokploy API request failed (HTTP ${http_status})." >&2
      return 1
      ;;
  esac
}
