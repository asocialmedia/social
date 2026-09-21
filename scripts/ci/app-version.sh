#!/usr/bin/env bash
# Emits the version metadata the image build consumes, as step outputs.
#
# Usage: app-version.sh <app-name>
# Requires: GITHUB_OUTPUT
set -euo pipefail

app="${1:?usage: app-version.sh <app-name>}"
output="${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

app_version="$(jq -r '.version' "apps/${app}/package.json")"
root_version="$(jq -r '.version' "package.json")"

{
  echo "app_version=${app_version}"
  echo "root_version=${root_version}"
  echo "tag_name=${app}-v${app_version}"
  echo "sha_short=$(git rev-parse --short HEAD)"
} >>"${output}"
