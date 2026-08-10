#!/usr/bin/env sh
set -eu

echo "Initializing MeiliSearch user search index..."
bun packages/db/scripts/init-meilisearch.ts
echo "MeiliSearch initialization complete!"
