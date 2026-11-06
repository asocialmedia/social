import { expect, mock, test } from "bun:test";

const enqueue = mock();
const createQueue = mock(() => {
  throw new Error("Remote backfill must not create a queue");
});
mock.module("bullmq", () => ({ Queue: createQueue }));
mock.module("@asm/db", () => ({
  MEDIA_ANALYZE_QUEUE: "test-analysis",
  and: mock(),
  enqueuePostAnalyze: enqueue,
  indexPostEmbedding: mock(),
  prisma: {},
  redis: {},
}));
mock.module("../env", () => ({
  workerEnv: {
    BACKFILL_ENABLED: true,
    CLASSIFY_ENABLED: true,
    CLEF_ENABLED: false,
    CLOUDFLARE_ACCOUNT_ID: "configured",
    CLOUDFLARE_API_TOKEN: "configured",
  },
}));
mock.module("../analyze/embedding/embedding", () => ({
  embeddingModelId: () => "test-model",
}));
mock.module("../jobs/analysis/analyze-post", () => ({
  postAnalysisFingerprint: () => "test-fingerprint",
}));
const { postClassificationSweep } = await import("./post-classification");

test("provider credentials alone cannot enable remote post backfills", async () => {
  expect(await postClassificationSweep()).toEqual({ enqueued: 0 });
  expect(createQueue).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
});
