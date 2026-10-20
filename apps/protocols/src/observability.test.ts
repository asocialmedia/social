import { expect, mock, test } from "bun:test";

import { ProtocolError } from "@asm/protocols/contracts";

import { createProtocolObserver, observeRequest } from "./observability";

test("normal discovery expiry is debug telemetry while malformed requests still warn", async () => {
  const logger = { debug: mock(), error: mock(), info: mock(), warn: mock() };
  const request = new Request("http://protocols/v1/bluesky/discover");
  for (const message of [
    "Discovery session expired",
    "Invalid discovery request",
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- ordered calls verify that only the malformed request adds a warning.
    await expect(
      observeRequest("bluesky.discover", request, "test", logger, () =>
        Promise.reject(new ProtocolError("invalid_input", message))
      )
    ).rejects.toThrow(message);
  }
  expect(logger.debug).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledTimes(1);
});

test("expected restrictions and retry scheduling do not duplicate upstream outage warnings", () => {
  const logger = { debug: mock(), error: mock(), info: mock(), warn: mock() };
  const observe = createProtocolObserver(logger);
  observe({
    code: "restricted",
    durationMs: 5,
    operation: "app.bsky.feed.getFeed",
    outcome: "error",
  });
  observe({
    code: "unavailable",
    durationMs: 0,
    operation: "read.retry",
    outcome: "error",
  });
  expect(logger.warn).not.toHaveBeenCalled();
  expect(logger.debug).toHaveBeenCalledTimes(2);
});

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
