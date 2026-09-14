import { beforeEach, describe, expect, mock, test } from "bun:test";

const redisEval = mock<(...args: (number | string)[]) => number>(
  (..._args) => 12
);
const redisHmget = mock<(key: string, ...terms: string[]) => string[]>(
  (_key, ...terms) => terms.map(() => "1")
);

mock.module("@asm/db", () => ({
  globalKnowledgeGraph: {},
  redis: {
    eval: redisEval,
    hmget: redisHmget,
  },
}));

const { extractTextTopicsWithSharedStatistics } = await import("./classify");

describe("extractTextTopicsWithSharedStatistics", () => {
  beforeEach(() => {
    redisEval.mockClear();
    redisHmget.mockClear();
    redisEval.mockImplementation((..._args) => 12);
  });

  test("updates and reads shared corpus statistics", async () => {
    const topics = await extractTextTopicsWithSharedStatistics(
      "A rare astrophotography lens captures nebula detail"
    );

    expect(topics).toContain("astrophotography");
    expect(redisEval).toHaveBeenCalledTimes(1);
    expect(redisHmget).toHaveBeenCalledTimes(1);
  });

  test("falls back to local statistics when shared storage is unavailable", async () => {
    redisEval.mockImplementationOnce(() => {
      throw new Error("redis unavailable");
    });

    const topics = await extractTextTopicsWithSharedStatistics(
      "A local fallback preserves astrophotography topics"
    );

    expect(topics).toContain("astrophotography");
    expect(redisHmget).not.toHaveBeenCalled();
  });
});
