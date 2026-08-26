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
    status?: string;
    type?: { in: string[] };
  };
}

// ── Knobs ──────────────────────────────────────────────────────────────────
let prismaDisabled = false;
let failFirstEnqueue = false;
let sweepRows: { id: string }[] = [];
let derivativeCounts: Record<string, number> = {};
const enqueuedMediaIds: string[] = [];
const findManyArgs: FindManyArgs[] = [];

mock.module("@asm/db", () => ({
  enqueueMediaProcess: (mediaId: string) => {
    if (prismaDisabled) {
      throw new Error("must not enqueue when the sweep is disabled");
    }
    if (failFirstEnqueue) {
      failFirstEnqueue = false;
      throw new Error("redis unavailable");
    }
    enqueuedMediaIds.push(mediaId);
    return Promise.resolve();
  },
  prisma: {
    media: {
      findMany: (args: FindManyArgs) => {
        if (prismaDisabled) {
          throw new Error("must not query when the sweep is disabled");
        }
        findManyArgs.push(args);
        return sweepRows;
      },
    },
    mediaDerivative: {
      count: ({ where }: { where: { mediaId: string } }) =>
        Promise.resolve(derivativeCounts[where.mediaId] ?? 0),
    },
  },
}));

mock.module("./s3", () => ({
  // Never invoked by the sweep (no object IO); providing the key keeps the
  // transitive import graph below intact.
  getS3: () => {
    throw new Error("must not touch storage during a derivative sweep");
  },
  objectExists: () => Promise.resolve(false),
}));

const { derivedHealSweep, DERIVED_HEAL_GRACE_MS } = await import("./backfill");

beforeEach(() => {
  backfillEnabled = true;
  prismaDisabled = false;
  failFirstEnqueue = false;
  sweepRows = [];
  derivativeCounts = {};
  enqueuedMediaIds.length = 0;
  findManyArgs.length = 0;
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
    sweepRows = [{ id: "m-stranded" }];
    const result = await derivedHealSweep();
    expect(result).toEqual({ enqueued: 1 });
    expect(enqueuedMediaIds).toEqual(["m-stranded"]);
  });

  test("skips rows that already have derivatives", async () => {
    sweepRows = [{ id: "m-fine" }];
    derivativeCounts["m-fine"] = 3;
    const result = await derivedHealSweep();
    expect(result).toEqual({ enqueued: 0 });
    expect(enqueuedMediaIds).toEqual([]);
  });

  test("continues past one failed enqueue without stranding siblings", async () => {
    sweepRows = [{ id: "m-dead" }, { id: "m-alive" }];
    failFirstEnqueue = true;
    const result = await derivedHealSweep();
    // The failed candidate is skipped; the second one is still handed off.
    expect(enqueuedMediaIds).toEqual(["m-alive"]);
    expect(result).toEqual({ enqueued: 1 });
  });

  test("kill switch disables everything - no queries, no enqueues", async () => {
    backfillEnabled = false;
    prismaDisabled = true;
    const result = await derivedHealSweep();
    expect(result).toEqual({ enqueued: 0 });
  });
});
