import { describe, expect, test } from "bun:test";
import path from "node:path";

const repositoryRoot = path.join(import.meta.dirname, "../..");

describe("Prisma sync deployment artifact", () => {
  test("copies generated Prisma output from the build stage and builds the relocated score script", async () => {
    const dockerfile = await Bun.file(
      path.join(repositoryRoot, "docker/prisma-sync.dockerfile")
    ).text();

    expect(dockerfile).toContain(
      "COPY --from=build /app/packages/db/generated/prisma ./packages/db/generated/prisma"
    );
    expect(dockerfile).toContain(
      "bun build scripts/maintenance/sync-trending-scores.ts"
    );
    expect(dockerfile).not.toContain("scripts/sync-trending-scores.ts");
  });

  test("uses Prisma 8 contract emission in application Docker builds", async () => {
    const authDockerfile = await Bun.file(
      path.join(repositoryRoot, "apps/auth/Dockerfile")
    ).text();
    const mediaProcessingDockerfile = await Bun.file(
      path.join(repositoryRoot, "apps/media-processing/Dockerfile")
    ).text();
    const webDockerfile = await Bun.file(
      path.join(repositoryRoot, "apps/web/Dockerfile")
    ).text();

    expect(authDockerfile).toContain(
      "RUN cd packages/db && bunx prisma contract emit"
    );
    expect(mediaProcessingDockerfile).toContain(
      "RUN cd packages/db && bunx prisma contract emit"
    );
    expect(webDockerfile).toContain(
      "RUN cd packages/db && bunx prisma contract emit"
    );
    expect(authDockerfile).not.toContain("prisma generate");
    expect(mediaProcessingDockerfile).not.toContain("prisma generate");
    expect(webDockerfile).not.toContain("prisma generate");
  });

  test("keeps auth as the default image and provides an isolated search worker target", async () => {
    const authDockerfile = await Bun.file(
      path.join(repositoryRoot, "apps/auth/Dockerfile")
    ).text();
    const stages = [...authDockerfile.matchAll(/^FROM .* AS ([\w-]+)$/gm)];

    expect(stages.at(-1)?.[1]).toBe("runtime");
    expect(authDockerfile).toContain(
      "FROM runtime-base AS message-search-worker"
    );
    expect(authDockerfile).toContain("ENV MESSAGE_SEARCH_WORKER_ONLY=1");
    expect(authDockerfile).toContain('CMD ["./asm-worker"]');
    expect(authDockerfile).toContain('CMD ["./docker-entrypoint.sh"]');
    const runtimeBase = authDockerfile.split(
      "FROM alpine:3.20 AS runtime-base"
    )[1];
    expect(
      runtimeBase?.split("FROM runtime-base AS message-search-worker")[0]
    ).toContain("ENV NODE_ENV=production");
  });

  test("runs the score synchronization after verification and before the success marker", async () => {
    const entrypoint = await Bun.file(
      path.join(repositoryRoot, "docker/prisma-sync.sh")
    ).text();
    const verifyIndex = entrypoint.indexOf("bunx prisma db verify");
    const syncIndex = entrypoint.indexOf("bun /app/sync-scores.js");
    const successIndex = entrypoint.indexOf("PRISMA_SYNC_OK");

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(syncIndex).toBeGreaterThan(verifyIndex);
    expect(successIndex).toBeGreaterThan(syncIndex);
  });
});
