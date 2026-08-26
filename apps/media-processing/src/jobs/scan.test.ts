import { beforeEach, describe, expect, mock, test } from "bun:test";

// Stage-1 scanner unit tests. The scanner is the security boundary: these
// cover the rejection taxonomy, the conditional-claim idempotency gates, the
// publish happy path, and the release-on-error contract - against a stateful
// fake Prisma and a spy S3, streaming real bytes through real /tmp files.
//
// Per repo convention every mock lists ONLY the keys the scanner consumes;
// remaining keys fall through to the real modules (pure contracts) so drift
// fails loudly instead of silently stubbing behavior away.

// ── Mutable test knobs ─────────────────────────────────────────────────────
const defaultLimits = {
  maxAudioBytes: 1024,
  maxImageBytes: 1024,
  maxPixelCount: 100_000_000,
  maxVideoBytes: 1024,
  maxVideoDurationSec: 3600,
  originalRetentionDays: 30,
  processingTimeoutMs: 10_000,
  scanTimeoutMs: 5000,
};

let clamavHost: string | undefined;
let avVerdict: { clean: boolean; signature?: string } = { clean: true };
let failClamavUnavailable = false;
let failDownload = false;

interface MediaRow {
  attempts: number;
  claimedMime: string | null;
  detectedMime?: string | null;
  id: string;
  key: string;
  mimeType: string;
  originalKey: string | null;
  pipelineVersion: string | null;
  publishedKey?: string | null;
  sha256?: string | null;
  size: number;
  status: string;
  userId: string | null;
}

let row: MediaRow | null;
const updateManyCalls: { count: number; data: unknown; where: unknown }[] = [];
const updateCalls: Record<string, unknown>[] = [];
const deletedKeys: string[] = [];
const writtenKeys: string[] = [];
const processedEnqueues: string[] = [];

// ── Fixture builder: a structurally valid minimal PNG ─────────────────────
// 1x1 non-decodable-by-us pixels are irrelevant to the scan stage; only
// structure (signature + balanced chunks through IEND) matters, because
// stripImageMetadata walks chunk framing before deciding it has nothing to
// remove. Declared byte size therefore comes from the builder itself.

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (const [index, char] of [...type].entries()) {
    out[4 + index] = char.codePointAt(0) ?? 0;
  }
  out.set(payload, 8);
  return out;
}

function buildMinimalPng(): Uint8Array {
  const signature = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdr = new Uint8Array(13);
  ihdr[3] = 1; // height 1
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array(8)),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

const PNG_FIXTURE = buildMinimalPng();
const GARBAGE_FIXTURE = new TextEncoder().encode(
  "this is definitely not any recognized media format......"
);

// ── Module mocks (registered before the subject import) ────────────────────

interface UpdateManyData {
  attempts?: { increment: number };
  detectedMime?: string;
  failureCode?: string;
  publishedKey?: string;
  sha256?: string;
  status?: string;
}

interface UpdateManyArgs {
  data: UpdateManyData;
  where: {
    id?: string;
    publishedKey?: string | null;
    status?: string;
    userId?: string;
  };
}

function applyUpdates(current: MediaRow, data: UpdateManyData) {
  if (data.attempts) {
    current.attempts += data.attempts.increment;
  }
  if (data.status !== undefined) {
    current.status = data.status;
  }
  if (data.sha256 !== undefined) {
    current.sha256 = data.sha256;
  }
  if (data.publishedKey !== undefined) {
    current.publishedKey = data.publishedKey;
  }
  if (data.detectedMime !== undefined) {
    current.detectedMime = data.detectedMime;
  }
}

function matchesWhere(
  current: MediaRow,
  where: UpdateManyArgs["where"]
): boolean {
  if (where.id !== undefined && where.id !== current.id) {
    return false;
  }
  if (where.status !== undefined && where.status !== current.status) {
    return false;
  }
  if (
    where.publishedKey !== undefined &&
    (where.publishedKey ?? null) !== (current.publishedKey ?? null)
  ) {
    return false;
  }
  return true;
}

mock.module("@asm/db", () => ({
  Prisma: { DbNull: Symbol.for("test.DbNull") },
  enqueueMediaProcess: (mediaId: string) => {
    processedEnqueues.push(mediaId);
    return Promise.resolve();
  },
  prisma: {
    media: {
      findFirst: () => Promise.resolve(null),
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(row && row.id === where.id ? { ...row } : null),
      update: (args: {
        data: Record<string, unknown>;
        where: { id: string };
      }) => Promise.resolve(updateCalls.push(args)),
      updateMany: (args: UpdateManyArgs) => {
        // Rejections release onto a possibly-already-updated fake row: the
        // unconditional calls carry only an id in their where clause.
        const unconditional = !args.where.status;
        if (!row || (!matchesWhere(row, args.where) && !unconditional)) {
          const entry = { count: 0, data: args.data, where: args.where };
          updateManyCalls.push(entry);
          return Promise.resolve(entry);
        }
        applyUpdates(row, args.data);
        const entry = { count: 1, data: args.data, where: args.where };
        updateManyCalls.push(entry);
        return Promise.resolve(entry);
      },
    },
    user: {
      findUnique: () =>
        Promise.resolve({
          displayName: "Test User",
        }),
    },
  },
  redis: {
    decrby: () => Promise.resolve(0),
  },
}));

mock.module("../env", () => ({
  resolveWorkerMediaLimits: () => ({ ...defaultLimits }),
  workerEnv: {
    get ASMOB_BUCKET() {
      return "uploads";
    },
    get ASMOB_ENDPOINT() {
      return "http://localhost:9090";
    },
    get CLAMAV_HOST() {
      return clamavHost;
    },
    get REQUIRE_CLAMAV() {
      // Dev-mode semantics for the default fixtures: no host = skip loudly.
      // The unreachable-scanner test flips a dedicated knob instead.
      return false;
    },
  },
}));

mock.module("../log", () => ({
  mediaLogger: {
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {},
  },
  withSpan: (_name: string, fn: () => Promise<unknown>) => fn(),
}));

// Error identities shared between this file and the mocked ./clamav module
// so scan.ts's `instanceof` dispatch observes exactly these constructors.
// Built through a factory to keep a single class statement per file (lint).
const makeErrorClass = (label: string): new (message: string) => Error =>
  class extends Error {
    override name = label;
  };

const FakeClamAvSizeLimitError = makeErrorClass("FakeClamAvSizeLimitError");
const FakeClamAvUnavailableError = makeErrorClass("FakeClamAvUnavailableError");

mock.module("../clamav", () => ({
  ClamAvSizeLimitError: FakeClamAvSizeLimitError,
  ClamAvUnavailableError: FakeClamAvUnavailableError,
  scanStream: () => {
    if (failClamavUnavailable) {
      return Promise.reject(new FakeClamAvUnavailableError("scanner down"));
    }
    return avVerdict.clean
      ? Promise.resolve({ clean: true })
      : Promise.resolve(avVerdict);
  },
}));

mock.module("../provenance/reader", () => ({
  inspectAssetProvenance: () => Promise.resolve(null),
}));

mock.module("../provenance/stamp", () => ({
  stampAiGenerated: () => Promise.resolve(false),
}));

const s3Spy = {
  delete: (key: string) => {
    deletedKeys.push(key);
    return Promise.resolve();
  },
  file: (_key: string) => ({
    stat: () => Promise.resolve({ size: 1 }),
    stream: () => {
      if (failDownload) {
        throw new Error("storage unavailable");
      }
      const bytes =
        declaredFixture.kind === "garbage"
          ? new Uint8Array(GARBAGE_FIXTURE)
          : new Uint8Array(PNG_FIXTURE);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    },
  }),
  write: (key: string) => {
    writtenKeys.push(key);
    return Promise.resolve();
  },
};

// Which fixture the CURRENT test serves; rejection-paths flip this before
// loading the row so stream() hands back matching bytes.
const declaredFixture: { kind: "garbage" | "png" } = { kind: "png" };

mock.module("../s3", () => ({ getS3: () => s3Spy }));

const { processMediaScan } = await import("./scan");

// ── Row factory ────────────────────────────────────────────────────────────

function freshRow(overrides: Partial<MediaRow> = {}): MediaRow {
  return {
    attempts: 0,
    claimedMime: "image/png",
    id: "m-fixture",
    key: "",
    mimeType: "image/png",
    originalKey: "quarantine/m-fixture/toka/original.png",
    pipelineVersion: null,
    publishedKey: null,
    sha256: null,
    size: PNG_FIXTURE.byteLength,
    status: "QUARANTINED",
    userId: "u-fixture",
    ...overrides,
  };
}

beforeEach(() => {
  clamavHost = undefined;
  avVerdict = { clean: true };
  failClamavUnavailable = false;
  failDownload = false;
  declaredFixture.kind = "png";
  row = freshRow();
  updateManyCalls.length = 0;
  updateCalls.length = 0;
  deletedKeys.length = 0;
  writtenKeys.length = 0;
  processedEnqueues.length = 0;
});

describe("processMediaScan", () => {
  describe("skips", () => {
    test("missing row is a silent no-op", async () => {
      row = null;
      const outcome = await processMediaScan({ mediaId: "m-fixture" });
      expect(outcome.outcome).toBe("skipped");
      expect(updateManyCalls).toHaveLength(0);
    });

    test("terminal statuses (READY/REJECTED/DELETED) skip without claiming", async () => {
      row = freshRow({ status: "READY" });
      const outcome = await processMediaScan({ mediaId: "m-fixture" });
      expect(outcome.outcome).toBe("skipped");
      expect(updateManyCalls).toHaveLength(0);
      expect(processedEnqueues).toHaveLength(0);
    });

    test("lost claim race skips instead of double-scanning", async () => {
      // Another worker claimed between the load and the CAS: status moved
      // past QUARANTINED, so the conditional claim affects zero rows.
      row = freshRow({ status: "SCANNING" });
      const outcome = await processMediaScan({ mediaId: "m-fixture" });
      expect(outcome.outcome).toBe("skipped");
      expect(writtenKeys).toHaveLength(0);
    });

    test("live-claimed PROCESSING rows with a published key stay off-limits", async () => {
      // A worker actively publishing owns PROCESSING + publishedKey; the
      // rescuer must refuse rather than clobber its flip sequence.
      row = freshRow({
        pipelineVersion: "2",
        publishedKey: "media/x/original-aabbccddeeff0011.png",
        status: "PROCESSING",
      });
      const outcome = await processMediaScan({ mediaId: "m-fixture" });
      expect(outcome.outcome).toBe("skipped");
      expect(writtenKeys).toHaveLength(0);
    });
  });

  describe("rejections", () => {
    test("size mismatch rejects CORRUPT and deletes the quarantined object", async () => {
      row = freshRow({ size: PNG_FIXTURE.byteLength + 999 });
      if (!row || !row.originalKey) {
        throw new Error("fixture row vanished");
      }
      const outcome = await processMediaScan({ mediaId: "m-fixture" });
      expect(outcome.outcome).toBe("rejected");
      expect(deletedKeys).toEqual([row.originalKey]);
      const rejection = updateManyCalls.find(
        (call) => (call.data as { status?: string }).status === "REJECTED"
      );
      expect(rejection?.count).toBe(1);
    });

    test("unrecognized content rejects UNSUPPORTED_TYPE (fail closed)", async () => {
      declaredFixture.kind = "garbage";
      row = freshRow({ size: GARBAGE_FIXTURE.byteLength });
      const outcome = await processMediaScan({ mediaId: "m-fixture" });
      expect(outcome.outcome).toBe("rejected");
      const data = rejectionData();
      expect(data?.rejectedReason).toBe("UNSUPPORTED_TYPE");
    });

    test("declared-family mismatch rejects MIME_MISMATCH", async () => {
      declaredFixture.kind = "png"; // actual bytes are PNG…
      row = freshRow({ claimedMime: "video/mp4", mimeType: "video/mp4" }); // …declared as video
      const outcome = await processMediaScan({ mediaId: "m-fixture" });
      expect(outcome.outcome).toBe("rejected");
      const data = rejectionData();
      expect(data?.rejectedReason).toBe("MIME_MISMATCH");
    });

    test("malware verdict rejects MALWARE with the signature", async () => {
      clamavHost = "clamav:3310";
      avVerdict = { clean: false, signature: "EICAR.Test.File" };
      const outcome = await processMediaScan({ mediaId: "m-fixture" });
      expect(outcome.outcome).toBe("rejected");
      const data = rejectionData();
      expect(data?.rejectedReason).toBe("MALWARE");
      const detail = data?.failureDetail as { detail?: string } | undefined;
      expect(detail?.detail).toContain("EICAR");
    });

    test("rejections leave derivative generation untouched", async () => {
      row = freshRow({ size: 1 });
      await processMediaScan({ mediaId: "m-fixture" });
      expect(processedEnqueues).toHaveLength(0);
      expect(writtenKeys).toHaveLength(0);
    });

    test("an unreachable configured scanner fails closed (throws, publishes nothing)", async () => {
      clamavHost = "clamav:3310";
      failClamavUnavailable = true;
      await expect(
        processMediaScan({ mediaId: "m-fixture" })
      ).rejects.toThrow();

      // Release-on-error contract: claim handed back, zero objects written.
      const release = updateManyCalls.at(-1);
      expect((release?.data as { status?: string } | undefined)?.status).toBe(
        "QUARANTINED"
      );
      expect(writtenKeys).toHaveLength(0);
    });

    test("unconfigured scanning in dev warns but still verifies + publishes", async () => {
      clamavHost = undefined;
      const outcome = await processMediaScan({ mediaId: "m-fixture" });
      expect(outcome.outcome).toBe("published");
    });
  });

  describe("happy path", () => {
    test("publishes verified bytes and flips QUARANTINED→SCANNING→PROCESSING→READY", async () => {
      const outcome = await processMediaScan({ mediaId: "m-fixture" });
      expect(outcome.outcome).toBe("published");

      // Exactly one object promoted, under the media prefix with a
      // content-hashed key and the detected extension.
      expect(writtenKeys).toHaveLength(1);
      const [targetKey] = writtenKeys;
      if (!targetKey) {
        throw new Error("expected one written key");
      }
      expect(targetKey).toMatch(
        /^media\/m-fixture\/original-[0-9a-f]{16}\.png$/
      );

      // Full flip chain observed in order.
      const statuses = updateManyCalls.map(
        (call) => (call.data as { status?: string }).status
      );
      expect(statuses).toEqual(["SCANNING", "PROCESSING", "READY"]);

      // Legacy dual-write mirrors the publish for today's serving route.
      expect(updateCalls).toHaveLength(1);
      const dualWrite = updateCalls[0]?.data as {
        key?: string;
        url?: string;
      };
      expect(dualWrite.key).toBe(targetKey);
      expect(dualWrite.url).toContain("/uploads/media/");

      // Derivative handoff follows publication.
      expect(processedEnqueues).toEqual(["m-fixture"]);
    });

    test("retained originals are NOT deleted inside the retention window", async () => {
      await processMediaScan({ mediaId: "m-fixture" });
      // 30-day retention keeps the quarantine copy for forensics.
      expect(deletedKeys).toHaveLength(0);
    });

    test("hash recording matches the published bytes", async () => {
      const { CryptoHasher } = Bun;
      await processMediaScan({ mediaId: "m-fixture" });
      if (!row) {
        throw new Error("fixture row vanished");
      }
      const hasher = new CryptoHasher("sha256");
      hasher.update(PNG_FIXTURE);
      expect(row.sha256).toBe(hasher.digest("hex"));
      expect(row.detectedMime).toBe("image/png");
      expect(row.publishedKey).toBe(writtenKeys[0]);
    });
  });

  describe("error handling", () => {
    test("infrastructure errors release the claim back to QUARANTINED and stay retryable", async () => {
      failDownload = true;
      await expect(processMediaScan({ mediaId: "m-fixture" })).rejects.toThrow(
        "storage unavailable"
      );

      const release = updateManyCalls.at(-1);
      const data = (release?.data ?? {}) as {
        failureCode?: string;
        status?: string;
      };
      expect(release?.count).toBe(1);
      expect(data.status).toBe("QUARANTINED");
      expect(data.failureCode).toBe("scan-failed");
      // Nothing got published or handed off.
      expect(writtenKeys).toHaveLength(0);
      expect(processedEnqueues).toHaveLength(0);
    });
  });
});

function rejectionData():
  | { failureDetail?: unknown; rejectedReason?: string }
  | undefined {
  const rejection = updateManyCalls.find(
    (call) => (call.data as { status?: string }).status === "REJECTED"
  );
  return rejection?.data as
    | { failureDetail?: unknown; rejectedReason?: string }
    | undefined;
}
