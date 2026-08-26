# syntax=docker/dockerfile:1

FROM oven/bun:1.4 AS build
LABEL org.opencontainers.image.title="Asocialmedia Media Processing" \
      org.opencontainers.image.description="Media pipeline worker: scan, validate, transcode, publish" \
      org.opencontainers.image.vendor="Asocialmedia"
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/media-processing/ ./apps/media-processing/
RUN bun install
RUN cd packages/db && bunx prisma generate

FROM debian:13-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        libgomp1 \
        libstdc++6 \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1001 media \
    && useradd -m -u 1001 -g media media
WORKDIR /app
COPY --from=build /usr/local/bin/bun /usr/local/bin/bun
COPY --from=build --chown=media:media /app/node_modules ./node_modules
COPY --from=build --chown=media:media /app/packages ./packages
COPY --from=build --chown=media:media /app/apps/media-processing ./apps/media-processing
WORKDIR /app/apps/media-processing
USER media
ENV NODE_ENV=production
# Explicit here because t3-env skipValidation (NODE_ENV=production) does not
# apply zod defaults - without this the OCR stage would silently read as
# disabled. Override with MEDIA_OCR_ENABLED=0 at deploy to turn it off.
ENV MEDIA_OCR_ENABLED=1
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3010/health || exit 1
EXPOSE 3010
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "run", "src/index.ts"]
