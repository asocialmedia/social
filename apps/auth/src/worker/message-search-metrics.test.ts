import { describe, expect, test } from "bun:test";

import * as messageSearchWorkerMetrics from "./message-search-metrics";

function createMetricHarness(): {
  counters: Map<
    string,
    { attributes: Record<string, string> | undefined; value: number }[]
  >;
  histograms: Map<
    string,
    { attributes: Record<string, string> | undefined; value: number }[]
  >;
  meter: messageSearchWorkerMetrics.MessageSearchWorkerMetricMeter;
} {
  const counters = new Map<
    string,
    { attributes: Record<string, string> | undefined; value: number }[]
  >();
  const histograms = new Map<
    string,
    { attributes: Record<string, string> | undefined; value: number }[]
  >();
  const meter: messageSearchWorkerMetrics.MessageSearchWorkerMetricMeter = {
    createCounter(name) {
      const records = counters.get(name) ?? [];
      counters.set(name, records);
      const counter: messageSearchWorkerMetrics.MessageSearchWorkerMetricCounter =
        {
          add(value, attributes) {
            records.push({ attributes, value });
          },
        };
      return counter;
    },
    createHistogram(name) {
      const records = histograms.get(name) ?? [];
      histograms.set(name, records);
      const histogram: messageSearchWorkerMetrics.MessageSearchWorkerMetricHistogram =
        {
          record(value, attributes) {
            records.push({ attributes, value });
          },
        };
      return histogram;
    },
  };
  return { counters, histograms, meter };
}

describe("createMessageSearchWorkerMetricSink", () => {
  test("records bounded worker throughput, queue age, and RSS measurements", () => {
    const harness = createMetricHarness();
    const sink = messageSearchWorkerMetrics.createMessageSearchWorkerMetricSink(
      () => harness.meter
    );
    sink.record({
      durationMs: 200,
      job: "backfill",
      outcome: "completed",
      processRssBytes: 42_000_000,
      queueAgeMs: 80,
      rows: 50,
    });

    expect(harness.counters.get("messages.search.worker.jobs")).toEqual([
      { attributes: { job: "backfill", outcome: "completed" }, value: 1 },
    ]);
    expect(
      harness.histograms.get("messages.search.worker.rows_per_second")
    ).toEqual([{ attributes: { job: "backfill" }, value: 250 }]);
    expect(
      harness.histograms.get("messages.search.worker.process_rss_bytes")
    ).toEqual([{ attributes: { job: "backfill" }, value: 42_000_000 }]);
    expect(harness.histograms.get("messages.search.worker.queue_age")).toEqual([
      { attributes: { job: "backfill" }, value: 80 },
    ]);
  });

  test("counts durable repair transitions separately from transient retries", () => {
    const harness = createMetricHarness();
    const sink = messageSearchWorkerMetrics.createMessageSearchWorkerMetricSink(
      () => harness.meter
    );
    sink.record({
      durationMs: 0,
      job: "live-index",
      outcome: "repair",
    });

    expect(harness.counters.get("messages.search.worker.jobs")).toEqual([
      { attributes: { job: "live-index", outcome: "repair" }, value: 1 },
    ]);
  });
});

describe("safelyRecordMessageSearchWorkerMetric", () => {
  test("adds process RSS without message or conversation identifiers", () => {
    const events: messageSearchWorkerMetrics.MessageSearchWorkerMetricEvent[] =
      [];
    messageSearchWorkerMetrics.safelyRecordMessageSearchWorkerMetric(
      { record: (event) => events.push(event) },
      {
        durationMs: 120,
        job: "backfill",
        outcome: "completed",
        rows: 100,
      }
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.processRssBytes).toBeGreaterThan(0);
    expect(events[0]).not.toHaveProperty("conversationId");
    expect(events[0]).not.toHaveProperty("messageId");
  });

  test("keeps the worker job safe when the metric sink throws", () => {
    expect(() =>
      messageSearchWorkerMetrics.safelyRecordMessageSearchWorkerMetric(
        {
          record: () => {
            throw new Error("telemetry unavailable");
          },
        },
        {
          durationMs: 1,
          job: "live-index",
          outcome: "indexed",
        }
      )
    ).not.toThrow();
  });
});
