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

mock.module("../env", () => ({
  resolveWorkerMediaLimits: () => defaultLimits,
  workerEnv: {
    get BACKFILL_ENABLED() {
      return backfillEnabled;
    },
  },
}));

type QueryFilter =
  | { field: string; op: string; value: unknown }
  | { filters: QueryFilter[]; kind: "and" }
  | { filters: QueryFilter[]; kind: "or" }
  | Record<string, unknown>;

// An OR cannot be flattened into one flat where - the arms are alternatives, not
// conjuncts - so it is carried through as a single named slot the assertions
// can read. Nothing in this suite has to EVALUATE it: the mock returns fixture
// rows by status, and the OR only has to survive into the recorded where.
const OR_SLOT = "orAlternatives";

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

function isOrFilter(
  filter: QueryFilter
): filter is { filters: QueryFilter[]; kind: "or" } {
  return "kind" in filter && filter.kind === "or";
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
  if (isOrFilter(filter)) {
    return {
      [OR_SLOT]: filter.filters.map((arm) => flattenFilter(arm)),
    };
  }
  if (isFieldFilter(filter)) {
    if (filter.op === "isNull") {
      return { [filter.field]: null };
    }
    if (filter.op === "isNotNull") {
      return { [filter.field]: { not: null } };
    }
    if (filter.op === "neq") {
      return { [filter.field]: { not: filter.value } };
    }
    if (filter.op === "in") {
      return { [filter.field]: { in: filter.value } };
    }
    if (filter.op === "lt") {
      return { [filter.field]: { lt: filter.value } };
    }
    if (filter.op === "gte") {
      return { [filter.field]: { gte: filter.value } };
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
  select?: Record<string, boolean>;
  take?: number;
  where?: {
    createdAt?: unknown;
    processedAt?: unknown;
    status?: unknown;
    type?: { in: string[] };
    _type?: { in: string[] };
    originalKey?: unknown;
    orAlternatives?: Record<string, unknown>[];
    pipelineVersion?: unknown;
  };
}

// A row as the unscanned-query would see it, so the mock can apply the WHERE
// rather than hand back whichever fixture list matches the status. Asserting
// the shape of the query proves nothing about which rows it selects; this lets
// a test plant rows that must be picked up AND rows that must be left alone.
interface UnscannedRow {
  _type: string;
  createdAt: Date;
  id: string;
  originalKey: null | string;
  pipelineVersion: null | string;
  publishedKey: null | string;
  status: string;
}

function quarantined(
  id: string,
  overrides: Partial<UnscannedRow> = {}
): UnscannedRow {
  return {
    // Long past the grace window, so the age predicate always lets it through.
    _type: "IMAGE",
    createdAt: new Date(0),
    id,
    originalKey: `quarantine/${id}/upload`,
    pipelineVersion: null,
    publishedKey: null,
    status: "QUARANTINED",
    ...overrides,
  };
}

// Applies a flattened WHERE to one row. Only the operators these two queries
// actually use are implemented; anything else fails loudly rather than
// silently passing, so a new predicate cannot slip through untested.
function rowMatches(
  row: UnscannedRow,
  where: Record<string, unknown>
): boolean {
  for (const [field, expected] of Object.entries(where)) {
    const actual = (row as unknown as Record<string, unknown>)[field];
    if (field === OR_SLOT) {
      const arms = expected as Record<string, unknown>[];
      if (!arms.some((arm) => rowMatches(row, arm))) {
        return false;
      }
      continue;
    }
    if (
      expected &&
      typeof expected === "object" &&
      !(expected instanceof Date)
    ) {
      const clause = expected as Record<string, unknown>;
      if ("not" in clause) {
        // `{ not: null }` reads as "is not null": the row has to DIFFER from
        // it, so equality is the mismatch.
        if (actual === clause.not) {
          return false;
        }
        continue;
      }
      if ("lt" in clause) {
        if (!((actual as Date) < (clause.lt as Date))) {
          return false;
        }
        continue;
      }
      if ("in" in clause) {
        if (!(clause.in as unknown[]).includes(actual)) {
          return false;
        }
        continue;
      }
      if ("startsWith" in clause) {
        if (!String(actual).startsWith(String(clause.startsWith))) {
          return false;
        }
        continue;
      }
      throw new Error(`rowMatches does not implement ${field}`);
    }
    if (actual !== expected) {
      return false;
    }
  }
  return true;
}

let prismaDisabled = false;
let failFirstEnqueue = false;
let failFirstScanEnqueue = false;
let readyRows: { id: string }[] = [];
let unscannedRows: UnscannedRow[] = [];
const derivativeCounts: Record<string, number> = {};
const enqueuedMediaIds: string[] = [];
const enqueuedScanMediaIds: string[] = [];
const findManyArgs: FindManyArgs[] = [];

function createQuery() {
  const filters: QueryFilter[] = [];
  let take: number | undefined;
  const query = {
    all: () => {
      if (prismaDisabled) {
        throw new Error("must not query when the sweep is disabled");
      }
      const where = Object.assign({}, ...filters.map(flattenFilter));
      findManyArgs.push({ take, where });
      if (where.status === "READY") {
        return Promise.resolve(readyRows);
      }
      return Promise.resolve(
        unscannedRows.filter((row) => rowMatches(row, where))
      );
    },
    limit: (value: number) => {
      take = value;
      return query;
    },
    orderBy: () => query,
    select: () => query,
    where: (filter: unknown) => {
      filters.push(evaluateFilter(filter));
      return query;
    },
  };
  return query;
}
// Sync to global for cross-file mock compatibility
(globalThis as unknown as Record<string, unknown>).__qm_prismaDisabled =
  prismaDisabled;
(globalThis as unknown as Record<string, unknown>).__qm_failFirstEnqueue =
  failFirstEnqueue;
(globalThis as unknown as Record<string, unknown>).__qm_derivativeCounts =
  derivativeCounts;

mock.module("@asm/db", () => ({
  and: (...filters: QueryFilter[]) => ({ filters, kind: "and" }),
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
  or: (...filters: QueryFilter[]) => ({ filters, kind: "or" }),
  prisma: {
    orm: {
      public: {
        PostMedia: {
          select: () => createQuery(),
          where: (filter: unknown) => createQuery().where(filter),
        },
        PostMediaDerivatives: {
          where: (filter: { mediaId: string }) => ({
            aggregate: () => {
              const g = globalThis as unknown as Record<string, unknown>;
              const counts =
                (g.__qm_derivativeCounts as Record<string, number>) ??
                derivativeCounts;
              return Promise.resolve({
                count:
                  counts[filter.mediaId] ??
                  derivativeCounts[filter.mediaId] ??
                  0,
              });
            },
          }),
        },
      },
    },
  },
  toPrismaDateTime: (value: Date) => value,
}));

mock.module("../s3", () => ({
  // Never invoked by the sweep (no object IO); providing the key keeps the
  // transitive import graph below intact.
  getS3: () => {
    throw new Error("must not touch storage during a derivative sweep");
  },
  objectExists: () => Promise.resolve(false),
}));

const { derivedHealSweep, DERIVED_HEAL_GRACE_MS } = await import("./index");

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
    expect(args.where._type?.in).toContain("VIDEO");
    expect(args.where._type?.in).not.toContain("DOCUMENT");
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
    unscannedRows = [quarantined("m-quarantined"), quarantined("m-scanning")];
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
    // Both arms matter: a row that never published (no pipeline version) and a
    // row that published once, lost its published object, and was reset to
    // QUARANTINED to republish. Without the second arm the latter would sit
    // there forever if its scan job were swallowed.
    expect(unscannedWhere.orAlternatives).toEqual([
      { pipelineVersion: null },
      { publishedKey: null },
    ]);
    // Any source will do, wherever it is filed. Requiring the quarantine
    // prefix excluded the two shapes that most need this net: a row migrated
    // off the legacy key, and a row the storage-integrity sweep reset to
    // republish from a surviving legacy key. Both park in QUARANTINED pointing
    // at a `media/...` object, and were stranded for good when their scan job
    // went missing. A row with no source at all still has nothing to scan, so
    // the null is filtered instead.
    expect(unscannedWhere.originalKey).toEqual({ not: null });
  });

  test("rescues a stranded row whose source is not under quarantine/", async () => {
    unscannedRows = [
      // Reset to republish from a surviving legacy key: parked in QUARANTINED,
      // pipelineVersion set from a prior publish, no published key, and the
      // source filed under media/ rather than quarantine/. This is the row the
      // old prefix filter threw away, so a swallowed scan job stranded it for
      // good even though the bytes were sitting right there.
      quarantined("m-legacy", {
        originalKey: "media/m-legacy/original.mp4",
        pipelineVersion: "3",
        publishedKey: null,
      }),
      // A row migrated off the legacy key is the same shape, and the same gap.
      quarantined("m-migrated", { originalKey: "media/m-migrated/original" }),
      // Fresh upload: covered before and still covered.
      quarantined("m-fresh"),
    ];

    const result = await derivedHealSweep();

    expect(enqueuedScanMediaIds).toEqual(["m-legacy", "m-migrated", "m-fresh"]);
    expect(result).toEqual({ enqueued: 3 });
  });

  test("does not queue a row with no source, or one that is still READY", async () => {
    unscannedRows = [
      // Nothing to scan: the reset found no surviving copy either.
      quarantined("m-nosource", { originalKey: null }),
      // Already published and healthy, so it is not this branch's business.
      quarantined("m-ready", {
        originalKey: "media/m-ready/original.mp4",
        pipelineVersion: "3",
        publishedKey: "media/m-ready/published.mp4",
        status: "READY",
      }),
      // Mid-scan, which the scan's own restart recovery owns.
      quarantined("m-scanning", { status: "SCANNING" }),
    ];

    const result = await derivedHealSweep();

    expect(enqueuedScanMediaIds).toEqual([]);
    expect(result).toEqual({ enqueued: 0 });
  });

  test("unscanned rescue continues past one failed scan enqueue", async () => {
    unscannedRows = [quarantined("m-dead"), quarantined("m-alive")];
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
