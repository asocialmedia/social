import { afterEach, describe, expect, mock, test } from "bun:test";

import { EmbeddingDeferredError } from "./deferred";

const configuration = {
  EMBEDDING_ENABLED: true,
  EMBEDDING_TIMEOUT_MS: 15_000,
  GEMINI_API_KEY: "test-key",
  GEMINI_EMBEDDING_MODEL: "gemini-embedding-2",
};
mock.module("../../env", () => ({ workerEnv: configuration }));
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

async function expectDeferred(
  reason: EmbeddingDeferredError["reason"],
  cooldown: number
) {
  const started = Date.now();
  try {
    await generateTextEmbedding("Linux homelab");
    throw new Error("Expected a deferral");
  } catch (error) {
    expect(error).toBeInstanceOf(EmbeddingDeferredError);
    if (!(error instanceof EmbeddingDeferredError)) {
      throw error;
    }
    expect(error.reason).toBe(reason);
    expect(error.retryAt).toBeGreaterThanOrEqual(started + cooldown);
    expect(error.retryAt).toBeLessThanOrEqual(Date.now() + cooldown);
  }
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
    await expectDeferred("credentials", 86_400_000);
  });
  test("provider failures leave embeddings pending", async () => {
    respond([], 429);
    await expectDeferred("provider", 900_000);
  });
  test.each(
    [
      [1, 2],
      Array.from({ length: 384 }, () => 0),
      Array.from({ length: 384 }, () => Number.NaN),
    ].map((values) => [values])
  )("rejects malformed or zero vectors", async (values) => {
    respond(values);
    await expectDeferred("invalid-vector", 900_000);
  });
  test("a response cancellation failure cannot discard the provider Retry-After", async () => {
    globalThis.fetch = Object.assign(
      () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              cancel() {
                throw new Error("stream failed");
              },
            }),
            { headers: { "retry-after": "120" }, status: 429 }
          )
        ),
      { preconnect: originalFetch.preconnect }
    );
    await expectDeferred("provider", 120_000);
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
