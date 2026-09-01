import { describe, expect, test } from "bun:test";

import {
  computeCentroid,
  cosineSimilarity,
  EMBEDDING_DIMENSION,
  generateLocalEmbedding,
  normalizeVector,
} from "./vector";

describe("vector math", () => {
  test("cosineSimilarity calculates expected values", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];
    const v4 = [-1, 0, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0);
    expect(cosineSimilarity(v1, v4)).toBeCloseTo(-1);
    expect(cosineSimilarity([], v2)).toBe(0);
    expect(cosineSimilarity(null, v2)).toBe(0);
    expect(cosineSimilarity(v1, [1, 0])).toBe(0);
  });

  test("normalizeVector scales to unit length", () => {
    const norm = normalizeVector([3, 4]);
    expect(norm[0]).toBeCloseTo(0.6);
    expect(norm[1]).toBeCloseTo(0.8);
    expect(norm[0] * norm[0] + norm[1] * norm[1]).toBeCloseTo(1);
  });

  test("computeCentroid averages and weights vectors", () => {
    const v1 = Array.from({ length: EMBEDDING_DIMENSION }).fill(0) as number[];
    const v2 = Array.from({ length: EMBEDDING_DIMENSION }).fill(0) as number[];
    v1[0] = 1;
    v2[1] = 1;

    const centroid = computeCentroid([v1, v2], [1, 1]);
    expect(centroid.length).toBe(EMBEDDING_DIMENSION);
    expect(centroid[0]).toBeCloseTo(centroid[1] ?? 0);
  });

  test("generateLocalEmbedding produces deterministic 384-dim unit vector", () => {
    const e1 = generateLocalEmbedding(
      "Linux homelab setup and docker containers"
    );
    const e2 = generateLocalEmbedding(
      "Linux homelab setup and docker containers"
    );
    const e3 = generateLocalEmbedding("Anime waifu cosplay drawing tutorial");

    expect(e1.length).toBe(EMBEDDING_DIMENSION);
    expect(e2.length).toBe(EMBEDDING_DIMENSION);
    expect(cosineSimilarity(e1, e2)).toBeCloseTo(1);

    const simDifferent = cosineSimilarity(e1, e3);
    expect(simDifferent).toBeLessThan(0.7);
  });
});
