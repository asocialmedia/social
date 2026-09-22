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
    if (!this.timer) {
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
      this.onFlush?.(counts);
      return counts;
    } catch {
      // View counts are best-effort telemetry; failures stay silent.
      return {};
    }
  }

  get size(): number {
    return this.pending.length;
  }
}

/** Process-wide view batcher used by feed lists. */
export const viewBatcher = new ViewBatcher();
