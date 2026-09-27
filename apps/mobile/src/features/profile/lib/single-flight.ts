// Collapses concurrent work for the same key into one shared promise, so a
// press-in prefetch and the screen that mounts right after it produce a single
// request rather than two racing ones.
//
// Kept as a standalone pure class (no React) so the concurrency contract is
// testable on its own.

export class SingleFlight {
  private inFlight = new Map<string, Promise<void>>();

  // Returns the in-flight promise when one exists, otherwise starts the task.
  // The entry is always released once the task settles, so a failure does not
  // wedge the key and block every later attempt.
  //
  // The single yield before `await task()` is load-bearing. Without it a task
  // that throws synchronously would reach the finally block before the entry is
  // stored below, and the subsequent store would then leave the key stuck in
  // the map, so every later call would join the already-failed promise and
  // silently do nothing.
  run(key: string, task: () => Promise<void> | void): Promise<void> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }
    const request = (async () => {
      try {
        // oxlint-disable-next-line unicorn/no-unnecessary-await -- deliberate microtask yield, see above
        await null;
        await task();
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, request);
    return request;
  }

  has(key: string): boolean {
    return this.inFlight.has(key);
  }

  get size(): number {
    return this.inFlight.size;
  }
}
