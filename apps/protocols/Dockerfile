FROM oven/bun:1.4 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY apps/ ./apps/
RUN bun install --frozen-lockfile --production --ignore-scripts --filter @asm/protocols-app

FROM oven/bun:1.4-slim AS runtime
WORKDIR /app
LABEL org.opencontainers.image.title="Asocialmedia Protocols" \
      org.opencontainers.image.description="Public protocol reads and bounded live network consumers" \
      org.opencontainers.image.vendor="Asocialmedia"
ENV NODE_ENV=production
ENV PROTOCOLS_HOST=0.0.0.0
ENV PROTOCOLS_PORT=3012
ENV OTEL_SERVICE_NAME=asm-protocols
ENV OPENOBSERVE_LOG_STREAM=asm_protocols_logs
ENV OPENOBSERVE_METRIC_STREAM=asm_protocols_metrics
ENV OPENOBSERVE_TRACE_STREAM=asm_protocols_traces
COPY --from=dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=dependencies --chown=bun:bun /app/packages/protocols ./packages/protocols
COPY --from=dependencies --chown=bun:bun /app/packages/logger ./packages/logger
COPY --from=dependencies --chown=bun:bun /app/packages/config ./packages/config
COPY --from=dependencies --chown=bun:bun /app/apps/protocols ./apps/protocols
WORKDIR /app/apps/protocols
USER bun
EXPOSE 3012
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD bun -e 'const port = process.env.PROTOCOLS_PORT ?? "3012"; const r = await fetch("http://127.0.0.1:" + port + "/health"); process.exit(r.ok ? 0 : 1)'
CMD ["bun", "--no-env-file", "run", "src/index.ts"]
