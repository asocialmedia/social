import { expect, mock, test } from "bun:test";

const members = new Map<string, Set<string>>();
const buckets = new Map<string, Map<string, number>>();
const batch = {
  del: (key: string) => {
    members.delete(key);
    return batch;
  },
  exec: () => Promise.resolve([]),
  sadd: (key: string, ...values: string[]) => {
    members.set(key, new Set(values));
    return batch;
  },
  zadd: (key: string, score: number, id: string) => {
    const entries = buckets.get(key) ?? new Map();
    entries.set(id, score);
    buckets.set(key, entries);
    return batch;
  },
  zrem: (key: string, id: string) => {
    buckets.get(key)?.delete(id);
    return batch;
  },
  zremrangebyrank: () => batch,
};
mock.module("../redis", () => ({
  redis: {
    multi: () => batch,
    smembers: (key: string) => Promise.resolve([...(members.get(key) ?? [])]),
    zrevrange: (key: string) =>
      Promise.resolve(
        [...(buckets.get(key) ?? [])]
          .toSorted((a, b) => b[1] - a[1])
          .map(([id]) => id)
      ),
  },
}));
const { indexPostEmbedding, retrieveSemanticCandidates, semanticBuckets } =
  await import("./semantic-index");
const vector = Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0));

test("semantic buckets are deterministic, reject invalid vectors, and isolate model versions", () => {
  expect(semanticBuckets("model-a", vector)).toEqual(
    semanticBuckets("model-a", vector)
  );
  expect(new Set(semanticBuckets("model-a", vector)).size).toBe(8);
  expect(
    semanticBuckets("model-b", vector).some((key) =>
      semanticBuckets("model-a", vector).includes(key)
    )
  ).toBe(false);
  expect(semanticBuckets("model-a", [1, 0])).toEqual([]);
  expect(
    semanticBuckets(
      "model-a",
      Array.from({ length: 384 }, () => 0)
    )
  ).toEqual([]);
});

test("reindexing a post removes old model memberships and deduplicates retrieval", async () => {
  await indexPostEmbedding("post", "model-a", vector, Date.now());
  expect(await retrieveSemanticCandidates("model-a", vector)).toEqual(["post"]);
  await indexPostEmbedding("post", "model-b", vector, Date.now());
  expect(await retrieveSemanticCandidates("model-a", vector)).toEqual([]);
  expect(await retrieveSemanticCandidates("model-b", vector)).toEqual(["post"]);
});
