export const MESSAGE_SEARCH_CLIENT_METRIC_EVENTS = [
  "input-paint",
  "result-ready",
  "long-task",
] as const;

export const MESSAGE_SEARCH_CLIENT_METRIC_OUTCOMES = [
  "empty",
  "error",
  "hits",
  "offline",
] as const;

export const MESSAGE_SEARCH_CLIENT_METRIC_BATCH_LIMIT = 24;
export const MESSAGE_SEARCH_CLIENT_METRIC_DURATION_LIMIT_MS = 60_000;

export type MessageSearchClientMetric =
  | {
      durationMs: number;
      event: "input-paint" | "long-task";
    }
  | {
      durationMs: number;
      event: "result-ready";
      outcome: (typeof MESSAGE_SEARCH_CLIENT_METRIC_OUTCOMES)[number];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvent(value: unknown): MessageSearchClientMetric | null {
  if (!isRecord(value)) {
    return null;
  }
  const event = MESSAGE_SEARCH_CLIENT_METRIC_EVENTS.find(
    (candidate) => candidate === value.event
  );
  if (
    Object.keys(value).some(
      (key) => !["durationMs", "event", "outcome"].includes(key)
    ) ||
    !event ||
    typeof value.durationMs !== "number" ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0 ||
    value.durationMs > MESSAGE_SEARCH_CLIENT_METRIC_DURATION_LIMIT_MS
  ) {
    return null;
  }
  if (event === "result-ready") {
    const outcome = MESSAGE_SEARCH_CLIENT_METRIC_OUTCOMES.find(
      (candidate) => candidate === value.outcome
    );
    if (!outcome) {
      return null;
    }
    return {
      durationMs: value.durationMs,
      event,
      outcome,
    };
  }
  if (value.outcome !== undefined) {
    return null;
  }
  return { durationMs: value.durationMs, event };
}

export function parseMessageSearchClientMetricBatch(
  value: unknown
): MessageSearchClientMetric[] | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== "events") ||
    !Array.isArray(value.events) ||
    value.events.length === 0 ||
    value.events.length > MESSAGE_SEARCH_CLIENT_METRIC_BATCH_LIMIT
  ) {
    return null;
  }
  const events = value.events.map(parseEvent);
  if (events.some((event) => event === null)) {
    return null;
  }
  return events.filter(
    (event): event is MessageSearchClientMetric => event !== null
  );
}
