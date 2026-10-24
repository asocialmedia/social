import { expect, test } from "bun:test";

import { feedPostView } from "./feed-post-view";

test("feed serialization omits ranking vectors without changing server candidates or reader state", () => {
  const post = {
    content: "A post worth reading",
    embedding: Array.from({ length: 768 }, (_, index) => index / 768),
    embeddingFingerprint: "private-ranking-fingerprint",
    embeddingModel: "ranking-model",
    vote: [{ userId: "viewer", value: 1 }],
  };
  const view = feedPostView(post);
  expect(view.embedding).toEqual([]);
  expect(view.embeddingModel).toBeNull();
  expect(view.embeddingFingerprint).toBeNull();
  expect(view.vote).toBe(post.vote);
  expect(post.embedding).toHaveLength(768);
  expect(JSON.stringify(view).length).toBeLessThan(
    JSON.stringify(post).length / 10
  );
});
