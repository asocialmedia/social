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
const meter = metrics.getMeter("asm-web");
const requestsCount = meter.createCounter("asm.feed.requests");
const histogram = meter.createHistogram("asm.feed.stage.duration", {
  unit: "ms",
});

export class FeedTiming {
  private readonly durations = new Map<FeedStage, number>();
  private readonly startedAt: number;
  private readonly now: () => number;
  private readonly freshnessProbe: boolean;

  constructor(now = () => performance.now(), freshnessProbe = false) {
    this.now = now;
    this.freshnessProbe = freshnessProbe;
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
    const attributes = {
      request_kind: this.freshnessProbe ? "freshness" : "page",
      status: response.status,
      surface,
    };
    requestsCount.add(1, attributes);
    for (const [stage, duration] of entries) {
      histogram.record(duration, { ...attributes, stage });
    }
    return response;
  }
}

export function feedTiming(request: Request) {
  let timing = requests.get(request);
  if (!timing) {
    timing = new FeedTiming(
      undefined,
      new URL(request.url).searchParams.get("refresh") === "1"
    );
    requests.set(request, timing);
  }
  return timing;
}
