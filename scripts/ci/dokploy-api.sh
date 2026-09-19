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
