import { afterEach, describe, expect, mock, test } from "bun:test";

const configuration = {
  EMBEDDING_ENABLED: true,
  EMBEDDING_TIMEOUT_MS: 15_000,
  GEMINI_API_KEY: "test-key",
  GEMINI_EMBEDDING_MODEL: "gemini-embedding-2",
};
mock.module("../env", () => ({ workerEnv: configuration }));
const {
  cosineSimilarity,
  EMBEDDING_DIMENSION,
  generateTextEmbedding,
  normalizeVector,
} = await import("./embedding");
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  configuration.GEMINI_API_KEY = "test-key";
});
function respond(values: number[], status = 200) {
  globalThis.fetch = Object.assign(
    () => Promise.resolve(Response.json({ embedding: { values } }, { status })),
    { preconnect: originalFetch.preconnect }
  );
}
describe("generateTextEmbedding", () => {
  test("normalizes only a valid provider vector and requests 384 dimensions", async () => {
    let request: Record<string, unknown> = {};
    globalThis.fetch = Object.assign(
      (_input: Parameters<typeof fetch>[0], options?: RequestInit) => {
        request = JSON.parse(String(options?.body));
        return Promise.resolve(
          Response.json({
            embedding: {
              values: Array.from({ length: EMBEDDING_DIMENSION }, () => 2),
            },
          })
        );
      },
      { preconnect: originalFetch.preconnect }
    );
    const vector = await generateTextEmbedding("Linux homelab");
    expect(request.outputDimensionality).toBe(384);
    expect(vector).toHaveLength(384);
    expect(Math.hypot(...vector)).toBeCloseTo(1, 5);
  });
  test("missing credentials leave embeddings pending without local hashes", async () => {
    configuration.GEMINI_API_KEY = "";
    expect(await generateTextEmbedding("Linux homelab")).toEqual([]);
  });
  test("provider failures leave embeddings pending", async () => {
    respond([], 429);
    expect(await generateTextEmbedding("Linux homelab")).toEqual([]);
  });
  test.each(
    [
      [1, 2],
      Array.from({ length: 384 }, () => 0),
      Array.from({ length: 384 }, () => Number.NaN),
    ].map((values) => [values])
  )("rejects malformed or zero vectors", async (values) => {
    respond(values);
    expect(await generateTextEmbedding("Linux homelab")).toEqual([]);
  });
  test("empty input makes no inference request", async () => {
    const fetchMock = mock(() =>
      Promise.reject(new Error("unexpected inference"))
    );
    globalThis.fetch = Object.assign(fetchMock, {
      preconnect: originalFetch.preconnect,
    });
    const vector = await generateTextEmbedding("   ");
    expect(vector).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cosineSimilarity", () => {
  test("identical vectors have similarity 1.0", () => {
    const v = normalizeVector([1, 2, 3, 4]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  test("orthogonal vectors have similarity 0.0", () => {
    const v1 = [1, 0];
    const v2 = [0, 1];
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0, 5);
  });

  test("opposite vectors have similarity -1.0", () => {
    const v1 = [1, 0];
    const v2 = [-1, 0];
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1, 5);
  });
});
