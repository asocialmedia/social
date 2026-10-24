import { metrics } from "@opentelemetry/api";

export type FeedStage =
  | "queue"
  | "budget"
  | "auth"
  | "features"
  | "inference"
  | "cache"
  | "retrieval"
  | "graph"
  | "filtering"
  | "safety"
  | "ranking"
  | "hydration"
  | "serialization";

const requests = new WeakMap<Request, FeedTiming>();
const histogram = metrics
  .getMeter("asm-web")
  .createHistogram("asm.feed.stage.duration", { unit: "ms" });

export class FeedTiming {
  private readonly durations = new Map<FeedStage, number>();
  private readonly startedAt: number;
  private readonly now: () => number;

  constructor(now = () => performance.now()) {
    this.now = now;
    this.startedAt = now();
  }

  start(stage: FeedStage) {
    const started = this.now();
    let finished = false;
    return () => {
      if (finished) {
        return;
      }
      finished = true;
      this.durations.set(
        stage,
        (this.durations.get(stage) ?? 0) + Math.max(0, this.now() - started)
      );
    };
  }

  async measure<T>(stage: FeedStage, read: () => T): Promise<Awaited<T>> {
    const finish = this.start(stage);
    try {
      return await read();
    } finally {
      finish();
    }
  }

  finish(response: Response, surface: string) {
    const total = Math.max(0, this.now() - this.startedAt);
    const entries = [...this.durations, ["total", total] as const];
    response.headers.set(
      "Server-Timing",
      entries
        .map(([stage, duration]) => `${stage};dur=${duration.toFixed(2)}`)
        .join(", ")
    );
    for (const [stage, duration] of entries) {
      histogram.record(duration, { stage, surface });
    }
    return response;
  }
}

export function feedTiming(request: Request) {
  let timing = requests.get(request);
  if (!timing) {
    timing = new FeedTiming();
    requests.set(request, timing);
  }
  return timing;
}
