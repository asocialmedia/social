# syntax=docker/dockerfile:1

# Builder: bundles the one-shot trending-score backfill (scripts/
# backfill-trending-scores.ts) into a single self-contained JS file so the
# slim sync image can run it without the workspace or @asm/db resolution.
FROM oven/bun:1.4 AS build
WORKDIR /app

# Workspace manifests first for lockfile-cached installs. postinstall is
# skipped because the prisma schema is not copied yet; the sync entrypoint
# regenerates the client at runtime anyway.
COPY package.json bun.lock ./
COPY apps/auth/package.json ./apps/auth/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/aggregator/package.json ./packages/aggregator/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/logger/package.json ./packages/logger/package.json
COPY packages/media/package.json ./packages/media/package.json
COPY packages/next/package.json ./packages/next/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN bun install --ignore-scripts

# Sources the bundle needs: the backfill imports @asm/db, which pulls in the
# whole db package graph.
COPY scripts ./scripts
COPY packages ./packages
RUN cd packages/db && bunx prisma generate

RUN bun build scripts/backfill-trending-scores.ts \
      --target=bun \
      --outfile /app/dist/backfill.js \
      --tsconfig-override scripts/tsconfig.json \
      --external msgpackr-extract

FROM oven/bun:1.4
LABEL org.opencontainers.image.title="Asocialmedia Prisma Schema Sync" \
      org.opencontainers.image.description="One-shot container that syncs the Prisma schema to the internal PostgreSQL database" \
      org.opencontainers.image.vendor="Asocialmedia"
WORKDIR /app

COPY docker/prisma-package.json ./package.json
RUN bun install

COPY packages/db/prisma ./packages/db/prisma
COPY packages/db/prisma.config.ts ./packages/db/prisma.config.ts
COPY packages/db/keys.ts ./packages/db/keys.ts

COPY --from=build /app/dist/backfill.js /app/backfill.js

COPY docker/prisma-sync.sh /usr/local/bin/prisma-sync.sh
RUN chmod +x /usr/local/bin/prisma-sync.sh

ENTRYPOINT ["/usr/local/bin/prisma-sync.sh"]
