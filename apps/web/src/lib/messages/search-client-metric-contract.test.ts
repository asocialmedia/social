import { describe, expect, test } from "bun:test";

import { parseMessageSearchClientMetricBatch } from "./search-client-metric-contract";

describe("parseMessageSearchClientMetricBatch", () => {
  test("accepts bounded privacy-safe events", () => {
    expect(
      parseMessageSearchClientMetricBatch({
        events: [
          { durationMs: 23, event: "input-paint" },
          { durationMs: 281, event: "result-ready", outcome: "hits" },
          { durationMs: 79, event: "long-task" },
        ],
      })
    ).toEqual([
      { durationMs: 23, event: "input-paint" },
      { durationMs: 281, event: "result-ready", outcome: "hits" },
      { durationMs: 79, event: "long-task" },
    ]);
  });

  test("rejects identifying and unbounded fields", () => {
    expect(
      parseMessageSearchClientMetricBatch({
        events: [
          {
            durationMs: 23,
            event: "input-paint",
            query: "secret search",
          },
        ],
      })
    ).toBeNull();
    expect(
      parseMessageSearchClientMetricBatch({
        events: [{ durationMs: 60_001, event: "long-task" }],
      })
    ).toBeNull();
    expect(
      parseMessageSearchClientMetricBatch({
        events: Array.from({ length: 25 }, () => ({
          durationMs: 1,
          event: "input-paint",
        })),
      })
    ).toBeNull();
  });
});
