#!/usr/bin/env bash
# Emits the root version metadata for the Prisma sync image, as step outputs.
#
# Requires: GITHUB_OUTPUT
set -euo pipefail

output="${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
root_version="$(jq -r '.version' "package.json")"

{
  echo "root_version=${root_version}"
  echo "tag_name=prisma-sync-v${root_version}"
  echo "sha_short=$(git rev-parse --short HEAD)"
} >>"${output}"
