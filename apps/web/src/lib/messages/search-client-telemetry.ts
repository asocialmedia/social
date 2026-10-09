import {
  MESSAGE_SEARCH_CLIENT_METRIC_BATCH_LIMIT,
  MESSAGE_SEARCH_CLIENT_METRIC_DURATION_LIMIT_MS,
} from "./search-client-metric-contract";
import type { MessageSearchClientMetric } from "./search-client-metric-contract";

const SAMPLE_RATE = 0.1;
const FLUSH_INTERVAL_MS = 20_000;
const QUEUE_LIMIT = MESSAGE_SEARCH_CLIENT_METRIC_BATCH_LIMIT;
const TELEMETRY_URL = "/api/messages/search/telemetry";
const SCROLL_FRAME_SAMPLE_INTERVAL_MS = 3000;
const SCROLL_IDLE_STOP_MS = 750;
const SCROLL_FRAME_MAX_GAP_MS = 250;
const SCROLL_FRAME_SAMPLE_CAP = 120;

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

export interface MessageScrollFrameTelemetryTarget {
  addEventListener: (
    type: "scroll",
    listener: EventListener,
    options?: AddEventListenerOptions
  ) => void;
  removeEventListener: (type: "scroll", listener: EventListener) => void;
}

export interface MessageScrollFrameTelemetryRuntime {
  cancelFrame: (id: number) => void;
  isHidden: () => boolean;
  isSampled: () => boolean;
  now: () => number;
  record: (event: MessageSearchClientMetric) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
}

function percentile95(values: readonly number[]): number | null {
  if (values.length < 3) {
    return null;
  }
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
}

export function startMessageScrollFrameTelemetry(
  target: MessageScrollFrameTelemetryTarget | null,
  runtime?: MessageScrollFrameTelemetryRuntime
): () => void {
  const frameRuntime: MessageScrollFrameTelemetryRuntime = runtime ?? {
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    isHidden: () => document.visibilityState === "hidden",
    isSampled: shouldCollect,
    now: () => performance.now(),
    record: recordMessageSearchClientMetric,
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- requestAnimationFrame is a callback-based browser API.
    requestFrame: (callback) => window.requestAnimationFrame(callback),
  };
  if (!target || !frameRuntime.isSampled()) {
    return () => Promise.resolve();
  }

  let disposed = false;
  let frameId: number | null = null;
  let lastFrameAt: number | null = null;
  let lastScrollAt: number | null = null;
  let sampleStartedAt: number | null = null;
  let intervals: number[] = [];

  const flushSample = () => {
    const durationMs = percentile95(intervals);
    intervals = [];
    if (durationMs !== null) {
      frameRuntime.record({ durationMs, event: "scroll-frame" });
    }
  };

  const stopSampling = () => {
    if (frameId !== null) {
      frameRuntime.cancelFrame(frameId);
      frameId = null;
    }
    lastFrameAt = null;
    sampleStartedAt = null;
    intervals = [];
  };

  const sampleFrame: FrameRequestCallback = (timestamp) => {
    frameId = null;
    if (disposed || frameRuntime.isHidden()) {
      stopSampling();
      return;
    }
    if (lastFrameAt !== null) {
      const interval = timestamp - lastFrameAt;
      if (interval > 0 && interval <= SCROLL_FRAME_MAX_GAP_MS) {
        intervals.push(interval);
        if (intervals.length > SCROLL_FRAME_SAMPLE_CAP) {
          intervals.shift();
        }
      } else if (interval > SCROLL_FRAME_MAX_GAP_MS) {
        intervals = [];
        sampleStartedAt = timestamp;
      }
    }
    lastFrameAt = timestamp;

    if (
      lastScrollAt !== null &&
      timestamp - lastScrollAt >= SCROLL_IDLE_STOP_MS
    ) {
      flushSample();
      stopSampling();
      return;
    }
    if (
      sampleStartedAt !== null &&
      timestamp - sampleStartedAt >= SCROLL_FRAME_SAMPLE_INTERVAL_MS
    ) {
      flushSample();
      sampleStartedAt = timestamp;
    }
    frameId = frameRuntime.requestFrame(sampleFrame);
  };

  const onScroll: EventListener = () => {
    lastScrollAt = frameRuntime.now();
    if (frameId === null) {
      lastFrameAt = null;
      sampleStartedAt = lastScrollAt;
      frameId = frameRuntime.requestFrame(sampleFrame);
    }
  };

  target.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    target.removeEventListener("scroll", onScroll);
    flushSample();
    stopSampling();
  };
}
