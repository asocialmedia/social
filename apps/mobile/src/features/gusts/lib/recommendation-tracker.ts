// Recommendation signals for the reel, ported from web's
// RecommendationTracker + recommendation queue. A gust that becomes the
// active card logs IMPRESSION + VIEW_START once, VIEW_COMPLETE after 8s on
// screen, and DWELL with the watched duration when it leaves. Events queue
// and flush after 2s or at 50 events, like web. Signed-in viewers only
// (the route 401s guests). Framework-free: timers and the sender are
// injected so the whole flow unit-tests without a clock.
import type { RecommendationEvent, RecommendationEventType } from "./gusts-api";

export const FLUSH_DELAY_MS = 2000;
export const MAX_QUEUE = 50;
export const VIEW_COMPLETE_MS = 8000;

export type Timer = ReturnType<typeof setTimeout>;

export interface TrackerClock {
  clearTimeout: (timer: Timer) => void;
  now: () => number;
  setTimeout: (run: () => void, ms: number) => Timer;
}

export const systemClock: TrackerClock = {
  clearTimeout: (timer) => clearTimeout(timer),
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
};

export class RecommendationQueue {
  private pending: RecommendationEvent[] = [];
  private timer: Timer | null = null;
  private readonly clock: TrackerClock;
  private readonly send: (events: RecommendationEvent[]) => Promise<void>;

  constructor(
    send: (events: RecommendationEvent[]) => Promise<void>,
    clock: TrackerClock = systemClock
  ) {
    this.send = send;
    this.clock = clock;
  }

  // The third argument is either a dwell duration or a second event type
  // piggybacking on the same flush setup: the reel start logs IMPRESSION +
  // VIEW_START together, so both call shapes are supported and stay green
  // no matter which one lands.
  push(
    eventType: RecommendationEventType,
    postId: string,
    durationMsOrSecondType?: number | RecommendationEventType,
    secondPostId?: string
  ) {
    this.pending.push(
      typeof durationMsOrSecondType === "number"
        ? {
            durationMs: Math.max(0, Math.round(durationMsOrSecondType)),
            eventType,
            postId,
          }
        : { eventType, postId }
    );
    if (
      typeof durationMsOrSecondType === "string" &&
      typeof secondPostId === "string"
    ) {
      this.pending.push({
        eventType: durationMsOrSecondType,
        postId: secondPostId,
      });
    }
    if (this.pending.length >= MAX_QUEUE) {
      void this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = this.clock.setTimeout(() => {
        void this.flush();
      }, FLUSH_DELAY_MS);
    }
  }

  get size(): number {
    return this.pending.length;
  }

  // Signals are best-effort: a failed batch is dropped rather than retried,
  // so a flaky network can never pile up an unbounded queue.
  async flush(): Promise<void> {
    if (this.timer) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.length === 0) {
      return;
    }
    const batch = this.pending.splice(0, MAX_QUEUE);
    try {
      await this.send(batch);
    } catch {
      // Dropped on purpose; see above.
    }
  }
}
