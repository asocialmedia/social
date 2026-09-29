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

describe("resolvePrismaSync should-run", () => {
  const PR_NUMBER = 7;

  const context = {
    issue: { number: PR_NUMBER },
    repo: { owner: "asocialmedia", repo: "social" },
  };

  async function resolve(options: { files: string[]; hasAppChanges: string }) {
    const outputs: Record<string, string> = {};
    const core = {
      info: () => {},
      setOutput: (name: string, value: string) => {
        outputs[name] = value;
      },
      warning: () => {},
    };
    // selectChangedFiles paginates pulls.listFiles, so the mock has to supply a
    // paginate that resolves to the file list.
    const github = {
      paginate: () => options.files.map((filename) => ({ filename })),
      rest: { pulls: { listFiles: () => ({ data: [] }) } },
    };
    await resolvePrismaSync({
      context,
      core,
      github,
      hasAppChanges: options.hasAppChanges,
      prNumber: PR_NUMBER,
    });
    return outputs["should-run"];
  }

  const appsOnlyFiles = [
    "apps/web/src/app/page.tsx",
    "apps/web/src/lib/messages/server.ts",
  ];

  test("runs when a Prisma file changed", async () => {
    expect(
      await resolve({
        files: ["packages/db/prisma/contract.prisma"],
        hasAppChanges: "false",
      })
    ).toBe("true");
  });

  test("runs for an apps-only merge so a stale schema cannot ship", async () => {
    expect(await resolve({ files: appsOnlyFiles, hasAppChanges: "true" })).toBe(
      "true"
    );
  });

  test("skips only when nothing deploys and no Prisma file changed", async () => {
    expect(
      await resolve({ files: appsOnlyFiles, hasAppChanges: "false" })
    ).toBe("false");
  });

  test("runs when has-app-changes is absent, as on an older caller", async () => {
    expect(await resolve({ files: appsOnlyFiles, hasAppChanges: "" })).toBe(
      "false"
    );
  });
});
