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

interface UpdateCall {
  data: Record<string, unknown>;
  id: string;
  kind: "reset" | "update" | "updateAndCount";
}

interface SharedState {
  backfillEnabled: boolean;
  derivatives: Record<string, DerivativeRow[]>;
  enqueued: EnqueueCall[];
  present: Set<string>;
  probes: string[];
  queries: number;
  // Key that, once probed, swaps the row's customThumbnailKey for the value
  // below - standing in for the author attaching a NEW cover after the sweep
  // read the row but before it writes. The sweep must not erase that one.
  replaceAfterProbe: null | string;
  replaceWith: null | string;
  rows: SweepRow[];
  scanned: EnqueueCall[];
  // Per-probe scripted answers for a key: true = present, false = absent,
  // "unknown" = the storage fault that must never be read as "present".
  sequences: Record<string, ProbeSequence[]>;
  throwOn: null | string;
  updates: UpdateCall[];
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
    replaceAfterProbe: null,
    replaceWith: null,
    rows: [],
    scanned: [],
    sequences: {},
    throwOn: null,
    updates: [],
    wheres: [],
  };
  (globalThis as unknown as Record<string, unknown>).__si_state = next;
  return next;
}

type ProbeSequence = boolean | "unknown";

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

// A flattened where is a set of column/value pairs the row must still equal.
// Every field here is a plain column on SweepRow, so equality is the whole
// matcher.
function matchesFilter(
  candidate: SweepRow,
  matchers: Record<string, unknown>
): boolean {
  return Object.entries(matchers).every(([field, value]) => {
    const actual = (candidate as unknown as Record<string, unknown>)[field];
    return actual === value;
  });
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
  enqueueMediaScan: (mediaId: string, options?: { jobIdSuffix?: string }) => {
    const current = state();
    if (!current.backfillEnabled) {
      throw new Error("must not scan when the sweep is disabled");
    }
    current.scanned.push({
      mediaId,
      suffix: options?.jobIdSuffix ?? null,
    });
    return Promise.resolve();
  },
  or: (...filters: QueryFilter[]) => ({ filters, kind: "or" }),
  prisma: {
    orm: {
      public: {
        PostMedia: {
          select: () => candidateQuery(),
          where: (filter: unknown) => {
            // The filter can be a plain object (id only) or a predicate the
            // query builder evaluates. Both are flattened to one shape, because
            // a predicate is how the sweep makes a destructive write
            // CONDITIONAL - clearing a custom thumbnail only while the row still
            // holds the key that was probed.
            const matchers = flattenFilter(evaluateFilter(filter));
            const write =
              (data: Record<string, unknown>) =>
              (kind: UpdateCall["kind"]) =>
              () => {
                const current = state();
                const matches = current.rows.some((candidate) =>
                  matchesFilter(candidate, matchers)
                );
                if (!matches) {
                  // A conditional write that no longer matches writes nothing,
                  // which is exactly what makes it safe.
                  return Promise.resolve(
                    kind === "updateAndCount" ? 0 : { count: 0 }
                  );
                }
                current.updates.push({
                  data,
                  id: String(matchers.id ?? ""),
                  kind,
                });
                // updateAndCount resolves the matched row count, not the row.
                return Promise.resolve(
                  kind === "updateAndCount" ? 1 : { count: 1 }
                );
              };
            return {
              update: (data: Record<string, unknown>) =>
                write(data)("update")(),
              updateAndCount: (data: Record<string, unknown>) =>
                write(data)("updateAndCount")(),
            };
          },
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
        // The author attaches a different cover the moment the sweep looks at
        // the old one: the row the sweep holds is now stale.
        if (current.replaceAfterProbe === key && current.replaceWith) {
          current.replaceAfterProbe = null;
          for (const candidate of current.rows) {
            if (candidate.customThumbnailKey === key) {
              candidate.customThumbnailKey = current.replaceWith;
            }
          }
        }
        if (current.throwOn === key) {
          return Promise.reject(unreachableError());
        }
        const sequence = current.sequences[key];
        if (sequence && sequence.length > 0) {
          const answer = sequence.shift() as ProbeSequence;
          if (answer === "unknown") {
            return Promise.reject(unreachableError());
          }
          return answer
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

// The counters the sweep reports. Spelled out once so every assertion compares
// the whole shape, which is what catches a repair being mislabelled as a heal.
const CLEAN = {
  checked: 1,
  healed: 0,
  repointed: 0,
  republished: 0,
  retired: 0,
};

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

    expect(result).toEqual(CLEAN);
    expect(current.enqueued).toEqual([]);
    expect(current.scanned).toEqual([]);
    expect(current.updates).toEqual([]);
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
    // is exactly the state derivedHealSweep cannot see.
    current.present = new Set(["m1/published"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual({ ...CLEAN, healed: 1 });
    expect(current.enqueued).toHaveLength(1);
    expect(current.enqueued[0]?.mediaId).toBe("m1");
    // A fresh jobId suffix so a dead job holding the dedupe slot is replaced.
    expect(current.enqueued[0]?.suffix).toStartWith("integrity-");
    expect(current.updates).toEqual([]);
  });

  test("a missing thumbnail object re-enqueues processing", async () => {
    const current = state();
    current.rows = [row("m1", { thumbnailKey: "m1/thumb.jpg" })];
    current.present = new Set(["m1/published"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual({ ...CLEAN, healed: 1 });
    expect(current.enqueued).toHaveLength(1);
  });

  test("a missing custom thumbnail clears the pointer instead of healing", async () => {
    const current = state();
    current.rows = [row("m1", { customThumbnailKey: "cover/source.jpg" })];
    current.present = new Set(["m1/published"]);

    const result = await storageIntegritySweep();

    // The custom cover is a COPY of another row's published original, taken at
    // attach time, and no column records which row. processMedia cannot rebuild
    // it, so enqueueing it would burn a transcode per pass and report a heal
    // while the URL kept 404ing. Clearing the pointer is the same fallback the
    // author gets on detach: the read route serves the pipeline poster.
    expect(result).toEqual({ ...CLEAN, repointed: 1 });
    expect(current.enqueued).toEqual([]);
    // Conditional on the probed key, so it cannot fire against a cover the
    // author has since replaced.
    expect(current.updates).toEqual([
      {
        data: { customThumbnailKey: null },
        id: "m1",
        kind: "updateAndCount",
      },
    ]);
  });

  test("a transient miss never takes the author's cover away", async () => {
    const current = state();
    current.rows = [row("m1", { customThumbnailKey: "cover/source.jpg" })];
    current.present = new Set(["m1/published"]);
    // The first HEAD says gone, the confirming one says present. A single
    // NoSuchKey is as likely to be a storage hiccup for the cover as it is for
    // the source, and clearing on it would cost the user their choice.
    current.sequences = { "cover/source.jpg": [false, true] };

    const result = await storageIntegritySweep();

    expect(result).toEqual(CLEAN);
    expect(current.updates).toEqual([]);
    expect(
      current.probes.filter((key) => key === "cover/source.jpg")
    ).toHaveLength(2);
  });

  test("a cover replaced mid-sweep is left alone", async () => {
    const current = state();
    current.rows = [row("m1", { customThumbnailKey: "cover/source.jpg" })];
    current.present = new Set(["m1/published"]);
    // The author attaches a new cover while the sweep is verifying the old one.
    current.replaceAfterProbe = "cover/source.jpg";
    current.replaceWith = "cover/new.jpg";

    const result = await storageIntegritySweep();

    // Nothing is cleared: the key that went missing is not the one the row
    // holds any more, so their new choice is not ours to drop.
    expect(result).toEqual(CLEAN);
    expect(current.updates).toEqual([]);
    expect(current.rows[0]?.customThumbnailKey).toBe("cover/new.jpg");
  });

  test("a lost published key republishes even when a legacy key survives", async () => {
    const current = state();
    // The scan writes publishedKey and the legacy key in two separate updates,
    // so a row can hold a live legacy object under `key` and nothing under
    // `publishedKey`. The read route resolves `publishedKey || key`, so it
    // keeps requesting the missing one - this row is broken even though a copy
    // is sitting right there, and treating the pair as interchangeable would
    // call it healthy and skip the republish.
    current.rows = [row("m1", { originalKey: "quarantine/m1/upload" })];
    current.present = new Set(["m1/original", "quarantine/m1/upload"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual({ ...CLEAN, checked: 0, republished: 1 });
    expect(current.scanned).toHaveLength(1);
  });

  test("a custom thumbnail that is still present is left alone", async () => {
    const current = state();
    current.rows = [row("m1", { customThumbnailKey: "cover/source.jpg" })];
    current.present = new Set(["m1/published", "cover/source.jpg"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual(CLEAN);
    expect(current.updates).toEqual([]);
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

    expect(result).toEqual({ ...CLEAN, checked: 0, retired: 1 });
    expect(current.updates).toHaveLength(1);
    expect(current.updates[0]?.id).toBe("m1");
    expect(current.updates[0]?.data.status).toBe("FAILED");
    expect(current.updates[0]?.data.failureCode).toBe("storage-missing");
    // Re-processing cannot invent bytes that are gone, so it must not run.
    expect(current.enqueued).toEqual([]);
    expect(current.scanned).toEqual([]);
  });

  test("a surviving quarantine original republishes instead of retiring", async () => {
    const current = state();
    // The served object is gone but the retained upload is intact, which is the
    // state the old publishedKey-wins chain wrote off as unrecoverable.
    current.rows = [row("m1", { originalKey: "quarantine/m1/upload" })];
    current.present = new Set(["quarantine/m1/upload"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual({ ...CLEAN, checked: 0, republished: 1 });
    // Handed back to the scan stage, which claims QUARANTINED rows and
    // re-promotes the original out of quarantine.
    expect(current.scanned).toHaveLength(1);
    expect(current.scanned[0]?.mediaId).toBe("m1");
    expect(current.scanned[0]?.suffix).toStartWith("integrity-republish-");
    // The row goes back to the claimable state with no published key, which
    // also takes it out of quarantine GC's published-rows branch so the
    // surviving original cannot be deleted mid-recovery.
    expect(current.updates).toEqual([
      {
        data: {
          failureCode: null,
          failureDetail: null,
          key: "",
          // The scan stage reads originalKey, so the surviving copy is named
          // there whether it was already filed there or arrived under the legacy
          // key column.
          originalKey: "quarantine/m1/upload",
          publishedKey: null,
          status: "QUARANTINED",
        },
        id: "m1",
        kind: "updateAndCount",
      },
    ]);
    // Never retired: retirement is what let GC delete the last copy.
    expect(current.updates[0]?.data.failureCode).toBeNull();
    expect(current.enqueued).toEqual([]);
  });

  test("a surviving legacy key republishes after retention has cleared the original", async () => {
    const current = state();
    // The worst shape: the object the route serves is gone, retention already
    // cleared originalKey, and the only bytes left on disk are the pre-pipeline
    // object the legacy key column still points at. Retiring here would discard
    // a copy that is still there, and the row would 404 for as long as the
    // pointer to those bytes survives.
    current.rows = [row("m1", { key: "m1/legacy", originalKey: null })];
    current.present = new Set(["m1/legacy"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual({ ...CLEAN, checked: 0, republished: 1 });
    expect(current.scanned).toHaveLength(1);
    // The scan stage reads originalKey, so that is where the surviving copy has
    // to be named - the row cannot be republished from `key` as it stands.
    expect(current.updates).toEqual([
      {
        data: {
          failureCode: null,
          failureDetail: null,
          key: "",
          originalKey: "m1/legacy",
          publishedKey: null,
          status: "QUARANTINED",
        },
        id: "m1",
        kind: "updateAndCount",
      },
    ]);
    expect(current.updates[0]?.data.status).not.toBe("FAILED");
  });

  test("retires only when no copy of the bytes survives anywhere", async () => {
    const current = state();
    // Same shape, but the legacy object is gone too, so there is genuinely
    // nothing left to promote.
    current.rows = [row("m1", { key: "m1/legacy", originalKey: null })];
    current.present = new Set<string>();

    const result = await storageIntegritySweep();

    expect(result).toEqual({ ...CLEAN, checked: 0, retired: 1 });
    expect(current.scanned).toEqual([]);
    expect(current.updates[0]?.data.status).toBe("FAILED");
  });

  test("a confirming probe that cannot reach storage leaves the row unproven", async () => {
    const current = state();
    current.rows = [row("m1", { customThumbnailKey: "cover/source.jpg" })];
    current.present = new Set(["m1/published"]);
    // The first HEAD says gone; the confirming one hits a storage fault. The
    // verdict is UNKNOWN, not "present" - reporting a transport error as a hit
    // would certify an object this process never read, and the row would be
    // counted as verified with a cover still broken.
    current.sequences = { "cover/source.jpg": [false, "unknown"] };

    const result = await storageIntegritySweep();

    expect(result).toEqual({ ...CLEAN, checked: 0 });
    // Nothing is cleared, and nothing is claimed to be healthy.
    expect(current.updates).toEqual([]);
  });

  test("a confirming probe that cannot reach storage never retires a source", async () => {
    const current = state();
    // The same conflation on the source path: absent, then unreadable. That is
    // unproven, not a hit, so the row must not be certified nor written off.
    current.rows = [row("m1", { originalKey: null })];
    current.sequences = { "m1/published": [false, "unknown"] };
    current.present = new Set<string>();

    const result = await storageIntegritySweep();

    expect(result).toEqual({ ...CLEAN, checked: 0 });
    expect(current.updates).toEqual([]);
    expect(current.scanned).toEqual([]);
  });

  test("a republish never runs when the quarantine original is also gone", async () => {
    const current = state();
    current.rows = [row("m1", { originalKey: "quarantine/m1/upload" })];
    current.present = new Set<string>();

    const result = await storageIntegritySweep();

    expect(result).toEqual({ ...CLEAN, checked: 0, retired: 1 });
    expect(current.scanned).toEqual([]);
    expect(current.updates[0]?.data.status).toBe("FAILED");
  });

  test("an unreadable quarantine original never triggers a republish", async () => {
    const current = state();
    current.rows = [row("m1", { originalKey: "quarantine/m1/upload" })];
    current.present = new Set<string>();
    current.throwOn = "quarantine/m1/upload";

    const result = await storageIntegritySweep();

    // Loss is unproven, so nothing is written and nothing is requeued.
    expect(result).toEqual({ ...CLEAN, checked: 0 });
    expect(current.scanned).toEqual([]);
    expect(current.updates).toEqual([]);
  });

  test("one negative probe followed by a hit never retires a good row", async () => {
    const current = state();
    current.rows = [row("m1")];
    // Storage hiccuped on the first HEAD and answered correctly on the retry.
    current.sequences = { "m1/published": [false, true] };
    current.present = new Set(["m1/published"]);

    const result = await storageIntegritySweep();

    expect(result).toEqual(CLEAN);
    expect(current.updates).toEqual([]);
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

    expect(result).toEqual(CLEAN);
    expect(current.enqueued).toEqual([]);
    expect(current.updates).toEqual([]);
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

    expect(result).toEqual(CLEAN);
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
    expect(result).toEqual(CLEAN);
    expect(current.updates).toEqual([]);
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
    expect(result).toEqual({ ...CLEAN, checked: 0 });
    expect(current.enqueued).toEqual([]);
    expect(current.updates).toEqual([]);
  });

  test("a row with no resolvable source key is skipped without probing", async () => {
    const current = state();
    current.rows = [row("m1", { key: "", publishedKey: null })];

    const result = await storageIntegritySweep();

    expect(result).toEqual({ ...CLEAN, checked: 0 });
    expect(current.probes).toEqual([]);
  });

  test("the kill switch stops all queries and enqueues", async () => {
    const current = state();
    current.backfillEnabled = false;
    current.rows = [row("m1")];

    const result = await storageIntegritySweep();

    expect(result).toEqual({ ...CLEAN, checked: 0 });
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
