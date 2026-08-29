import { describe, expect, test } from "bun:test";

import {
  cosineSimilarity,
  EMBEDDING_DIMENSION,
  generateTextEmbedding,
  normalizeVector,
} from "./embedding";

describe("generateTextEmbedding", () => {
  test("returns vector of exact EMBEDDING_DIMENSION", async () => {
    const embedding = await generateTextEmbedding("Linux homelab server setup");
    expect(embedding.length).toBe(EMBEDDING_DIMENSION);
  });

  test("produces normalized unit vector", async () => {
    const embedding = await generateTextEmbedding(
      "PostgreSQL and Redis high availability"
    );
    let norm = 0;
    for (const val of embedding) {
      norm += val * val;
    }
    expect(Math.sqrt(norm)).toBeCloseTo(1, 4);
  });

  test("similar texts have higher cosine similarity than unrelated texts", async () => {
    const embLinux1 = await generateTextEmbedding(
      "Setting up Ubuntu server with Docker containers and Linux kernel"
    );
    const embLinux2 = await generateTextEmbedding(
      "Deploying Docker containerized apps on Debian Linux servers"
    );
    const embBaking = await generateTextEmbedding(
      "Baking chocolate chip cookies with organic butter and sugar in the kitchen"
    );

    const simRelated = cosineSimilarity(embLinux1, embLinux2);
    const simUnrelated = cosineSimilarity(embLinux1, embBaking);

    expect(simRelated).toBeGreaterThan(simUnrelated);
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
