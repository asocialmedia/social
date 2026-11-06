import { expect, mock, test } from "bun:test";

const stages: Record<string, unknown> = {};
const row = {
  _type: "AUDIO",
  createdAt: new Date(),
  id: "audio-embedding-recovery",
  key: "audio",
  ocrText: null,
  originalKey: null,
  post: { id: "post-embedding-recovery" },
  postMediaDerivatives: [],
  publishedKey: "audio",
  safety: null,
  semanticTags: [] as string[],
  semantics: null,
  status: "READY",
  techMetadata: { analysisStages: stages },
  transcript: null,
};
const post = {
  content: "Music discussion",
  embedding: null as number[] | null,
  embeddingFingerprint: null as string | null,
  embeddingModel: null as string | null,
  id: row.post.id,
  postMedias: [row],
  postToTags: [],
  semanticTags: [] as string[],
};
function builderFor<T extends object>(value: T) {
  const builder = {
    first: () => Promise.resolve(value),
    include: () => builder,
    update: (data: Record<string, unknown>) => {
      Object.assign(value, data);
      return Promise.resolve(value);
    },
    where: () => builder,
  };
  return builder;
}
const mediaBuilder = builderFor(row);
const postBuilder = builderFor(post);
mock.module("@asm/db", () => ({
  and: (...values: unknown[]) => values,
  enqueueMediaDeleteCascade: () => Promise.resolve(),
  indexPostEmbedding: () => Promise.resolve(),
  patchMediaAnalysisMetadata: (_id: string, patch: Record<string, unknown>) => {
    Object.assign(row.techMetadata, patch);
    return Promise.resolve();
  },
  patchMediaAnalysisStage: (_id: string, name: string, stage: unknown) => {
    stages[name] = stage;
    return Promise.resolve();
  },
  prisma: {
    orm: {
      public: {
        PostMedia: { select: () => mediaBuilder, where: () => mediaBuilder },
        Posts: { select: () => postBuilder, where: () => postBuilder },
      },
    },
  },
  recordSharedTopicRelations: () => Promise.resolve(),
  redis: { eval: () => Promise.resolve(1), set: () => Promise.resolve("OK") },
}));
mock.module("../../env", () => ({
  workerEnv: {
    EMBEDDING_ENABLED: true,
    MULTIMODAL_EMBEDDING_ENABLED: false,
    OCR_ENABLED: false,
    WHISPER_ENABLED: false,
  },
}));
mock.module("../../log", () => ({
  mediaLogger: { info: () => {}, warn: () => {} },
  withSpan: (_name: string, run: () => Promise<unknown>) => run(),
}));
mock.module("../../metrics", () => ({
  recordMediaMetric: () => Promise.resolve(),
}));
mock.module("../../s3", () => ({
  getS3: () => {
    throw new Error("No downloads expected");
  },
}));
mock.module("../../analyze/classification/classify", () => ({
  classifyMediaConcepts: () =>
    Promise.reject(new Error("Classification pending")),
}));
mock.module("../../analyze/classification/clef", () => ({
  ClefDeferredError: class extends Error {},
  prepareClefImage: () => Promise.reject(new Error("No images expected")),
}));
const embed = mock(() => Promise.resolve([0.5, 0.5]));
mock.module("../../analyze/embedding/embedding", () => ({
  embeddingModelId: () => "test:v1",
  generateTextEmbedding: embed,
  normalizeVector: (vector: number[]) => vector,
}));

test("media analysis saves and reuses an independent post embedding while classification stays pending", async () => {
  const { processMediaAnalyze } = await import("./analyze");
  await expect(processMediaAnalyze({ mediaId: row.id })).rejects.toThrow(
    "Classification pending"
  );
  expect(post.embedding).toEqual([0.5, 0.5]);
  expect(row.status).toBe("READY");
  expect(row.techMetadata).not.toHaveProperty("semanticClassificationVersion");
  await expect(processMediaAnalyze({ mediaId: row.id })).rejects.toThrow(
    "Classification pending"
  );
  expect(embed).toHaveBeenCalledTimes(1);
});
