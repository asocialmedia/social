// Client-side request budget for the server's per-IP `/api/upload*` limit
// (20/min, lib/security/api-security.ts). A single 250MB video needs 16 part
// URLs plus initiate/complete/finalize, so two big uploads back to back would
// trip the limit; spacing requests under the budget avoids 429s instead of
// bouncing off them. A 429 still backs off via retry-after (see retry.ts).
//
// Sliding window, FIFO waiters; the clock and timer are injectable so the
// scheduling is unit-tested without real time.

export interface RateBudgetOptions {
  limit: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  windowMs: number;
}

// A failed turn must not stall the waiters queued behind it.
function ignoreFailure(): undefined {
  return undefined;
}

export class RateBudget {
  private readonly limit: number;
  private readonly now: () => number;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly windowMs: number;
  private stamps: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(options: RateBudgetOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
    this.wait =
      options.wait ??
      ((ms) =>
        // oxlint-disable-next-line promise/avoid-new -- a timer-backed delay has no library promise to return
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }));
  }

  // Milliseconds until a slot frees up (0 when one is free now).
  delayUntilSlot(): number {
    const now = this.now();
    this.stamps = this.stamps.filter((stamp) => now - stamp < this.windowMs);
    if (this.stamps.length < this.limit) {
      return 0;
    }
    const oldest = this.stamps[0] ?? now;
    return Math.max(0, this.windowMs - (now - oldest));
  }

  // Resolves when the caller may send; waiters are served in order.
  acquire(): Promise<void> {
    // Waiters chain on the previous turn so they are served strictly FIFO.
    // oxlint-disable-next-line promise/prefer-await-to-then -- the FIFO queue is a promise chain by construction
    const turn = this.queue.then(async () => {
      for (;;) {
        const delay = this.delayUntilSlot();
        if (delay === 0) {
          this.stamps.push(this.now());
          return;
        }
        // eslint-disable-next-line no-await-in-loop -- each wait must elapse before re-checking the window
        await this.wait(delay);
      }
    });
    // oxlint-disable-next-line promise/prefer-await-to-then -- keep the chain alive past a failed turn
    this.queue = turn.catch(ignoreFailure);
    return turn;
  }
}

// 18 of the 20 per minute: headroom for web tabs and clock skew.
export const uploadRateBudget = new RateBudget({ limit: 18, windowMs: 60_000 });
