// One card's time on screen, split out of recommendation-tracker (one class
// per file). start() when it becomes active, stop() when it leaves (or
// unmounts). Impressions and completion fire once per card.
import { systemClock, VIEW_COMPLETE_MS } from "./recommendation-tracker";
import type {
  RecommendationQueue,
  Timer,
  TrackerClock,
} from "./recommendation-tracker";

export class GustViewSession {
  private startedAt: number | null = null;
  private completeTimer: Timer | null = null;
  private completed = false;
  private impressed = false;
  private readonly clock: TrackerClock;
  private readonly postId: string;
  private readonly queue: RecommendationQueue;

  constructor(
    postId: string,
    queue: RecommendationQueue,
    clock: TrackerClock = systemClock
  ) {
    this.postId = postId;
    this.queue = queue;
    this.clock = clock;
  }

  start(): void {
    if (this.startedAt !== null) {
      return;
    }
    this.startedAt = this.clock.now();
    if (!this.impressed) {
      this.impressed = true;
      this.queue.push("IMPRESSION", this.postId, "VIEW_START", this.postId);
    }
    if (this.completed) {
      return;
    }
    this.completeTimer = this.clock.setTimeout(() => {
      this.completeTimer = null;
      this.completed = true;
      this.queue.push("VIEW_COMPLETE", this.postId);
    }, VIEW_COMPLETE_MS);
  }

  stop(): void {
    if (this.startedAt === null) {
      return;
    }
    if (this.completeTimer) {
      this.clock.clearTimeout(this.completeTimer);
      this.completeTimer = null;
    }
    const durationMs = this.clock.now() - this.startedAt;
    this.startedAt = null;
    this.queue.push("DWELL", this.postId, durationMs);
  }
}
