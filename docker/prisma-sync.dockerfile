# syntax=docker/dockerfile:1

FROM oven/bun:1.3.12
LABEL org.opencontainers.image.title="Asocialmedia Prisma Schema Sync" \
      org.opencontainers.image.description="One-shot container that syncs the Prisma schema to the internal PostgreSQL database" \
      org.opencontainers.image.vendor="Asocialmedia"
WORKDIR /app

COPY docker/prisma-package.json ./package.json
RUN bun install

COPY packages/db/prisma ./packages/db/prisma
COPY packages/db/prisma.config.ts ./packages/db/prisma.config.ts
COPY packages/db/keys.ts ./packages/db/keys.ts

COPY docker/prisma-sync.sh /usr/local/bin/prisma-sync.sh
RUN chmod +x /usr/local/bin/prisma-sync.sh

ENTRYPOINT ["/usr/local/bin/prisma-sync.sh"]
