# syntax=docker/dockerfile:1

FROM oven/bun:slim AS builder
LABEL org.opencontainers.image.title="Asocialmedia Docs" \
      org.opencontainers.image.description="Documentation site for Asocialmedia" \
      org.opencontainers.image.vendor="Asocialmedia"
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/docs/package.json ./apps/docs/
RUN --mount=type=cache,target=/root/.bun \
    bun install
COPY apps/docs/ ./apps/docs/
WORKDIR /app/apps/docs
RUN --mount=type=cache,target=/root/.bun \
    bun run build

FROM oven/bun:slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/docs/package.json ./apps/docs/
RUN --mount=type=cache,target=/root/.bun \
    bun install --no-cache

FROM oven/bun:alpine AS runtime
RUN apk add --no-cache \
    curl \
    && addgroup -g 1001 -S nodejs \
    && adduser -S nextjs -u 1001
WORKDIR /app
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nextjs:nodejs /app/packages ./packages
COPY --from=builder --chown=nextjs:nodejs /app/apps/docs ./apps/docs
WORKDIR /app/apps/docs
USER nextjs
EXPOSE 3002
ENV PORT=3002
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3002 || exit 1
CMD ["/app/apps/docs/node_modules/.bin/next", "start"]
