import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { MediaLimits } from "@asm/media";

// Retention is driven through a mocked ./env (not process.env) so the
// disabled scenario can flip inside this file: bun shares one module
// registry per process across test files, so env evaluated for a sibling
// file would freeze the value here too.
let retentionDays = 30;

mock.module("../env", () => ({
  resolveWorkerMediaLimits: () =>
    ({ originalRetentionDays: retentionDays }) as unknown as MediaLimits,
  workerEnv: {},
}));

type QueryFilter =
  | { field: string; op: string; value: unknown }
  | { filters: QueryFilter[]; kind: "and" }
  | Record<string, unknown>;

function queryField(
  field: string
): Record<string, (value: unknown) => QueryFilter> {
  return new Proxy(
    {},
    {
      get: (_target, property) => (value: unknown) => ({
        field,
        op: String(property),
        value,
      }),
    }
  );
}

function isAndFilter(
  filter: QueryFilter
): filter is { filters: QueryFilter[]; kind: "and" } {
  return "kind" in filter && filter.kind === "and";
}

function isFieldFilter(
  filter: QueryFilter
): filter is { field: string; op: string; value: unknown } {
  return "field" in filter && typeof filter.field === "string";
}

function flattenFilter(filter: QueryFilter): Record<string, unknown> {
  if (isAndFilter(filter)) {
    return Object.assign({}, ...filter.filters.map(flattenFilter));
  }
  if (isFieldFilter(filter)) {
    if (filter.op === "isNull") {
      return { [filter.field]: null };
    }
    if (filter.op === "isNotNull") {
      return { [filter.field]: { not: null } };
    }
    if (filter.op === "lt") {
      return { [filter.field]: { lt: filter.value } };
    }
    if (filter.op === "like") {
      return {
        [filter.field]: {
          startsWith: String(filter.value).replace(/%$/, ""),
        },
      };
    }
    return { [filter.field]: filter.value };
  }
  return filter;
}

function evaluateFilter(filter: unknown): QueryFilter {
  if (typeof filter !== "function") {
    return filter as QueryFilter;
  }
  const fields = new Proxy(
    {},
    { get: (_target, property) => queryField(String(property)) }
  );
  const evaluate = filter as (
    fields: Record<string, Record<string, (value: unknown) => QueryFilter>>
  ) => QueryFilter;
  return evaluate(fields);
}

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

function createQuery() {
  const filters: QueryFilter[] = [];
  let take: number | undefined;
  const query = {
    all: () => {
      if (prismaDisabled) {
        throw new Error("must not query when retention is disabled");
      }
      const where = Object.assign({}, ...filters.map(flattenFilter));
      findManyArgs.push({ take, where });
      return Promise.resolve(sweepRows);
    },
    limit: (value: number) => {
      take = value;
      return query;
    },
    orderBy: () => query,
    select: () => query,
    update: (_data: Record<string, unknown>) => {
      if (prismaDisabled) {
        throw new Error("must not update when retention is disabled");
      }
      const where = Object.assign({}, ...filters.map(flattenFilter));
      updatedIds.push(String(where.id));
      return Promise.resolve({});
    },
    where: (filter: unknown) => {
      filters.push(evaluateFilter(filter));
      return query;
    },
  };
  return query;
}
let sweepRows: {
  id: string;
  originalKey: string | null;
  size: number;
}[] = [];
const deletedKeys: string[] = [];
const updatedIds: string[] = [];
let failDeleteForKey: string | null = null;
// Shared with derived-heal mock via globalThis so whichever mock wins is compatible
(globalThis as unknown as Record<string, unknown>).__qm_failFirstEnqueue ??=
  false;
(globalThis as unknown as Record<string, unknown>).__qm_derivativeCounts ??=
  {} as Record<string, number>;

mock.module("@asm/db", () => ({
  and: (...filters: QueryFilter[]) => ({ filters, kind: "and" }),
  // Unused by this sweep; present so whichever test file evaluates the sweep
  // module first binds a complete enqueue set for the other suites sharing
  // this process-wide mock key.
  enqueueMediaAnalyze: () => Promise.resolve(),
  enqueueMediaProcess: (_mediaId: string) => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (g.__qm_failFirstEnqueue) {
      g.__qm_failFirstEnqueue = false;
      throw new Error("redis unavailable");
    }
    if (g.__qm_prismaDisabled) {
      throw new Error("must not enqueue when the sweep is disabled");
    }
    return Promise.resolve();
  },
  enqueueMediaScan: () => Promise.resolve(),
  prisma: {
    orm: {
      public: {
        PostMedia: {
          select: () => createQuery(),
          where: (filter: unknown) => createQuery().where(filter),
        },
        PostMediaDerivatives: {
          where: (_filter: { mediaId: string }) => ({
            aggregate: () => Promise.resolve({ count: 0 }),
          }),
        },
      },
    },
  },
  toPrismaDateTime: (value: Date) => value,
}));
mock.module("../s3", () => ({
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

const { quarantineGcSweep } = await import("./index");

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
    expect(findManyArgs).toHaveLength(3);
    const [published, failedPost, failedComment] = findManyArgs;
    if (!published || !failedPost || !failedComment) {
      throw new Error("expected all quarantine queries");
    }
    for (const args of findManyArgs) {
      expect(args.take).toBeGreaterThan(0);
      const where = args.where ?? {};
      expect(where.originalKey).toEqual({ startsWith: "quarantine/" });
      expect(where.pipelineVersion).toEqual({ not: null });
    }
    expect(published.where?.publishedKey).toEqual({ not: null });
    expect(failedPost.where?.status).toBe("FAILED");
    expect(failedPost.where?.postId).toEqual({ not: null });
    expect(failedComment.where?.status).toBe("FAILED");
    expect(failedComment.where?.commentId).toEqual({ not: null });
    const publishedWhere = published.where;
    if (!publishedWhere) {
      throw new Error("expected published quarantine filter");
    }
    const { processedAt } = publishedWhere;
    if (
      !processedAt ||
      typeof processedAt !== "object" ||
      !("lt" in processedAt)
    ) {
      throw new Error("expected processed cutoff");
    }
    const cutoff = (processedAt as { lt: Date }).lt.getTime();
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
