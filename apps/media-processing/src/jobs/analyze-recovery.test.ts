import { expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "asm-analysis-retry-"));
const sourcePath = path.join(directory, "source.mp3");
await Bun.write(sourcePath, "test audio bytes");
const stages: Record<string, unknown> = {};
const row = {
  _type: "AUDIO",
  createdAt: new Date(),
  id: "audio-no-cover",
  key: "audio.mp3",
  ocrText: null,
  originalKey: "private-original.mp3",
  post: null,
  postMediaDerivatives: [],
  publishedKey: "audio.mp3",
  safety: null,
  semanticTags: new Array<string>(),
  semantics: null,
  status: "READY",
  techMetadata: { analysisStages: stages, codec: "mp3" },
  transcript: null as string | null,
  userId: null,
};
let downloads = 0;
let transcriptions = 0;
let classificationAttempts = 0;
const classificationInputs: { transcript?: string | null }[] = [];
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
}));
mock.module("../env", () => ({
  workerEnv: {
    EMBEDDING_ENABLED: false,
    MULTIMODAL_EMBEDDING_ENABLED: false,
    WHISPER_ENABLED: true,
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
  extractImageText: () => Promise.resolve(null),
}));
mock.module("../analyze/transcribe", () => ({
  transcribeMediaAudio: () => {
    transcriptions += 1;
    return Promise.resolve({
      captionsKey: null,
      status: "completed",
      transcript: "An interview about music",
    });
  },
}));
mock.module("../analyze/classify", () => ({
  classifyMediaConcepts: (input: { transcript?: string | null }) => {
    classificationInputs.push(input);
    classificationAttempts += 1;
    if (classificationAttempts === 1) {
      return Promise.reject(new Error("provider quota exhausted"));
    }
    return Promise.resolve({
      safety: { explicit: false },
      semantics: { model: "test" },
      tags: ["music"],
    });
  },
}));

test("audio without a cover checkpoints transcription before classification fails and reuses it on retry", async () => {
  try {
    const { processMediaAnalyze } = await import("./analyze");
    await expect(processMediaAnalyze({ mediaId: row.id })).rejects.toThrow(
      "provider quota exhausted"
    );
    expect(row.transcript).toBe("An interview about music");
    expect(stages.transcription).toEqual({ status: "completed", version: 1 });
    expect(await processMediaAnalyze({ mediaId: row.id })).toEqual({
      outcome: "analyzed",
    });
    expect(transcriptions).toBe(1);
    expect(downloads).toBe(1);
    expect(classificationInputs[1]?.transcript).toBe(
      "An interview about music"
    );
    expect(row.semanticTags).toEqual(["music"]);
    expect(row.techMetadata.codec).toBe("mp3");
    await processMediaAnalyze({ mediaId: row.id });
    expect(classificationAttempts).toBe(2);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}, 30_000);
