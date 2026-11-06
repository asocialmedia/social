import { beforeEach, describe, expect, mock, test } from "bun:test";

const storedPost = {
  content: "Illustrated adult content",
  embedding: null as number[] | null,
  embeddingFingerprint: null as string | null,
  embeddingModel: null as string | null,
  id: "post-test",
  moderated: false,
  postMedias: [],
  postToTags: [],
  semanticTags: [] as string[],
};
let explicit = true;
let lockAvailable = true;
let updateCount = 1;
const updates: Record<string, unknown>[] = [];
const markers = new Map<string, string>();
const settings = { CLASSIFY_ENABLED: true, EMBEDDING_ENABLED: true };
let embeddingFailure = false;
let classificationFailure = false;
const classify = mock(() => {
  if (classificationFailure) {
    throw new Error("Clef disabled; classification pending");
  }
  return { tags: ["anime"] };
});
const generateEmbedding = mock(() =>
  embeddingFailure
    ? Promise.reject(new Error("Gemini budget pending"))
    : Promise.resolve([0.5, 0.5])
);
mock.module("../../env", () => ({ workerEnv: settings }));
mock.module("../../analyze/embedding/embedding", () => ({
  embeddingModelId: () => "google:gemini-embedding-2:384:v2",
  generateTextEmbedding: generateEmbedding,
}));
mock.module("../../analyze/classification/clef", () => ({
  CLEF_POLICY_VERSION: "clef-flash-v2",
  ClefDeferredError: class extends Error {},
  clefSafetyVerdict: () => ({ explicit }),
  evaluateClef: classify,
}));
const builder = {
  first: () => storedPost,
  include: (..._args: unknown[]) => builder,
  updateAndCount: (data: Record<string, unknown>) => {
    updates.push(data);
    if (updateCount > 0) {
      Object.assign(storedPost, data);
    }
    return updateCount;
  },
  where: (..._args: unknown[]) => builder,
};
mock.module("@asm/db", () => ({
  and: (...args: unknown[]) => args,
  generateLocalEmbedding: () => [1, 0],
  indexPostEmbedding: () => Promise.resolve(),
  prisma: {
    orm: {
      public: {
        Posts: {
          select: (..._args: unknown[]) => builder,
          where: (..._args: unknown[]) => builder,
        },
      },
    },
  },
  recordSharedTopicRelations: () => Promise.resolve(),
  redis: {
    eval: () => 1,
    get: (key: string) => markers.get(key) ?? null,
    set: (key: string, value: string, ..._args: unknown[]) => {
      if (key.startsWith("lock:")) {
        return lockAvailable ? "OK" : null;
      }
      markers.set(key, value);
      return "OK";
    },
  },
}));
const { processPostAnalyze, postAnalysisFingerprint } =
  await import("./analyze-post");
beforeEach(() => {
  updates.length = 0;
  markers.clear();
  explicit = true;
  lockAvailable = true;
  updateCount = 1;
  storedPost.moderated = false;
  embeddingFailure = false;
  classificationFailure = false;
  storedPost.embedding = null;
  storedPost.embeddingFingerprint = null;
  storedPost.embeddingModel = null;
  storedPost.semanticTags = [];
  classify.mockClear();
  generateEmbedding.mockClear();
});
describe("Clef post enrichment policy", () => {
  test("disabled Clef keeps classification pending while independent embeddings are saved", async () => {
    classificationFailure = true;
    await expect(processPostAnalyze({ postId: storedPost.id })).rejects.toThrow(
      "classification pending"
    );
    expect(storedPost.embedding).toEqual([0.5, 0.5]);
    expect(storedPost.semanticTags).toEqual([]);
    expect(markers.size).toBe(0);
  });
  test("an old media embedding cannot satisfy a changed topic input after embedding failure", async () => {
    storedPost.embedding = [1, 0];
    storedPost.embeddingModel = "google:gemini-embedding-2:384:v2";
    storedPost.embeddingFingerprint = "previous-media-input";
    embeddingFailure = true;
    await expect(processPostAnalyze({ postId: storedPost.id })).rejects.toThrow(
      "Gemini budget pending"
    );
    await expect(processPostAnalyze({ postId: storedPost.id })).rejects.toThrow(
      "Gemini budget pending"
    );
    expect(classify).toHaveBeenCalledTimes(1);
    expect(generateEmbedding).toHaveBeenCalledTimes(2);
    embeddingFailure = false;
    await processPostAnalyze({ postId: storedPost.id });
    expect(storedPost.embedding).toEqual([0.5, 0.5]);
    await processPostAnalyze({ postId: storedPost.id });
    expect(generateEmbedding).toHaveBeenCalledTimes(3);
  });
  test("embedding quota preserves classification, and a stale completion marker cannot hide missing vectors", async () => {
    embeddingFailure = true;
    await expect(processPostAnalyze({ postId: storedPost.id })).rejects.toThrow(
      "Gemini budget pending"
    );
    expect(updates[0]).toMatchObject({
      explicitContent: true,
      semanticTags: ["anime"],
    });
    expect(markers.get(`media:clef:post:${storedPost.id}`)).toBe(
      postAnalysisFingerprint(storedPost.content)
    );
    await expect(processPostAnalyze({ postId: storedPost.id })).rejects.toThrow(
      "Gemini budget pending"
    );
    expect(classify).toHaveBeenCalledTimes(1);
    embeddingFailure = false;
    classify.mockClear();
    await processPostAnalyze({ postId: storedPost.id });
    expect(updates.at(-1)).toHaveProperty("embedding", [0.5, 0.5]);
    expect(classify).not.toHaveBeenCalled();
  });
  test("NSFW is labeled explicit without moderation or a penalty", async () => {
    await processPostAnalyze({ postId: storedPost.id });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      embedding: [0.5, 0.5],
      embeddingFingerprint: expect.any(String),
      embeddingModel: "google:gemini-embedding-2:384:v2",
      explicitContent: true,
      semanticTags: ["anime"],
    });
    expect(updates[0]).not.toHaveProperty("moderated");
    expect(markers.size).toBe(1);
  });
  test("a nonexplicit decision cannot clear an author's manual explicit flag", async () => {
    explicit = false;
    await processPostAnalyze({ postId: storedPost.id });
    expect(updates[0]).not.toHaveProperty("explicitContent");
  });
  test("a concurrent edit is never marked as analyzed from stale content", async () => {
    updateCount = 0;
    await processPostAnalyze({ postId: storedPost.id });
    expect(markers.size).toBe(0);
  });
  test("busy aggregation defers instead of racing sibling media updates", async () => {
    lockAvailable = false;
    await expect(
      processPostAnalyze({ postId: storedPost.id })
    ).rejects.toThrow();
    expect(updates).toHaveLength(0);
  });
});
