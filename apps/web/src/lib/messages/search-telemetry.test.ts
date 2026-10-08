import { describe, expect, test } from "bun:test";

import { createMessageSearchApiMetricRecorder } from "./search-telemetry";

describe("DM search API telemetry", () => {
  test("records duration with only bounded route and outcome attributes", () => {
    const records: {
      attributes: { outcome: string; route: string };
      durationMs: number;
    }[] = [];
    const record = createMessageSearchApiMetricRecorder((name, options) => {
      expect(name).toBe("messages.search.api.duration");
      expect(options.unit).toBe("ms");
      return {
        record: (durationMs, attributes) =>
          records.push({ attributes, durationMs }),
      };
    });

    record({ durationMs: 42, outcome: "success", route: "search" });
    record({ durationMs: Number.NaN, outcome: "unavailable", route: "search" });

    expect(records).toEqual([
      {
        attributes: { outcome: "success", route: "search" },
        durationMs: 42,
      },
      {
        attributes: { outcome: "unavailable", route: "search" },
        durationMs: 0,
      },
    ]);
  });

  test("treats exporter and instrument failures as non-fatal", () => {
    const record = createMessageSearchApiMetricRecorder(() => {
      throw new Error("telemetry unavailable");
    });

    expect(() =>
      record({ durationMs: 42, outcome: "success", route: "search" })
    ).not.toThrow();
  });
});
