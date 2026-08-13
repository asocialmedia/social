# syntax=docker/dockerfile:1

FROM oven/bun:1.3 AS build
LABEL org.opencontainers.image.title="Asocialmedia Auth Service" \
      org.opencontainers.image.description="Authentication and background worker service for Asocialmedia" \
      org.opencontainers.image.vendor="Asocialmedia"
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/auth/ ./apps/auth/
RUN bun install
RUN cd packages/db && bunx prisma generate
WORKDIR /app/apps/auth
# Both build scripts externalize msgpackr-extract (an optional native addon of
# bullmq -> msgpackr). Bundling it fails the multi-arch (arm64 via QEMU) build
# because the prebuilt binary is not installed for the emulated target. At
# runtime the require is absent from the image, msgpackr's try/catch falls back
# to its pure-JS codec, and BullMQ's job payloads are small enough that the
# acceleration loss is negligible. Keeping externalization is an intentional
# trade-off; remove it only if the native accelerator is ever packaged per-arch.
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
USER auth
EXPOSE 3001
ENV PORT=3001
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/api/health || exit 1
CMD ["./auth-server"]
