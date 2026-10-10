// Batched view increments for post cards. Web's useIncrementViewMutation
// collects viewed ids and POSTs /api/views/batch after an 800ms debounce
// (max 100 per batch); the response counts reconcile the rendered numbers
// through onViewCounts. Same shape here, framework-free: mark() buffers,
// flush() sends with the caller's apiBase + session cookie.

import { submitViewBatch } from "./feed-api";

const FLUSH_DELAY_MS = 800;
const MAX_BATCH = 100;
// How many posts stay "already counted" for the session. A few screens of
// scrolling is plenty; the server dedupes per (user, post) regardless, so this
// only suppresses redundant requests.
const COUNTED_LIMIT = 300;

interface BatcherOptions {
  apiBase: string;
  cookie?: string;
  getCookie?: () => Promise<string | null | undefined>;
}

export class ViewBatcher {
  private consecutiveFailures = 0;
  private flushing = false;
  private generation = 0;
  private latest: BatcherOptions | null = null;
  // Called with reconciled counts after every flush (view-count display).
  public onFlush: ((counts: Record<string, number>) => void) | null = null;
  private pending: string[] = [];
  // Ids already counted this session. Without this, a post that scrolls out of
  // view and back is re-marked as soon as the previous batch drains, so a slow
  // scroll produced a stream of one-id flushes (the `batchSize: 1` pattern in
  // the dev log). The server already dedupes per (user, post), so those extra
  // requests bought nothing. Bounded, and cleared with the session.
  private counted = new Map<string, number>();
  private counts = new Map<string, number>();
  private listeners = new Set<() => void>();
  private readonly now: () => number;
  private countedOrder: string[] = [];
  private maxCounted: number;
  private submit: (
    postIds: string[],
    options: BatcherOptions
  ) => Promise<Record<string, number>>;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    submit: (
      postIds: string[],
      options: BatcherOptions
    ) => Promise<Record<string, number>> = submitViewBatch,
    options: { maxCounted?: number; now?: () => number } = {}
  ) {
    this.submit = submit;
    this.now = options.now ?? Date.now;
    this.maxCounted = Math.max(1, options.maxCounted ?? COUNTED_LIMIT);
  }

  private remember(postId: string): void {
    if (this.counted.has(postId)) {
      return;
    }
    this.counted.set(postId, this.now());
    this.countedOrder.push(postId);
    while (this.countedOrder.length > this.maxCounted) {
      const oldest = this.countedOrder.shift();
      if (oldest !== undefined) {
        this.counted.delete(oldest);
        this.counts.delete(oldest);
      }
    }
  }

  mark(postId: string, options: BatcherOptions): void {
    // Already counted this session: counting again would only re-send an id the
    // server has already recorded for this viewer.
    const countedAt = this.counted.get(postId);
    if (countedAt !== undefined && this.now() - countedAt < 15 * 60 * 1000) {
      return;
    }
    if (countedAt !== undefined) {
      this.counted.delete(postId);
      this.countedOrder = this.countedOrder.filter((id) => id !== postId);
    }
    if (!this.pending.includes(postId)) {
      this.pending.push(postId);
    }
    this.latest = options;
    this.scheduleFlush();
  }

  // Starts the flush timer only when none runs and work remains, so a slow
  // request cannot stack parallel batches.
  private scheduleFlush(): void {
    if (!this.timer && this.pending.length > 0) {
      this.timer = setTimeout(() => {
        void this.flush();
      }, FLUSH_DELAY_MS);
    }
  }

  async flush(): Promise<Record<string, number>> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.flushing) {
      return {};
    }
    const batch = this.pending.splice(0, MAX_BATCH);
    if (batch.length === 0 || !this.latest) {
      return {};
    }
    this.flushing = true;
    const { generation } = this;
    try {
      const options = this.latest;
      const cookie = options.getCookie
        ? await options.getCookie()
        : options.cookie;
      const counts = await this.submit(batch, {
        apiBase: options.apiBase,
        cookie: cookie ?? undefined,
      });
      if (generation !== this.generation) {
        return {};
      }
      this.consecutiveFailures = 0;
      // Only a confirmed send retires the ids. A failed batch is requeued
      // below, and must stay eligible on the next attempt.
      for (const postId of batch) {
        this.remember(postId);
      }
      for (const [postId, count] of Object.entries(counts)) {
        this.counts.set(postId, count);
      }
      this.onFlush?.(counts);
      for (const listener of this.listeners) {
        listener();
      }
      return counts;
    } catch {
      // Best-effort telemetry, but a transient failure must not silently
      // drop the batch: requeue ahead of newer ids and retry on schedule.
      // After repeated failures the endpoint is presumed down and the batch
      // is dropped, so a dead backend cannot spin the radio forever.
      if (generation === this.generation && this.consecutiveFailures < 3) {
        this.consecutiveFailures += 1;
        this.pending.unshift(
          ...batch.filter((id) => !this.pending.includes(id))
        );
      }
      return {};
    } finally {
      if (generation === this.generation) {
        this.flushing = false;
        // A batch caps at MAX_BATCH; keep draining while work remains.
        this.scheduleFlush();
      }
    }
  }

  reset(): void {
    this.generation += 1;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = null;
    this.pending = [];
    this.counted.clear();
    this.countedOrder = [];
    this.counts.clear();
    this.latest = null;
    this.flushing = false;
    this.consecutiveFailures = 0;
    for (const listener of this.listeners) {
      listener();
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  count(postId: string, fallback: number): number {
    return Math.max(fallback, this.counts.get(postId) ?? 0);
  }

  get size(): number {
    return this.pending.length;
  }
}

// Process-wide view batcher used by feed lists.
export const viewBatcher = new ViewBatcher();
