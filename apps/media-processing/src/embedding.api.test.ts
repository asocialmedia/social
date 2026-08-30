import { describe, expect, test } from "bun:test";

// Opt-in integration test for the Gemini embedding branch: runs only when
// GEMINI_API_KEY is set in the environment (local dev), skipped in CI where
// the env is clean. Asserts the contract the recommendation engine depends
// on - exactly EMBEDDING_DIMENSION values, normalized - so Gemini vectors and
// local hash vectors remain one comparable space.
const REAL_GEMINI_KEY = process.env.GEMINI_API_KEY;

const { EMBEDDING_DIMENSION, generateTextEmbedding } =
  await import("./embedding");

describe.skipIf(!REAL_GEMINI_KEY)(
  "generateTextEmbedding Gemini API path",
  () => {
    test(
      "requests the Gemini endpoint and returns an exact-dimension unit vector",
      async () => {
        // Spy on fetch without intercepting: the real request must go out and
        // the implementation must consume the API response. A silent fallback
        // to the local hash embedder (timeout, auth failure, malformed body)
        // makes these assertions fail even though the vector shape is valid.
        const geminiCalls: { ok: boolean; url: string }[] = [];
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
          const response = await realFetch(...args);
          const request = new Request(
            args[0] instanceof Request
              ? args[0].url
              : (args[0] as RequestInfo | URL).toString()
          );
          if (request.url.includes("generativelanguage.googleapis.com")) {
            geminiCalls.push({ ok: response.ok, url: request.url });
          }
          return response;
        }) as typeof fetch;

        try {
          const embedding = await generateTextEmbedding(
            "Kubernetes cluster autoscaling with spot instances"
          );

          // The delegated request must have reached the Gemini embedding
          // endpoint and succeeded - no local fallback happened.
          expect(geminiCalls.length).toBeGreaterThan(0);
          expect(geminiCalls[0]?.url).toContain(
            "generativelanguage.googleapis.com/v1beta/models/"
          );
          expect(geminiCalls[0]?.url).toContain(":embedContent");
          expect(geminiCalls[0]?.ok).toBe(true);

          expect(embedding.length).toBe(EMBEDDING_DIMENSION);
          let norm = 0;
          for (const val of embedding) {
            norm += val * val;
          }
          expect(Math.sqrt(norm)).toBeCloseTo(1, 4);
        } finally {
          globalThis.fetch = realFetch;
        }
      },
      { timeout: 30_000 }
    );

    test(
      "identical text embeddings are near-identical vectors",
      async () => {
        const a = await generateTextEmbedding("homelab linux server");
        const b = await generateTextEmbedding("homelab linux server");
        let dot = 0;
        for (let i = 0; i < a.length; i += 1) {
          dot += (a[i] ?? 0) * (b[i] ?? 0);
        }
        expect(dot).toBeGreaterThan(0.99);
      },
      { timeout: 30_000 }
    );
  }
);

// Placeholder describe keeps the file meaningful when skipped: the contract
// (dimension + normalization) is enforced for the local path in
// embedding.test.ts.
describe("embedding module contract", () => {
  test("EMBEDDING_DIMENSION is 384", () => {
    expect(EMBEDDING_DIMENSION).toBe(384);
  });
});
