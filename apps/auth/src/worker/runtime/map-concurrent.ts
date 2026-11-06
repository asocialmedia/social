export async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  if (values.length === 0) {
    return [];
  }

  const workItems = values.map((value, index) => ({ index, value }));
  const results: ({ state: "complete"; value: R } | { state: "pending" })[] =
    values.map(() => ({ state: "pending" }));
  let nextIndex = 0;
  let hasFailure = false;
  let failure: unknown;

  const runWorker = async () => {
    while (!hasFailure) {
      const index = nextIndex;
      nextIndex += 1;
      const item = workItems[index];
      if (!item) {
        return;
      }
      try {
        results[item.index] = {
          state: "complete",
          // oxlint-disable-next-line no-await-in-loop -- each mapper completes before this worker claims its next slot
          value: await mapper(item.value, item.index),
        };
      } catch (error) {
        if (!hasFailure) {
          failure = error;
          hasFailure = true;
        }
        return;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      runWorker()
    )
  );
  if (hasFailure) {
    throw failure;
  }
  return results.map((result) => {
    if (result.state === "pending") {
      throw new Error("concurrent mapper finished without producing a result");
    }
    return result.value;
  });
}
