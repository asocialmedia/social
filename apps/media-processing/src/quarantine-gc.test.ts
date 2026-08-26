import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { MediaLimits } from "@asm/media";

// Retention is driven through a mocked ./env (not process.env) so the
// disabled scenario can flip inside this file: bun shares one module
// registry per process across test files, so env evaluated for a sibling
// file would freeze the value here too.
let retentionDays = 30;

mock.module("./env", () => ({
  resolveWorkerMediaLimits: () =>
    ({ originalRetentionDays: retentionDays }) as unknown as MediaLimits,
  workerEnv: {},
}));

interface FindManyArgs {
  orderBy?: Record<string, string>;
  select?: Record<string, boolean>;
  take?: number;
  where?: Record<string, unknown>;
}

// Flipped only by the disabled scenario: every storage/prisma touch throws
// so much as a stray query fails the test loudly.
let prismaDisabled = false;
const findManyArgs: FindManyArgs[] = [];
let sweepRows: {
  id: string;
  originalKey: string | null;
  size: number;
}[] = [];
const deletedKeys: string[] = [];
const updatedIds: string[] = [];
let failDeleteForKey: string | null = null;

mock.module("@asm/db", () => ({
  prisma: {
    media: {
      // Sync bodies are fine: the sweeper awaits the returned values, and
      // await resolves plain arrays/objects transparently.
      findMany: (args: FindManyArgs) => {
        if (prismaDisabled) {
          throw new Error("must not query when retention is disabled");
        }
        findManyArgs.push(args);
        return sweepRows;
      },
      update: ({ where }: { where: { id: string } }) => {
        if (prismaDisabled) {
          throw new Error("must not update when retention is disabled");
        }
        updatedIds.push(where.id);
        return {};
      },
    },
  },
}));
mock.module("./s3", () => ({
  getS3: () => ({
    delete: (key: string) => {
      if (prismaDisabled) {
        throw new Error("must not delete when retention is disabled");
      }
      if (failDeleteForKey === key) {
        throw new Error("storage unavailable");
      }
      deletedKeys.push(key);
    },
  }),
}));

const { quarantineGcSweep } = await import("./backfill");

describe("quarantine retention sweep", () => {
  beforeEach(() => {
    retentionDays = 30;
    prismaDisabled = false;
    findManyArgs.length = 0;
    deletedKeys.length = 0;
    updatedIds.length = 0;
    sweepRows = [];
    failDeleteForKey = null;
  });

  test("queries only true quarantine originals of published pipeline rows past the window", async () => {
    await quarantineGcSweep();
    expect(findManyArgs).toHaveLength(1);
    const [args] = findManyArgs;
    if (!args) {
      throw new Error("expected one findMany call");
    }
    expect(args.orderBy).toEqual({ processedAt: "asc" });
    expect(args.take).toBeGreaterThan(0);
    const where = args.where as Record<string, unknown>;
    expect(where.originalKey).toEqual({ startsWith: "quarantine/" });
    expect(where.pipelineVersion).toEqual({ not: null });
    expect(where.publishedKey).toEqual({ not: null });
    // Cutoff is now minus the 30-day window (1s tolerance for clock drift).
    const cutoff = (where.processedAt as { lt: Date }).lt.getTime();
    expect(
      Math.abs(Date.now() - 30 * 24 * 60 * 60 * 1000 - cutoff)
    ).toBeLessThan(1000);
  });

  test("deletes expired originals, clears the pointer, counts reclaimed bytes", async () => {
    sweepRows = [
      { id: "m1", originalKey: "quarantine/m1/toka/original.jpg", size: 1234 },
    ];
    const result = await quarantineGcSweep();
    expect(result).toEqual({ deletedObjects: 1, reclaimedBytes: 1234 });
    expect(deletedKeys).toEqual(["quarantine/m1/toka/original.jpg"]);
    expect(updatedIds).toEqual(["m1"]);
  });

  test("continues past a failed delete instead of stranding the batch", async () => {
    sweepRows = [
      { id: "m1", originalKey: "quarantine/m1/toka/original.jpg", size: 100 },
      { id: "m2", originalKey: "quarantine/m2/tokb/original.png", size: 250 },
    ];
    failDeleteForKey = "quarantine/m1/toka/original.jpg";
    const result = await quarantineGcSweep();
    expect(result).toEqual({ deletedObjects: 1, reclaimedBytes: 250 });
    expect(deletedKeys).toEqual(["quarantine/m2/tokb/original.png"]);
    expect(updatedIds).toEqual(["m2"]);
  });

  test("skips rows whose original pointer is already gone", async () => {
    sweepRows = [{ id: "m1", originalKey: null, size: 100 }];
    const result = await quarantineGcSweep();
    expect(result).toEqual({ deletedObjects: 0, reclaimedBytes: 0 });
    expect(deletedKeys).toEqual([]);
    expect(updatedIds).toEqual([]);
  });

  test("retention 0 is a strict no-op - no queries, no deletes", async () => {
    retentionDays = 0;
    prismaDisabled = true;
    expect(await quarantineGcSweep()).toEqual({
      deletedObjects: 0,
      reclaimedBytes: 0,
    });
  });
});
