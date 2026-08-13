#!/usr/bin/env bash
# Resolves the bun --compile target for the current build architecture.
# CI builds the image for linux/amd64 AND linux/arm64 (via Docker buildx +
# QEMU). Inside the build stage, `uname -m` reflects the TARGET platform, so we
# must not hardcode x64 -- otherwise the arm64 image ships an x86_64 binary and
# fails with "exec format error" on ARM hosts.
set -euo pipefail

arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64)
    echo "bun-linux-x64-musl"
    ;;
  aarch64 | arm64)
    echo "bun-linux-arm64-musl"
    ;;
  *)
    echo "Unsupported architecture: $arch" >&2
    exit 1
    ;;
esac
