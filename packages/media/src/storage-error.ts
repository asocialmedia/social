export function isStorageBucketMissing(error: unknown): boolean {
  let current = error;
  for (
    let depth = 0;
    depth < 5 && current && typeof current === "object";
    depth += 1
  ) {
    const { Code, code, name, cause } = current as {
      Code?: unknown;
      code?: unknown;
      name?: unknown;
      cause?: unknown;
    };
    if ([Code, code, name].includes("NoSuchBucket")) {
      return true;
    }
    current = cause;
  }
  return false;
}
