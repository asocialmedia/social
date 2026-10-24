import { expect, test } from "bun:test";

import { FeedTiming, feedTiming } from "./feed-timing";

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
