import { describe, expect, test } from "bun:test";

import resolvePrismaSync from "./resolve-prisma-sync.cjs";

const { isPrismaSyncFile } = resolvePrismaSync as typeof resolvePrismaSync & {
  isPrismaSyncFile: (file: string) => boolean;
};

describe("resolve-prisma-sync", () => {
  test("matches Prisma artifacts and deployment helpers", () => {
    expect(isPrismaSyncFile("packages/db/prisma/contract.prisma")).toBe(true);
    expect(
      isPrismaSyncFile("packages/db/prisma/migrations/app/migration.json")
    ).toBe(true);
    expect(isPrismaSyncFile("docker/prisma-sync.sh")).toBe(true);
    expect(
      isPrismaSyncFile("scripts/maintenance/sync-trending-scores.ts")
    ).toBe(true);
    expect(isPrismaSyncFile("scripts/ci/prisma-sync-deploy.sh")).toBe(true);
  });

  test("ignores unrelated application files", () => {
    expect(isPrismaSyncFile("apps/web/src/app/page.tsx")).toBe(false);
    expect(isPrismaSyncFile("scripts/sync-trending-scores.ts")).toBe(false);
    expect(isPrismaSyncFile("scripts/ci/dokploy-deploy.sh")).toBe(false);
  });
});
