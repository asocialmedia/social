// Ranking vectors are server features; preserve the public shape without transferring them to every reader.
export function feedPostView<
  T extends {
    embedding: unknown;
    embeddingFingerprint: unknown;
    embeddingModel: unknown;
  },
>(post: T) {
  return {
    ...post,
    embedding: [],
    embeddingFingerprint: null,
    embeddingModel: null,
  };
}
