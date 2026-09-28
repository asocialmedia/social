import { beforeEach, describe, expect, mock, test } from "bun:test";

// Storage-integrity sweep: the self-healing net for READY rows whose objects
// are gone from storage while their derivative ROWS are all still there.
//
// derivedHealSweep cannot see this state - it only rescues rows with zero
// derivative rows - so a row can sit READY with a null failureCode and serve
// nothing but failed reads. These tests pin what the verifier must do: re-run
// processing when a derivative is recoverable, retire a row whose SOURCE is
// gone (nothing can regenerate it), never retire on one flaky probe, and never
// let one bad row stop the batch.

interface SweepRow {
  customThumbnailKey: null | string;
  id: string;
  key: string;
  originalKey: null | string;
  publishedKey: null | string;
  thumbnailKey: null | string;
}

interface DerivativeRow {
  key: string;
  kind: string;
  pipelineVersion: string;
  variant: string;
}

interface EnqueueCall {
  mediaId: string;
  suffix: null | string;
}

interface RetireCall {
  data: Record<string, unknown>;
  id: string;
}

interface SharedState {
  backfillEnabled: boolean;
  derivatives: Record<string, DerivativeRow[]>;
  enqueued: EnqueueCall[];
  present: Set<string>;
  probes: string[];
  queries: number;
  retired: RetireCall[];
  rows: SweepRow[];
  sequences: Record<string, boolean[]>;
  throwOn: null | string;
  wheres: Record<string, unknown>[];
}

function state(): SharedState {
  const g = globalThis as unknown as Record<string, unknown>;
  return g.__si_state as SharedState;
}

function seed(): SharedState {
  delete process.env.MEDIA_INTEGRITY_BATCH;
  const next: SharedState = {
    backfillEnabled: true,
    derivatives: {},
    enqueued: [],
    present: new Set<string>(),
    probes: [],
    queries: 0,
    retired: [],
    rows: [],
    sequences: {},
    throwOn: null,
    wheres: [],
  };
  (globalThis as unknown as Record<string, unknown>).__si_state = next;
  return next;
}

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

function isAndFilter(
  filter: QueryFilter
): filter is { filters: QueryFilter[]; kind: "and" } {
  return "kind" in filter && filter.kind === "and";
}

function flattenFilter(filter: QueryFilter): Record<string, unknown> {
  if (isAndFilter(filter)) {
    return Object.assign({}, ...filter.filters.map(flattenFilter));
  }
  if ("field" in filter && typeof filter.field === "string") {
    if (filter.op === "isNull") {
      return { [filter.field]: null };
    }
    if (filter.op === "in") {
      return { [filter.field]: { in: filter.value } };
    }
    if (filter.op === "lt") {
      return { [filter.field]: { lt: filter.value } };
    }
    if (filter.op === "gt") {
      return { [filter.field]: { gt: filter.value } };
    }
    return { [filter.field]: filter.value };
  }
  return filter;
}

function candidateQuery() {
  const filters: QueryFilter[] = [];
  let take = Number.POSITIVE_INFINITY;
  const query: Record<string, unknown> = {};
  query.select = () => query;
  query.orderBy = () => query;
  query.where = (filter: unknown) => {
    filters.push(evaluateFilter(filter));
    return query;
  };
  query.limit = (value: number) => {
    take = value;
    return query;
  };
  query.all = () => {
    const current = state();
    if (!current.backfillEnabled) {
      throw new Error("must not query when the sweep is disabled");
    }
    current.queries += 1;
    current.wheres.push(Object.assign({}, ...filters.map(flattenFilter)));
    // The limit decides whether the round-robin cursor advances or wraps, so
    // the mock has to honour it for the cursor tests to mean anything.
    return Promise.resolve(current.rows.slice(0, take));
  };
  return query;
}

function derivativeQuery(_mediaId: string) {
  const query: Record<string, unknown> = {};
  query.select = () => query;
  query.where = (filter: { mediaId: string }) => {
    query.mediaId = filter.mediaId;
    return query;
  };
  query.all = () =>
    Promise.resolve(state().derivatives[query.mediaId as string] ?? []);
  return query;
}

mock.module("../env", () => ({
  resolveWorkerMediaLimits: () => ({}),
  workerEnv: {
    get BACKFILL_ENABLED() {
      return state().backfillEnabled;
    },
  },
}));

mock.module("@asm/db", () => ({
  and: (...filters: QueryFilter[]) => ({ filters, kind: "and" }),
  enqueueMediaAnalyze: () => Promise.resolve(),
  enqueueMediaProcess: (
    mediaId: string,
    options?: { jobIdSuffix?: string }
  ) => {
    const current = state();
    if (!current.backfillEnabled) {
      throw new Error("must not enqueue when the sweep is disabled");
    }
    current.enqueued.push({
      mediaId,
      suffix: options?.jobIdSuffix ?? null,
    });
    return Promise.resolve();
  },
  enqueueMediaScan: () => Promise.resolve(),
  prisma: {
    orm: {
      public: {
        PostMedia: {
          select: () => candidateQuery(),
          where: (filter: { id: string }) => ({
            update: (data: Record<string, unknown>) => {
              state().retired.push({ data, id: filter.id });
              return Promise.resolve({ count: 1 });
            },
          }),
        },
        PostMediaDerivatives: {
          select: () => derivativeQuery(""),
        },
      },
    },
  },
  toPrismaDateTime: (value: Date) => value,
}));

// The probe distinguishes three outcomes, exactly as rustfs does: a hit, a
// definitive NoSuchKey, and a transport fault that is ALSO an S3Error. The last
// one is why the sweep must not treat every failure as data loss.
function missingKeyError(): Error {
  return Object.assign(new Error("The specified key does not exist."), {
    code: "NoSuchKey",
    name: "S3Error",
  });
}

function unreachableError(): Error {
  return Object.assign(new Error("an unexpected error has occurred"), {
    code: "ConnectionRefused",
    name: "S3Error",
  });
}

mock.module("../s3", () => ({
  getS3: () => ({
    file: (key: string) => ({
      stat: () => {
        const current = state();
        current.probes.push(key);
        if (current.throwOn === key) {
          return Promise.reject(unreachableError());
        }
        const sequence = current.sequences[key];
        if (sequence && sequence.length > 0) {
          return (sequence.shift() as boolean)
            ? Promise.resolve({ size: 1 })
            : Promise.reject(missingKeyError());
        }
        return current.present.has(key)
          ? Promise.resolve({ size: 1 })
          : Promise.reject(missingKeyError());
      },
    }),
  }),
}));

const { storageIntegritySweep } = await import("./index");

function row(id: string, overrides: Partial<SweepRow> = {}): SweepRow {
  return {
    customThumbnailKey: null,
    id,
    key: `${id}/original`,
    originalKey: null,
    publishedKey: `${id}/published`,
    thumbnailKey: null,
    ...overrides,
  };
}

beforeEach(() => {
  seed();
});

describe("storage-integrity sweep", () => {
  test("a healthy row is verified and left alone", async () => {
    const current = state();
    current.rows = [row("m1")];
    current.derivatives = {
      m1: [
        {
          key: "m1/poster",
          kind: "poster",
          pipelineVersion: "3",
          variant: "d",
        },
      ],
    };
    current.present = new Set(["m1/published", "m1/poster"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual({ checked: 1, healed: 0, retired: 0 });
    expect(current.enqueued).toEqual([]);
    expect(current.retired).toEqual([]);
  });

  test("a missing derivative object re-enqueues processing", async () => {
    const current = state();
    current.rows = [row("m1")];
    current.derivatives = {
      m1: [
        { key: "m1/mp4", kind: "mp4-h264", pipelineVersion: "3", variant: "d" },
      ],
    };
    // The source survived; the transcoded object did not. The row exists, which
    // is exactly the state derived-healSweep cannot see.
    current.present = new Set(["m1/published"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual({ checked: 1, healed: 1, retired: 0 });
    expect(current.enqueued).toHaveLength(1);
    expect(current.enqueued[0]?.mediaId).toBe("m1");
    // A fresh jobId suffix so a dead job holding the dedupe slot is replaced.
    expect(current.enqueued[0]?.suffix).toStartWith("integrity-");
    expect(current.retired).toEqual([]);
  });

  test("a missing thumbnail object re-enqueues processing", async () => {
    const current = state();
    current.rows = [row("m1", { thumbnailKey: "m1/thumb.jpg" })];
    current.present = new Set(["m1/published"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual({ checked: 1, healed: 1, retired: 0 });
    expect(current.enqueued).toHaveLength(1);
  });

  test("a missing custom thumbnail object re-enqueues processing", async () => {
    const current = state();
    current.rows = [row("m1", { customThumbnailKey: "cover/source.jpg" })];
    current.present = new Set(["m1/published"]);

    const result = await storageIntegritySweep();

    expect(result.healed).toBe(1);
  });

  test("a row whose source is confirmed gone is retired, not re-processed", async () => {
    const current = state();
    current.rows = [row("m1")];
    current.derivatives = {
      m1: [
        {
          key: "m1/poster",
          kind: "poster",
          pipelineVersion: "3",
          variant: "d",
        },
      ],
    };
    current.present = new Set(["m1/poster"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual({ checked: 0, healed: 0, retired: 1 });
    expect(current.retired).toHaveLength(1);
    expect(current.retired[0]?.id).toBe("m1");
    expect(current.retired[0]?.data.status).toBe("FAILED");
    expect(current.retired[0]?.data.failureCode).toBe("storage-missing");
    // Re-processing cannot invent bytes that are gone, so it must not run.
    expect(current.enqueued).toEqual([]);
  });

  test("one negative probe followed by a hit never retires a good row", async () => {
    const current = state();
    current.rows = [row("m1")];
    // Storage hiccuped on the first HEAD and answered correctly on the retry.
    current.sequences = { "m1/published": [false, true] };
    current.present = new Set(["m1/published"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual({ checked: 1, healed: 0, retired: 0 });
    expect(current.retired).toEqual([]);
    expect(current.probes.filter((key) => key === "m1/published")).toHaveLength(
      2
    );
  });

  test("a retired pipeline version is reported but never re-processed", async () => {
    const current = state();
    current.rows = [row("m1")];
    // A version-2 key can never be rewritten: the process job only ever writes
    // version-stamped keys for the CURRENT version, so re-running it would burn
    // a full transcode every cycle and the report would never clear.
    current.derivatives = {
      m1: [
        {
          key: "m1/old-mp4",
          kind: "mp4-h264",
          pipelineVersion: "2",
          variant: "d",
        },
      ],
    };
    current.present = new Set(["m1/published"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual({ checked: 1, healed: 0, retired: 0 });
    expect(current.enqueued).toEqual([]);
    expect(current.retired).toEqual([]);
  });

  test("the thumbnail column is not probed twice when it is also a derivative", async () => {
    const current = state();
    // thumbnailKey is written from the poster key, so both point at one object.
    current.rows = [row("m1", { thumbnailKey: "m1/poster" })];
    current.derivatives = {
      m1: [
        {
          key: "m1/poster",
          kind: "poster",
          pipelineVersion: "3",
          variant: "d",
        },
      ],
    };
    current.present = new Set(["m1/published", "m1/poster"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual({ checked: 1, healed: 0, retired: 0 });
    expect(current.probes.filter((key) => key === "m1/poster")).toHaveLength(1);
  });

  test("a storage fault never retires a healthy row as data loss", async () => {
    const current = state();
    current.rows = [row("m1"), row("m2")];
    current.derivatives = {
      m2: [
        { key: "m2/mp4", kind: "mp4-h264", pipelineVersion: "3", variant: "d" },
      ],
    };
    current.present = new Set(["m2/published", "m2/mp4"]);
    // ConnectionRefused arrives as an S3Error too, exactly like NoSuchKey. Read
    // as "absent", one storage blip would fail every healthy post's media in
    // the batch - permanently.
    current.throwOn = "m1/published";

    const result = await storageIntegritySweep();

    // m1 was skipped as unproven while m2 was still verified: one unreachable
    // object must not strand its siblings either.
    expect(result).toEqual({ checked: 1, healed: 0, retired: 0 });
    expect(current.retired).toEqual([]);
    expect(current.enqueued).toEqual([]);
    expect(current.probes).toContain("m1/published");
  });

  test("an unreadable derivative leaves the row unverified, not re-processed", async () => {
    const current = state();
    current.rows = [row("m1")];
    current.derivatives = {
      m1: [
        { key: "m1/mp4", kind: "mp4-h264", pipelineVersion: "3", variant: "d" },
      ],
    };
    current.present = new Set(["m1/published"]);
    current.throwOn = "m1/mp4";

    const result = await storageIntegritySweep();

    // Loss is unproven, so no re-enqueue and no "checked".
    expect(result).toEqual({ checked: 0, healed: 0, retired: 0 });
    expect(current.enqueued).toEqual([]);
    expect(current.retired).toEqual([]);
  });

  test("a row with no resolvable source key is skipped without probing", async () => {
    const current = state();
    current.rows = [row("m1", { key: "", publishedKey: null })];

    const result = await storageIntegritySweep();

    expect(result).toEqual({ checked: 0, healed: 0, retired: 0 });
    expect(current.probes).toEqual([]);
  });

  test("the kill switch stops all queries and enqueues", async () => {
    const current = state();
    current.backfillEnabled = false;
    current.rows = [row("m1")];

    const result = await storageIntegritySweep();

    expect(result).toEqual({ checked: 0, healed: 0, retired: 0 });
    expect(current.queries).toBe(0);
    expect(current.probes).toEqual([]);
  });

  test("a full batch advances the cursor to the last checked row", async () => {
    process.env.MEDIA_INTEGRITY_BATCH = "2";
    const current = state();
    current.rows = [row("m1"), row("m2"), row("m3")];
    current.present = new Set(["m1/published", "m2/published", "m3/published"]);

    await storageIntegritySweep();
    await storageIntegritySweep();

    expect(current.wheres[0]?.id).toBeUndefined();
    expect(current.wheres[1]?.id).toEqual({ gt: "m2" });
  });

  test("running off the end wraps the cursor back to the start", async () => {
    const current = state();
    current.rows = [row("m1")];
    current.present = new Set(["m1/published"]);

    await storageIntegritySweep();
    await storageIntegritySweep();

    expect(current.wheres[1]?.id).toBeUndefined();
  });
});
