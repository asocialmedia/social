# syntax=docker/dockerfile:1

FROM oven/bun:1.3 AS build
LABEL org.opencontainers.image.title="Asocialmedia Auth Service" \
      org.opencontainers.image.description="Authentication service for Asocialmedia" \
      org.opencontainers.image.vendor="Asocialmedia"
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/auth/ ./apps/auth/
RUN bun install --frozen-lockfile
RUN cd packages/db && bunx prisma generate
WORKDIR /app/apps/auth
RUN bun run build

FROM alpine:3.20 AS runtime
RUN apk add --no-cache \
    curl \
    libgcc \
    libstdc++ \
    && addgroup -g 1001 -S auth \
    && adduser -S auth -u 1001 -G auth
WORKDIR /app
COPY --from=build --chown=auth:auth /app/apps/auth/dist/auth-server ./auth-server
USER auth
EXPOSE 3001
ENV PORT=3001
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/api/trpc/securityHealth || exit 1
CMD ["./auth-server"]
