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
      "returns an exact-dimension normalized unit vector",
      async () => {
        const embedding = await generateTextEmbedding(
          "Kubernetes cluster autoscaling with spot instances"
        );
        expect(embedding.length).toBe(EMBEDDING_DIMENSION);
        let norm = 0;
        for (const val of embedding) {
          norm += val * val;
        }
        expect(Math.sqrt(norm)).toBeCloseTo(1, 4);
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
