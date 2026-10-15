import { expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "asm-analysis-retry-"));
const sourcePath = path.join(directory, "source.png");
await Bun.write(sourcePath, "test raster bytes");
const stages: Record<string, unknown> = {};
const row = {
  _type: "IMAGE",
  createdAt: new Date(),
  id: "ocr-recovery",
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
let ocrText = "Music festival";
let classificationAttempts = 0;
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
    if (ocrAttempts === 1) {
      return Promise.reject(new Error("Cloud Vision quota exhausted"));
    }
    return Promise.resolve({ modelVersion: "vision:test", text: ocrText });
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
      tags: ["music"],
    });
  },
}));

test("OCR failures preserve labels and retry missing text; completed OCR is reused", async () => {
  try {
    const { processMediaAnalyze } = await import("./analyze");
    await expect(processMediaAnalyze({ mediaId: row.id })).rejects.toThrow(
      "Cloud Vision quota exhausted"
    );
    expect(row.semanticTags).toEqual(["music"]);
    expect(row.status).toBe("READY");
    expect(stages.ocr).toBeUndefined();
    await processMediaAnalyze({ mediaId: row.id });
    expect(row.ocrText).toBe("Music festival");
    expect(stages.ocr).toEqual({
      model: "vision:test",
      status: "completed",
      version: 1,
    });
    expect(classificationInputs[1]?.ocrText).toBe("Music festival");
    await processMediaAnalyze({ mediaId: row.id });
    expect(ocrAttempts).toBe(2);
    expect(downloads).toBe(2);
    expect(classificationAttempts).toBe(2);
    expect(row.techMetadata.codec).toBe("png");

    // Empty text is a completed result too; no paid request on subsequent retries.
    delete stages.ocr;
    for (const key of Object.keys(stages)) {
      if (key.startsWith("ocrFrame-")) {
        Reflect.deleteProperty(stages, key);
      }
    }
    row.ocrText = null;
    ocrText = "";
    await processMediaAnalyze({ mediaId: row.id });
    await processMediaAnalyze({ mediaId: row.id });
    expect(ocrAttempts).toBe(3);
    expect(stages.ocr).toEqual({
      model: "vision:test",
      status: "completed",
      version: 1,
    });
    // Existing local OCR checkpoints are preserved without paying for re-OCR.
    stages.ocr = { model: "ppocrv4-onnx-v1", status: "completed", version: 1 };
    await processMediaAnalyze({ mediaId: row.id });
    expect(ocrAttempts).toBe(3);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}, 30_000);
