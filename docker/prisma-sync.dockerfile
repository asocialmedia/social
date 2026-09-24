# syntax=docker/dockerfile:1

FROM oven/bun:1.4 AS build
WORKDIR /app

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
COPY packages/notifications/package.json ./packages/notifications/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN bun install --ignore-scripts

COPY scripts ./scripts
COPY packages ./packages
RUN cd packages/db && bunx prisma contract emit

RUN bun build scripts/sync-trending-scores.ts \
      --target=bun \
      --outfile /app/dist/sync-scores.js \
      --external msgpackr-extract

FROM oven/bun:1.4
LABEL org.opencontainers.image.title="Asocialmedia Prisma Schema Sync" \
      org.opencontainers.image.description="Prisma 8 migration service for the PostgreSQL database" \
      org.opencontainers.image.vendor="Asocialmedia"
WORKDIR /app

COPY docker/prisma-package.json ./package.json
RUN bun install

COPY packages/db/prisma ./packages/db/prisma
COPY packages/db/generated/prisma ./packages/db/generated/prisma
COPY packages/db/prisma.config.ts ./packages/db/prisma.config.ts
COPY --from=build /app/dist/sync-scores.js /app/sync-scores.js
COPY docker/prisma-sync.sh /usr/local/bin/prisma-sync.sh
RUN chmod +x /usr/local/bin/prisma-sync.sh

ENTRYPOINT ["/usr/local/bin/prisma-sync.sh"]
