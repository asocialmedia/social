import { expect, test, mock } from "bun:test";

const counts: { value: number; attributes: unknown }[] = [];
const durations: { value: number; attributes: unknown }[] = [];
mock.module("@opentelemetry/api", () => ({
  metrics: {
    getMeter: () => ({
      createCounter: () => ({
        add: (value: number, attributes: unknown) =>
          counts.push({ attributes, value }),
      }),
      createHistogram: () => ({
        record: (value: number, attributes: unknown) =>
          durations.push({ attributes, value }),
      }),
    }),
  },
}));

const { FeedTiming, feedTiming } = await import("./feed-timing");

test("timings accumulate stages, include failures, and remain request isolated", async () => {
  let time = 0;
  const timing = new FeedTiming(() => time);
  await timing.measure("retrieval", () => {
    time += 7;
  });
  await expect(
    timing.measure("retrieval", () => {
      time += 3;
      throw new Error("upstream");
    })
  ).rejects.toThrow("upstream");
  const stop = timing.start("ranking");
  time += 2;
  stop();
  stop();
  expect(
    timing.finish(Response.json({}), "external").headers.get("Server-Timing")
  ).toBe("retrieval;dur=10.00, ranking;dur=2.00, total;dur=12.00");
  const request = new Request("http://localhost/feed");
  expect(feedTiming(request)).toBe(feedTiming(request));
  expect(feedTiming(new Request(request))).not.toBe(feedTiming(request));
});

test("freshness probes expose volume and total latency separately from normal pages", () => {
  const before = counts.length;
  const request = new Request(
    "http://localhost/api/posts/latest?refresh=1&take=1"
  );
  feedTiming(request).finish(Response.json({}, { status: 503 }), "native");
  expect(counts.slice(before)).toEqual([
    {
      attributes: { request_kind: "freshness", status: 503, surface: "native" },
      value: 1,
    },
  ]);
  expect(durations.at(-1)?.attributes).toEqual({
    request_kind: "freshness",
    stage: "total",
    status: 503,
    surface: "native",
  });
  expect(durations.at(-1)?.value).toBeGreaterThanOrEqual(0);
});
