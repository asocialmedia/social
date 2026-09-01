import { beforeEach, describe, expect, mock, test } from "bun:test";

let backfillEnabled = true;

mock.module("./env", () => ({
  keys: {},
  resolveWorkerMediaLimits: () => ({}),
  workerEnv: {
    get BACKFILL_ENABLED() {
      return backfillEnabled;
    },
  },
}));

interface CandidateRow {
  id: string;
  techMetadata: unknown;
}

let candidateRows: CandidateRow[] = [];
const enqueuedIds: string[] = [];

mock.module("@asm/db", () => ({
  Prisma: { DbNull: Symbol.for("test.DbNull") },
  enqueueMediaAnalyze: (id: string) => {
    enqueuedIds.push(id);
    return Promise.resolve();
  },
  prisma: {
    media: {
      findMany: () => Promise.resolve(candidateRows),
    },
  },
}));

const {
  MAX_TRANSCRIPTION_BACKFILL_ATTEMPTS,
  TRANSCRIPTION_BACKFILL_RETRY_WINDOW_MS,
  transcriptionBackfillSweep,
} = await import("./sweeps");

describe("transcriptionBackfillSweep loop prevention", () => {
  beforeEach(() => {
    backfillEnabled = true;
    candidateRows = [];
    enqueuedIds.length = 0;
  });

  test("enqueues fresh candidates with no prior transcription metadata", async () => {
    candidateRows = [
      { id: "fresh-video-1", techMetadata: null },
      { id: "fresh-video-2", techMetadata: { container: "mp4" } },
    ];

    const result = await transcriptionBackfillSweep();
    expect(result.enqueued).toBe(2);
    expect(enqueuedIds).toEqual(["fresh-video-1", "fresh-video-2"]);
  });

  test("skips media permanently classified as no_audio or silent", async () => {
    candidateRows = [
      {
        id: "no-audio-vid",
        techMetadata: {
          transcription: {
            attemptedAt: new Date().toISOString(),
            attempts: 1,
            status: "no_audio",
          },
        },
      },
      {
        id: "silent-vid",
        techMetadata: {
          transcription: {
            attemptedAt: new Date().toISOString(),
            attempts: 1,
            status: "silent",
          },
        },
      },
      {
        id: "completed-vid",
        techMetadata: {
          transcription: {
            attemptedAt: new Date().toISOString(),
            attempts: 1,
            status: "completed",
          },
        },
      },
    ];

    const result = await transcriptionBackfillSweep();
    expect(result.enqueued).toBe(0);
    expect(enqueuedIds).toHaveLength(0);
  });

  test("skips failed media when attempts have reached MAX_TRANSCRIPTION_BACKFILL_ATTEMPTS", async () => {
    candidateRows = [
      {
        id: "exhausted-attempts-vid",
        techMetadata: {
          transcription: {
            attemptedAt: new Date(
              Date.now() - 24 * 60 * 60 * 1000
            ).toISOString(),
            attempts: MAX_TRANSCRIPTION_BACKFILL_ATTEMPTS,
            error: "HTTP 429 quota exhausted",
            status: "failed",
          },
        },
      },
    ];

    const result = await transcriptionBackfillSweep();
    expect(result.enqueued).toBe(0);
    expect(enqueuedIds).toHaveLength(0);
  });

  test("skips failed media within the backoff window", async () => {
    candidateRows = [
      {
        id: "recent-failure-vid",
        techMetadata: {
          transcription: {
            attemptedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 mins ago
            attempts: 1,
            error: "HTTP 429 quota exhausted",
            status: "failed",
          },
        },
      },
    ];

    const result = await transcriptionBackfillSweep();
    expect(result.enqueued).toBe(0);
    expect(enqueuedIds).toHaveLength(0);
  });

  test("re-enqueues failed media when backoff window has elapsed and attempts remain", async () => {
    const elapsedMs = TRANSCRIPTION_BACKFILL_RETRY_WINDOW_MS + 1000;
    candidateRows = [
      {
        id: "retryable-failure-vid",
        techMetadata: {
          transcription: {
            attemptedAt: new Date(Date.now() - elapsedMs).toISOString(),
            attempts: 1,
            error: "HTTP 429 quota exhausted",
            status: "failed",
          },
        },
      },
    ];

    const result = await transcriptionBackfillSweep();
    expect(result.enqueued).toBe(1);
    expect(enqueuedIds).toEqual(["retryable-failure-vid"]);
  });

  test("returns 0 and performs no work when BACKFILL_ENABLED is false", async () => {
    backfillEnabled = false;
    candidateRows = [{ id: "fresh-vid", techMetadata: null }];

    const result = await transcriptionBackfillSweep();
    expect(result.enqueued).toBe(0);
    expect(enqueuedIds).toHaveLength(0);
  });
});
