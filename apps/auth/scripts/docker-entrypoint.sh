#!/bin/sh
# Runs the auth HTTP server and the background worker together in one
# container. The server owns the process lifecycle (it stays in the
# foreground so Docker's healthcheck and signal handling keep working); the
# worker runs as a child and is stopped first on shutdown so it can finish
# acking any in-flight stream batch before the container exits.
set -eu

echo "Starting asm-worker in background..."
./asm-worker &
worker_pid=$!

shutdown() {
  echo "Stopping asm-worker (pid ${worker_pid})..."
  kill -TERM "${worker_pid}" 2>/dev/null || true
  wait "${worker_pid}" 2>/dev/null || true
  exit 0
}
trap shutdown INT TERM

echo "Starting auth-server..."
./auth-server
status=$?

echo "auth-server exited (status ${status}); stopping asm-worker..."
kill -TERM "${worker_pid}" 2>/dev/null || true
wait "${worker_pid}" 2>/dev/null || true
exit "${status}"
