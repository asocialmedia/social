FROM oven/bun:1.3.12
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY docker/prisma-package.json ./package.json
RUN bun install
COPY packages/db/prisma ./packages/db/prisma
COPY packages/db/prisma.config.ts ./packages/db/prisma.config.ts
COPY packages/db/src ./packages/db/src
COPY packages/db/keys.ts ./packages/db/keys.ts
COPY docker/prisma-bootstrap.sh /usr/local/bin/prisma-bootstrap.sh
COPY docker/prisma-studio.sh /usr/local/bin/prisma-studio.sh
RUN chmod +x /usr/local/bin/prisma-bootstrap.sh
RUN chmod +x /usr/local/bin/prisma-studio.sh
CMD ["sleep", "infinity"]
