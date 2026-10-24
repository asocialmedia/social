FROM oven/bun:1.4-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libgomp1 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV ONNXRUNTIME_NODE_INSTALL=skip
COPY package.json ./
COPY runtime.bun.lock ./bun.lock
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY src ./src
COPY scripts ./scripts
RUN bun run scripts/download-model.ts
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.title="ASM SwiftFormer XS classifier" \
      org.opencontainers.image.description="Authenticated CPU media safety classification" \
      org.opencontainers.image.source="https://github.com/asocialmedia/social" \
      org.opencontainers.image.revision=$SOURCE_REVISION \
      io.asm.model.revision="54f4560bd9c5ee92d45dc30418a8f8680e80de6d"
USER bun
EXPOSE 3014
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 CMD bun -e 'const port = process.env.PORT ?? "3014"; process.exit((await fetch("http://127.0.0.1:" + port + "/ready")).ok ? 0 : 1)'
CMD ["bun", "--no-env-file", "run", "src/server.ts"]
