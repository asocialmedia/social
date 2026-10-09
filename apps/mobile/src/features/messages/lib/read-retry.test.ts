import { expect, test } from "bun:test";

import { RequestTimeoutError } from "@/lib/http-get";

import { HistoryThrottledError } from "./history-throttle";
import { messageReadRetryDelay } from "./read-retry";

test("identity and transcript retries respect the server cooldown", () => {
  expect(messageReadRetryDelay(new HistoryThrottledError(60), 0)).toBe(60_000);
  expect(messageReadRetryDelay(new HistoryThrottledError(60), 2)).toBe(60_000);
});
test("a prolonged outage cannot create an endless retry loop", () => {
  expect(messageReadRetryDelay(new HistoryThrottledError(60), 3)).toBeNull();
  expect(
    messageReadRetryDelay(new TypeError("Network request failed"), 3)
  ).toBeNull();
});
test("network, timeout and server failures back off without resetting identity", () => {
  expect(
    messageReadRetryDelay(new TypeError("Network request failed"), 0)
  ).toBe(1000);
  expect(messageReadRetryDelay(new RequestTimeoutError(15_000), 1)).toBe(2000);
  expect(messageReadRetryDelay({ status: 503 }, 2)).toBe(3000);
});
test("membership and session errors are never automatically hammered", () => {
  expect(messageReadRetryDelay({ status: 401 }, 0)).toBeNull();
  expect(messageReadRetryDelay({ status: 403 }, 0)).toBeNull();
  expect(messageReadRetryDelay({ status: 404 }, 0)).toBeNull();
});
