# syntax=docker/dockerfile:1

FROM oven/bun:slim AS builder
LABEL org.opencontainers.image.title="Asocialmedia Web App" \
      org.opencontainers.image.description="Main web application for Asocialmedia" \
      org.opencontainers.image.vendor="Asocialmedia"
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/web/package.json ./apps/web/
RUN --mount=type=cache,target=/root/.bun \
    bun install
COPY apps/web/ ./apps/web/
WORKDIR /app/apps/web
RUN --mount=type=cache,target=/root/.bun \
    bun run build

FROM oven/bun:slim AS deps
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
COPY package.json ./package.json
COPY packages/ ./packages/
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,target=/root/.bun \
    bun install --no-cache
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
COPY --from=builder --chown=nextjs:nodejs /app/apps/web ./apps/web
WORKDIR /app/apps/web
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1
CMD ["/app/apps/web/node_modules/.bin/next", "start"]
