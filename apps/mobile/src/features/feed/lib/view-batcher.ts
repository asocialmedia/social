// Batched view increments for post cards. Web's useIncrementViewMutation
// collects viewed ids and POSTs /api/views/batch after an 800ms debounce
// (max 100 per batch); the response counts reconcile the rendered numbers
// through onViewCounts. Same shape here, framework-free: mark() buffers,
// flush() sends with the caller's apiBase + session cookie.

import { submitViewBatch } from "./feed-api";

const FLUSH_DELAY_MS = 800;
const MAX_BATCH = 100;

interface BatcherOptions {
  apiBase: string;
  cookie?: string;
}

export class ViewBatcher {
  private consecutiveFailures = 0;
  private latest: BatcherOptions | null = null;
  /** Called with reconciled counts after every flush (view-count display). */
  public onFlush: ((counts: Record<string, number>) => void) | null = null;
  private pending: string[] = [];
  private submit: (
    postIds: string[],
    options: BatcherOptions
  ) => Promise<Record<string, number>>;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    submit: (
      postIds: string[],
      options: BatcherOptions
    ) => Promise<Record<string, number>> = submitViewBatch
  ) {
    this.submit = submit;
  }

  mark(postId: string, options: BatcherOptions): void {
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
    const batch = this.pending.splice(0, MAX_BATCH);
    if (batch.length === 0 || !this.latest) {
      return {};
    }
    try {
      const counts = await this.submit(batch, this.latest);
      this.consecutiveFailures = 0;
      this.onFlush?.(counts);
      return counts;
    } catch {
      // Best-effort telemetry, but a transient failure must not silently
      // drop the batch: requeue ahead of newer ids and retry on schedule.
      // After repeated failures the endpoint is presumed down and the batch
      // is dropped, so a dead backend cannot spin the radio forever.
      if (this.consecutiveFailures < 3) {
        this.consecutiveFailures += 1;
        this.pending.unshift(
          ...batch.filter((id) => !this.pending.includes(id))
        );
      }
      return {};
    } finally {
      // A batch caps at MAX_BATCH; keep draining while work remains.
      this.scheduleFlush();
    }
  }

  get size(): number {
    return this.pending.length;
  }
}

/** Process-wide view batcher used by feed lists. */
export const viewBatcher = new ViewBatcher();
