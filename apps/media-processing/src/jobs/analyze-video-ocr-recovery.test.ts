import { expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

const directory = await mkdtemp(path.join(tmpdir(), "asm-analysis-retry-"));
const sourcePath = path.join(directory, "source.png");
await sharp({ create: { background: "red", channels: 3, height: 8, width: 8 } })
  .png()
  .toFile(sourcePath);
const stages: Record<string, unknown> = {};
const row = {
  _type: "VIDEO",
  createdAt: new Date(),
  id: "video-ocr-recovery",
  key: "image.png",
  ocrText: null as string | null,
  originalKey: "private-original.png",
  post: null,
  postMediaDerivatives: [{ key: "poster.png", kind: "poster" }],
  publishedKey: "image.png",
  safety: null,
  semanticTags: new Array<string>(),
  semantics: null,
  status: "READY",
  techMetadata: { analysisStages: stages, codec: "png" },
  transcript: null as string | null,
  userId: null,
};
let downloads = 0;
let ocrAttempts = 0;
let failSampling = false;

let classificationAttempts = 0;
let classificationTags = ["music"];
const classificationInputs: { ocrText?: string | null }[] = [];
const builder = {
  first: () => Promise.resolve(row),
  include: () => builder,
  update: (data: Record<string, unknown>) => {
    Object.assign(row, data);
    return Promise.resolve(row);
  },
  where: () => builder,
};
mock.module("@asm/db", () => ({
  and: (...values: unknown[]) => values,
  indexPostEmbedding: () => Promise.resolve(),
  patchMediaAnalysisMetadata: (
    _id: string,
    metadata: Record<string, unknown>
  ) => {
    Object.assign(row.techMetadata, metadata);
    return Promise.resolve();
  },
  patchMediaAnalysisStage: (_id: string, stage: string, value: unknown) => {
    stages[stage] = value;
    return Promise.resolve();
  },
  prisma: {
    orm: {
      public: { PostMedia: { select: () => builder, where: () => builder } },
    },
  },
  recordSharedTopicRelations: () => Promise.resolve(),
  redis: {},
}));
mock.module("../env", () => ({
  workerEnv: {
    EMBEDDING_ENABLED: false,
    MULTIMODAL_EMBEDDING_ENABLED: false,
    OCR_ENABLED: true,
    VIDEO_OCR_FRAMES: 2,
    WHISPER_ENABLED: false,
  },
}));
mock.module("../log", () => ({
  mediaLogger: { info: () => {}, warn: () => {} },
  withSpan: (_name: string, run: () => Promise<unknown>) => run(),
}));
mock.module("../metrics", () => ({
  recordMediaMetric: () => Promise.resolve(),
}));
mock.module("../s3", () => ({
  getS3: () => ({
    file: () => {
      downloads += 1;
      return Bun.file(sourcePath);
    },
  }),
}));
mock.module("../analyze/clef", () => ({
  ClefDeferredError: class extends Error {},
  prepareClefImage: () => Promise.resolve(Buffer.alloc(0)),
}));
mock.module("../analyze/embedding", () => ({
  embeddingModelId: () => "test:v1",
  generateTextEmbedding: () => Promise.resolve([]),
  normalizeVector: (vector: number[]) => vector,
}));
mock.module("../analyze/ocr", () => ({
  extractImageText: () => {
    ocrAttempts += 1;
    if (ocrAttempts === 2) {
      return Promise.reject(new Error("Cloud Vision quota exhausted"));
    }
    return Promise.resolve({
      modelVersion: "vision:test",
      text: ocrAttempts === 1 ? "Poster text" : "Scene text",
    });
  },
}));
mock.module("../analyze/video-samples", () => ({
  extractVideoSamples: async (input: string, paths: string[]) => {
    if (failSampling) {
      throw new Error("ffmpeg timed out after 15000ms");
    }
    const scene = `${input}-scene.jpg`;
    paths.push(scene);
    await Bun.write(scene, "different scene raster");
  },
}));
mock.module("../analyze/transcribe", () => ({
  transcribeMediaAudio: () => Promise.resolve(null),
}));
mock.module("../analyze/classify", () => ({
  classifyMediaConcepts: (input: { ocrText?: string | null }) => {
    classificationInputs.push(input);
    classificationAttempts += 1;
    return Promise.resolve({
      safety: { explicit: false },
      semantics: { model: "test" },
      tags: classificationTags,
    });
  },
}));

test("video OCR resumes after a partial quota failure without paying for the completed frame again", async () => {
  try {
    const { processMediaAnalyze } = await import("./analyze");
    await expect(processMediaAnalyze({ mediaId: row.id })).rejects.toThrow(
      "Cloud Vision quota exhausted"
    );
    expect(ocrAttempts).toBe(2);
    expect(
      Object.keys(stages).filter((key) => key.startsWith("ocrFrame-"))
    ).toHaveLength(1);
    expect(stages.ocr).toBeUndefined();
    expect(row.status).toBe("READY");
    await processMediaAnalyze({ mediaId: row.id });
    expect(ocrAttempts).toBe(3);
    expect(row.ocrText).toBe("Poster text\nScene text");
    expect(stages.ocr).toMatchObject({ status: "completed" });
    expect(classificationInputs.at(-1)?.ocrText).toBe(
      "Poster text\nScene text"
    );
    await processMediaAnalyze({ mediaId: row.id });
    expect(ocrAttempts).toBe(3);
    expect(classificationAttempts).toBe(2);
    expect(downloads).toBe(4);
    failSampling = true;
    Object.assign(row, { ocrText: null });
    delete stages.ocr;
    Object.assign(row.techMetadata, { semanticClassificationVersion: "old" });
    await expect(processMediaAnalyze({ mediaId: row.id })).resolves.toEqual({
      outcome: "analyzed",
    });
    expect(row.ocrText).toBe("Poster text");
    expect(row.status).toBe("READY");
    classificationTags = [];
    Object.assign(row.techMetadata, { semanticClassificationVersion: "old" });
    await processMediaAnalyze({ mediaId: row.id, semanticRefresh: true });
    expect(row.semanticTags).toEqual([]);
    // Unchanged corrupt sources stop repeated queue retries and scheduled backfills.
    row._type = "IMAGE";
    Object.assign(row.techMetadata, { semanticClassificationVersion: "old" });
    await Bun.write(sourcePath, "corrupt image bytes");
    await expect(
      processMediaAnalyze({ mediaId: row.id, semanticRefresh: true })
    ).rejects.toMatchObject({ name: "UnrecoverableError" });
    expect(stages.raster).toMatchObject({ status: "unavailable" });
    const beforeRetry = downloads;
    await expect(
      processMediaAnalyze({ mediaId: row.id, semanticRefresh: true })
    ).resolves.toEqual({ outcome: "skipped" });
    expect(downloads).toBe(beforeRetry);
    expect(row.status).toBe("READY");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}, 30_000);
