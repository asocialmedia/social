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
    const mediaProcessingDockerfile = await Bun.file(
      path.join(repositoryRoot, "apps/media-processing/Dockerfile")
    ).text();
    const webDockerfile = await Bun.file(
      path.join(repositoryRoot, "apps/web/Dockerfile")
    ).text();

    expect(mediaProcessingDockerfile).toContain(
      "RUN cd packages/db && bunx prisma contract emit"
    );
    expect(webDockerfile).toContain(
      "RUN cd packages/db && bunx prisma contract emit"
    );
    expect(mediaProcessingDockerfile).not.toContain("prisma generate");
    expect(webDockerfile).not.toContain("prisma generate");
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
