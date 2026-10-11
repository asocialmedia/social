import { describe, expect, test } from "bun:test";

import { createMessageSearchClientMetricRecorder } from "./search-client-metrics";

describe("createMessageSearchClientMetricRecorder", () => {
  test("records only bounded metric dimensions", () => {
    const records: {
      value: number;
      attributes: Record<string, string>;
    }[] = [];
    const record = createMessageSearchClientMetricRecorder(() => ({
      record: (value, attributes) => records.push({ attributes, value }),
    }));

    record([
      { durationMs: 12, event: "input-paint" },
      { durationMs: 250, event: "result-ready", outcome: "hits" },
    ]);

    expect(records).toEqual([
      { attributes: { event: "input-paint" }, value: 12 },
      { attributes: { event: "result-ready", outcome: "hits" }, value: 250 },
    ]);
  });

  test("swallows telemetry initialization and export failures", () => {
    const record = createMessageSearchClientMetricRecorder(() => {
      throw new Error("telemetry unavailable");
    });

    expect(() =>
      record([{ durationMs: 10, event: "long-task" }])
    ).not.toThrow();
  });
});
