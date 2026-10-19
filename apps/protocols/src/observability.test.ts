import { expect, mock, test } from "bun:test";

import { createProtocolObserver } from "./observability";

test("upstream outages retain metrics but aggregate repeated warnings in a bounded cooldown", () => {
  let now = 0;
  const logger = { debug: mock(), error: mock(), info: mock(), warn: mock() };
  const observe = createProtocolObserver(logger, () => now);
  const failure = {
    code: "unavailable" as const,
    durationMs: 10,
    operation: "app.bsky.feed.getFeed",
    outcome: "error" as const,
  };
  for (let index = 0; index < 100; index += 1) {
    observe(failure);
  }
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(logger.debug).toHaveBeenCalledTimes(99);
  now = 30_001;
  observe(failure);
  expect(logger.warn).toHaveBeenCalledTimes(2);
  expect(logger.warn.mock.calls[1]?.[0]).toMatchObject({ suppressed: 99 });
  observe({ ...failure, operation: "app.bsky.feed.getPosts" });
  expect(logger.warn).toHaveBeenCalledTimes(3);
});
