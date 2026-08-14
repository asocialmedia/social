# syntax=docker/dockerfile:1

FROM node:24-slim AS build
LABEL org.opencontainers.image.title="Asocialmedia Web App" \
      org.opencontainers.image.description="Main web application for Asocialmedia" \
      org.opencontainers.image.vendor="Asocialmedia"
ARG NEXT_PUBLIC_URL
ARG NEXT_PUBLIC_AUTH_URL
RUN test -n "$NEXT_PUBLIC_URL" || (echo "NEXT_PUBLIC_URL build-arg is required" && exit 1)
RUN test -n "$NEXT_PUBLIC_AUTH_URL" || (echo "NEXT_PUBLIC_AUTH_URL build-arg is required" && exit 1)
ENV NEXT_PUBLIC_URL=${NEXT_PUBLIC_URL}
ENV NEXT_PUBLIC_AUTH_URL=${NEXT_PUBLIC_AUTH_URL}
# Build in production mode so Next.js inlines process.env.NODE_ENV=production.
# Setting it only in the runtime stage is too late for a production build.
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y openssl curl unzip && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
RUN bun install
RUN cd packages/db && bunx prisma generate
RUN node /app/apps/web/node_modules/next/dist/bin/next build apps/web

FROM node:24-alpine AS runtime
RUN apk add --no-cache \
    openssl \
    curl \
    ffmpeg \
    && addgroup -g 1001 -S nodejs \
    && adduser -S nextjs -u 1001
WORKDIR /app
COPY --from=build --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/packages ./packages
COPY --from=build --chown=nextjs:nodejs /app/apps/web ./apps/web
WORKDIR /app/apps/web
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1
CMD ["node", "/app/apps/web/node_modules/next/dist/bin/next", "start"]
