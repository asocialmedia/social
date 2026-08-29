import { describe, expect, test } from "bun:test";

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let nA = 0;
  let nB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const vA = a[i] ?? 0;
    const vB = b[i] ?? 0;
    dot += vA * vB;
    nA += vA * vA;
    nB += vB * vB;
  }
  if (nA === 0 || nB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB));
}

describe("Related Posts semantic ranking", () => {
  test("ranks higher for aligned embeddings", () => {
    const origin = [1, 0, 0, 0];
    const candidateA = [0.9, 0.1, 0, 0];
    const candidateB = [0, 0, 1, 0];

    const simA = cosineSimilarity(origin, candidateA);
    const simB = cosineSimilarity(origin, candidateB);

    expect(simA).toBeGreaterThan(simB);
    expect(simA).toBeGreaterThan(0.9);
  });

  test("handles empty or mismatched vectors safely", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});
