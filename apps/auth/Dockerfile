# syntax=docker/dockerfile:1

FROM oven/bun:1.4 AS build
LABEL org.opencontainers.image.title="Asocialmedia Auth Service" \
      org.opencontainers.image.description="Authentication and background worker service for Asocialmedia" \
      org.opencontainers.image.vendor="Asocialmedia"
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/auth/ ./apps/auth/
RUN bun install
RUN cd packages/db && bunx prisma generate
WORKDIR /app/apps/auth

RUN bun run build
RUN bun run build:worker
FROM alpine:3.20 AS runtime
RUN apk add --no-cache \
    curl \
    libgcc \
    libstdc++ \
    && addgroup -g 1001 -S auth \
    && adduser -S auth -u 1001 -G auth
WORKDIR /app
COPY --from=build --chown=auth:auth /app/apps/auth/dist/auth-server ./auth-server
COPY --from=build --chown=auth:auth /app/apps/auth/dist/asm-worker ./asm-worker
COPY --from=build --chown=auth:auth /app/apps/auth/scripts/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
USER auth
EXPOSE 3001
ENV PORT=3001
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/api/health || exit 1
CMD ["./docker-entrypoint.sh"]
