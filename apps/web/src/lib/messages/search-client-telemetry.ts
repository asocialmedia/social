import {
  MESSAGE_SEARCH_CLIENT_METRIC_BATCH_LIMIT,
  MESSAGE_SEARCH_CLIENT_METRIC_DURATION_LIMIT_MS,
} from "./search-client-metric-contract";
import type { MessageSearchClientMetric } from "./search-client-metric-contract";

const SAMPLE_RATE = 0.1;
const FLUSH_INTERVAL_MS = 20_000;
const QUEUE_LIMIT = MESSAGE_SEARCH_CLIENT_METRIC_BATCH_LIMIT;
const TELEMETRY_URL = "/api/messages/search/telemetry";

let sampledSession: boolean | null = null;
let queuedEvents: MessageSearchClientMetric[] = [];
let flushTimer: number | null = null;
let isFlushing = false;

function shouldCollect(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  sampledSession ??= Math.random() < SAMPLE_RATE;
  return sampledSession;
}

function scheduleFlush(): void {
  if (flushTimer !== null || typeof window === "undefined") {
    return;
  }
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushMessageSearchClientTelemetry();
  }, FLUSH_INTERVAL_MS);
}

export function recordMessageSearchClientMetric(
  event: MessageSearchClientMetric
): void {
  if (!shouldCollect()) {
    return;
  }
  queuedEvents.push(event);
  if (queuedEvents.length > QUEUE_LIMIT) {
    queuedEvents = queuedEvents.slice(-QUEUE_LIMIT);
  }
  if (queuedEvents.length === QUEUE_LIMIT) {
    void flushMessageSearchClientTelemetry();
  } else {
    scheduleFlush();
  }
}

export async function flushMessageSearchClientTelemetry(): Promise<void> {
  if (!shouldCollect() || isFlushing || queuedEvents.length === 0) {
    return;
  }
  isFlushing = true;
  const batch = queuedEvents.splice(0, QUEUE_LIMIT);
  const body = JSON.stringify({ events: batch });
  let delivered = false;
  try {
    if (typeof navigator.sendBeacon === "function") {
      const accepted = navigator.sendBeacon(
        TELEMETRY_URL,
        new Blob([body], { type: "application/json" })
      );
      if (accepted) {
        delivered = true;
        return;
      }
    }
    const response = await fetch(TELEMETRY_URL, {
      body,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    });
    delivered = response.ok;
  } catch {
    // A later flush can retry the bounded in-memory batch.
  } finally {
    if (!delivered) {
      queuedEvents = [...batch, ...queuedEvents].slice(-QUEUE_LIMIT);
    }
    isFlushing = false;
    if (queuedEvents.length > 0) {
      scheduleFlush();
    }
  }
}

export function startMessageSearchLongTaskTelemetry(): () => void {
  if (!shouldCollect() || typeof PerformanceObserver === "undefined") {
    return () => Promise.resolve();
  }
  let observer: PerformanceObserver;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration <= MESSAGE_SEARCH_CLIENT_METRIC_DURATION_LIMIT_MS) {
          recordMessageSearchClientMetric({
            durationMs: entry.duration,
            event: "long-task",
          });
        }
      }
    });
    observer.observe({ buffered: false, type: "longtask" });
  } catch {
    return () => Promise.resolve();
  }
  return () => observer.disconnect();
}
