export function isStorageBucketMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const { Code, code, name } = error as {
    Code?: unknown;
    code?: unknown;
    name?: unknown;
  };
  return [Code, code, name].includes("NoSuchBucket");
}
