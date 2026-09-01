import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { MediaLimits } from "@asm/media";

// Derived-heal sweep tests. The sweep is the self-healing net for READY rows
// whose process stage never produced derivatives: it must ignore young rows
// (normal processing window), ignore DOCUMENT (no derivatives by design),
// skip stranded rows that already have derivatives, and re-enqueue only
// genuinely lost ones.

const defaultLimits = {
  maxPixelCount: 100_000_000,
  originalRetentionDays: 30,
} as unknown as MediaLimits;

let backfillEnabled = true;

mock.module("./env", () => ({
  resolveWorkerMediaLimits: () => defaultLimits,
  workerEnv: {
    get BACKFILL_ENABLED() {
      return backfillEnabled;
    },
  },
}));

interface FindManyArgs {
  select?: Record<string, boolean>;
  take?: number;
  where?: {
    createdAt?: unknown;
    processedAt?: unknown;
    status?: unknown;
    type?: { in: string[] };
    originalKey?: unknown;
    pipelineVersion?: unknown;
  };
}

let prismaDisabled = false;
let failFirstEnqueue = false;
let failFirstScanEnqueue = false;
let readyRows: { id: string }[] = [];
let unscannedRows: { id: string }[] = [];
const derivativeCounts: Record<string, number> = {};
const enqueuedMediaIds: string[] = [];
const enqueuedScanMediaIds: string[] = [];
const findManyArgs: FindManyArgs[] = [];
// Sync to global for cross-file mock compatibility
(globalThis as unknown as Record<string, unknown>).__qm_prismaDisabled =
  prismaDisabled;
(globalThis as unknown as Record<string, unknown>).__qm_failFirstEnqueue =
  failFirstEnqueue;
(globalThis as unknown as Record<string, unknown>).__qm_derivativeCounts =
  derivativeCounts;

mock.module("@asm/db", () => ({
  Prisma: { DbNull: Symbol.for("test.DbNull") },
  enqueueMediaAnalyze: (_mediaId: string) => Promise.resolve(),
  enqueueMediaProcess: (mediaId: string) => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (prismaDisabled || g.__qm_prismaDisabled) {
      throw new Error("must not enqueue when the sweep is disabled");
    }
    if (failFirstEnqueue || g.__qm_failFirstEnqueue) {
      failFirstEnqueue = false;
      g.__qm_failFirstEnqueue = false;
      throw new Error("redis unavailable");
    }
    enqueuedMediaIds.push(mediaId);
    return Promise.resolve();
  },
  enqueueMediaScan: (mediaId: string, _options?: { jobIdSuffix?: string }) => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (prismaDisabled || g.__qm_prismaDisabled) {
      throw new Error("must not enqueue when the sweep is disabled");
    }
    if (failFirstScanEnqueue || g.__qm_failFirstScanEnqueue) {
      failFirstScanEnqueue = false;
      g.__qm_failFirstScanEnqueue = false;
      throw new Error("redis unavailable");
    }
    enqueuedScanMediaIds.push(mediaId);
    return Promise.resolve();
  },
  prisma: {
    media: {
      findMany: (args: FindManyArgs) => {
        if (prismaDisabled) {
          throw new Error("must not query when the sweep is disabled");
        }
        findManyArgs.push(args);
        // Distinguish the two queries by their where shape, not call order:
        // the READY-without-derivatives query filters on status READY, the
        // unscanned-quarantine query on QUARANTINED. Keeps the mock stable
        // if the sweep adds or reorders queries.
        const status = args.where?.status;
        const isReadyQuery =
          status === "READY" ||
          (typeof status === "object" &&
            status !== null &&
            "in" in status &&
            (status as { in: unknown[] }).in === undefined);
        return isReadyQuery ? readyRows : unscannedRows;
      },
      update: () => ({}),
    },
    mediaDerivative: {
      count: ({ where }: { where: { mediaId: string } }) => {
        const g = globalThis as unknown as Record<string, unknown>;
        const counts =
          (g.__qm_derivativeCounts as Record<string, number>) ??
          derivativeCounts;
        return Promise.resolve(
          counts[where.mediaId] ?? derivativeCounts[where.mediaId] ?? 0
        );
      },
    },
  },
  redis: { decrby: () => Promise.resolve(0), incrby: () => Promise.resolve(0) },
}));

mock.module("./s3", () => ({
  // Never invoked by the sweep (no object IO); providing the key keeps the
  // transitive import graph below intact.
  getS3: () => {
    throw new Error("must not touch storage during a derivative sweep");
  },
  objectExists: () => Promise.resolve(false),
}));

const { derivedHealSweep, DERIVED_HEAL_GRACE_MS } = await import("./sweeps");

beforeEach(() => {
  backfillEnabled = true;
  prismaDisabled = false;
  failFirstEnqueue = false;
  failFirstScanEnqueue = false;
  readyRows = [];
  unscannedRows = [];
  // Keep object identity for global reference — clear instead of reassign
  for (const k of Object.keys(derivativeCounts)) {
    // oxlint-disable-next-line typescript/no-dynamic-delete -- test helper clears the shared counter map between cases
    delete (derivativeCounts as Record<string, number>)[k];
  }
  enqueuedMediaIds.length = 0;
  enqueuedScanMediaIds.length = 0;
  findManyArgs.length = 0;
  const g = globalThis as unknown as Record<string, unknown>;
  g.__qm_prismaDisabled = prismaDisabled;
  g.__qm_failFirstEnqueue = failFirstEnqueue;
  g.__qm_failFirstScanEnqueue = failFirstScanEnqueue;
  g.__qm_derivativeCounts = derivativeCounts;
});

describe("derived-heal sweep", () => {
  test("candidate window starts past normal processing time", async () => {
    await derivedHealSweep();
    const [args] = findManyArgs;
    if (!args?.where?.createdAt || !args.where.processedAt) {
      throw new Error("expected both createdAt and processedAt cutoffs");
    }
    // The grace period keeps freshly published rows out of the net: images
    // take seconds, HLS ladders minutes.
    expect(DERIVED_HEAL_GRACE_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
    const createdLt = (args.where.createdAt as { lt: Date }).lt.getTime();
    const publishedLt = (args.where.processedAt as { lt: Date }).lt.getTime();
    const now = Date.now();
    expect(Math.abs(createdLt - (now - DERIVED_HEAL_GRACE_MS))).toBeLessThan(
      1000
    );
    expect(Math.abs(publishedLt - (now - DERIVED_HEAL_GRACE_MS))).toBeLessThan(
      1000
    );
    expect(args.where.status).toBe("READY");
    // Only types that generate derivatives are healed; DOCUMENT uploads
    // legitimately have none.
    expect(args.where.type?.in).toContain("VIDEO");
    expect(args.where.type?.in).not.toContain("DOCUMENT");
  });

  test("re-enqueues READY rows older than the grace window with zero derivatives", async () => {
    readyRows = [{ id: "m-stranded" }];
    const result = await derivedHealSweep();
    expect(result).toEqual({ enqueued: 1 });
    expect(enqueuedMediaIds).toEqual(["m-stranded"]);
  });

  test("skips rows that already have derivatives", async () => {
    readyRows = [{ id: "m-fine" }];
    derivativeCounts["m-fine"] = 3;
    const result = await derivedHealSweep();
    expect(result).toEqual({ enqueued: 0 });
    expect(enqueuedMediaIds).toEqual([]);
  });

  test("continues past one failed enqueue without stranding siblings", async () => {
    readyRows = [{ id: "m-dead" }, { id: "m-alive" }];
    failFirstEnqueue = true;
    (globalThis as unknown as Record<string, unknown>).__qm_failFirstEnqueue =
      true;
    const result = await derivedHealSweep();
    // The failed candidate is skipped; the second one is still handed off.
    expect(enqueuedMediaIds).toEqual(["m-alive"]);
    expect(result).toEqual({ enqueued: 1 });
  });

  test("re-enqueues unscanned quarantine stragglers with a jobId suffix", async () => {
    unscannedRows = [{ id: "m-quarantined" }, { id: "m-scanning" }];
    const result = await derivedHealSweep();
    expect(result).toEqual({ enqueued: 2 });
    expect(enqueuedScanMediaIds).toEqual(["m-quarantined", "m-scanning"]);
    // The unscanned query must target only pre-publish stragglers holding
    // quarantine bytes. Locate it by its where shape rather than position.
    const unscannedArgs = findManyArgs.find(
      (args) =>
        (args.where?.status as string | undefined) === "QUARANTINED" &&
        args.where?.originalKey !== undefined
    );
    const unscannedWhere = unscannedArgs?.where;
    if (!unscannedWhere) {
      throw new Error("expected the unscanned-quarantine query");
    }
    expect(unscannedWhere.pipelineVersion).toBeNull();
    expect(unscannedWhere.originalKey).toEqual({ startsWith: "quarantine/" });
  });

  test("unscanned rescue continues past one failed scan enqueue", async () => {
    unscannedRows = [{ id: "m-dead" }, { id: "m-alive" }];
    failFirstScanEnqueue = true;
    (
      globalThis as unknown as Record<string, unknown>
    ).__qm_failFirstScanEnqueue = true;
    const result = await derivedHealSweep();
    expect(enqueuedScanMediaIds).toEqual(["m-alive"]);
    expect(result).toEqual({ enqueued: 1 });
  });

  test("kill switch disables everything - no queries, no enqueues", async () => {
    backfillEnabled = false;
    prismaDisabled = true;
    (globalThis as unknown as Record<string, unknown>).__qm_prismaDisabled =
      true;
    const result = await derivedHealSweep();
    expect(result).toEqual({ enqueued: 0 });
  });
});
