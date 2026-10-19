import { beforeEach, describe, expect, mock, test } from "bun:test";

let backfillEnabled = true;
let geminiApiKey: string | undefined = "mock-gemini-key";
let whisperEnabled = true;

mock.module("../env", () => ({
  keys: {},
  resolveWorkerMediaLimits: () => ({}),
  workerEnv: {
    get BACKFILL_ENABLED() {
      return backfillEnabled;
    },
    get GEMINI_API_KEY() {
      return geminiApiKey;
    },
    get WHISPER_ENABLED() {
      return whisperEnabled;
    },
  },
}));

interface CandidateRow {
  id: string;
  techMetadata: unknown;
}

let candidateRows: CandidateRow[] = [];
const enqueuedIds: string[] = [];
const semanticRefreshIds: string[] = [];

mock.module("@asm/db", () => ({
  and: (...filters: unknown[]) => filters,
  enqueueMediaAnalyze: (
    id: string,
    options?: { semanticRefresh?: boolean }
  ) => {
    enqueuedIds.push(id);
    if (options?.semanticRefresh) {
      semanticRefreshIds.push(id);
    }
    return Promise.resolve();
  },
  // Unused by this sweep; present so whichever test file evaluates the sweep
  // module first binds a complete enqueue set for the other suites sharing
  // this process-wide mock key.
  enqueueMediaProcess: () => Promise.resolve(),
  enqueueMediaScan: () => Promise.resolve(),
  globalKnowledgeGraph: {},
  or: (...filters: unknown[]) => filters,
  prisma: {
    orm: {
      public: {
        PostMedia: {
          select: () => ({
            where: () => ({
              all: () => Promise.resolve(candidateRows),
              limit: () => ({
                all: () => Promise.resolve(candidateRows),
              }),
              orderBy: () => ({
                all: () => Promise.resolve(candidateRows),
                limit: () => ({
                  all: () => Promise.resolve(candidateRows),
                }),
              }),
            }),
          }),
        },
      },
    },
  },
  redis: {},
  toPrismaDateTime: (value: Date) => value,
}));

const {
  MAX_TRANSCRIPTION_BACKFILL_ATTEMPTS,
  TRANSCRIPTION_BACKFILL_RETRY_WINDOW_MS,
  semanticClassificationBackfillSweep,
  transcriptionBackfillSweep,
} = await import("./index");

describe("transcriptionBackfillSweep loop prevention", () => {
  beforeEach(() => {
    backfillEnabled = true;
    geminiApiKey = "mock-gemini-key";
    whisperEnabled = true;
    candidateRows = [];
    enqueuedIds.length = 0;
    semanticRefreshIds.length = 0;
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

  test("does not repeat checkpointed silence while classification is delayed", async () => {
    candidateRows = [
      {
        id: "checkpointed",
        techMetadata: {
          analysisStages: { transcription: { status: "silent", version: 1 } },
        },
      },
    ];
    expect(await transcriptionBackfillSweep()).toEqual({ enqueued: 0 });
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

  test("returns 0 and performs no work when GEMINI_API_KEY is not configured", async () => {
    geminiApiKey = undefined;
    candidateRows = [{ id: "fresh-vid", techMetadata: null }];

    const result = await transcriptionBackfillSweep();
    expect(result.enqueued).toBe(0);
    expect(enqueuedIds).toHaveLength(0);
  });

  test("returns 0 and performs no work when WHISPER_ENABLED is false", async () => {
    whisperEnabled = false;
    candidateRows = [{ id: "fresh-vid", techMetadata: null }];

    const result = await transcriptionBackfillSweep();
    expect(result.enqueued).toBe(0);
    expect(enqueuedIds).toHaveLength(0);
  });

  test("skips media permanently classified as skipped in transcription or analysisStages", async () => {
    candidateRows = [
      {
        id: "skipped-vid-1",
        techMetadata: {
          transcription: {
            attemptedAt: new Date().toISOString(),
            status: "skipped",
          },
        },
      },
      {
        id: "skipped-vid-2",
        techMetadata: {
          analysisStages: {
            transcription: {
              status: "skipped",
              version: 1,
            },
          },
        },
      },
    ];

    const result = await transcriptionBackfillSweep();
    expect(result.enqueued).toBe(0);
    expect(enqueuedIds).toHaveLength(0);
  });

  test("respects analysisStages.transcription attempts and retry windows", async () => {
    candidateRows = [
      {
        id: "recent-analysis-failure",
        techMetadata: {
          analysisStages: {
            transcription: {
              attemptedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
              attempts: 1,
              status: "failed",
            },
          },
        },
      },
      {
        id: "exhausted-analysis-failure",
        techMetadata: {
          analysisStages: {
            transcription: {
              attemptedAt: new Date(
                Date.now() - 24 * 60 * 60 * 1000
              ).toISOString(),
              attempts: MAX_TRANSCRIPTION_BACKFILL_ATTEMPTS,
              status: "failed",
            },
          },
        },
      },
    ];

    const result = await transcriptionBackfillSweep();
    expect(result.enqueued).toBe(0);
    expect(enqueuedIds).toHaveLength(0);
  });

  test("backfills media that has not received the current semantic classifier", async () => {
    candidateRows = [
      { id: "legacy-image", techMetadata: null },
      {
        id: "current-image",
        techMetadata: {
          semanticClassificationVersion: "clef-flash-v4-model-topics",
        },
      },
    ];

    const result = await semanticClassificationBackfillSweep();

    expect(result.enqueued).toBe(1);
    expect(semanticRefreshIds).toEqual(["legacy-image"]);
  });
});
