# syntax=docker/dockerfile:1

FROM oven/bun:slim AS builder
LABEL org.opencontainers.image.title="Asocialmedia Auth Service" \
      org.opencontainers.image.description="Authentication service for Asocialmedia" \
      org.opencontainers.image.vendor="Asocialmedia"
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/auth/package.json ./apps/auth/
RUN --mount=type=cache,target=/root/.bun \
    bun install
COPY apps/auth/ ./apps/auth/
WORKDIR /app/apps/auth
RUN --mount=type=cache,target=/root/.bun \
    bun run build

FROM oven/bun:slim AS deps
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/auth/package.json ./apps/auth/
RUN --mount=type=cache,target=/root/.bun \
    bun install
RUN cd packages/db && bunx prisma generate

FROM oven/bun:alpine AS runtime
RUN apk add --no-cache \
    openssl \
    curl \
    && addgroup -g 1001 -S nodejs \
    && adduser -S nextjs -u 1001
WORKDIR /app
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nextjs:nodejs /app/packages ./packages
COPY --from=builder --chown=nextjs:nodejs /app/apps/auth ./apps/auth
WORKDIR /app/apps/auth
USER nextjs
EXPOSE 3001
ENV PORT=3001
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/api/trpc/securityHealth || exit 1
CMD ["/app/apps/auth/node_modules/.bin/next", "start"]
