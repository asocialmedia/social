import { expect, test } from "bun:test";

import { mediaRequestWasCancelled } from "./request-cancellation";

test("SDK abort errors and closed requests do not become media proxy failures", () => {
  const { signal } = new AbortController();
  expect(
    mediaRequestWasCancelled(
      Object.assign(new Error("Request aborted"), { name: "AbortError" }),
      signal
    )
  ).toBe(true);
  expect(
    mediaRequestWasCancelled(
      new DOMException("Disconnected", "AbortError"),
      signal
    )
  ).toBe(true);
  expect(
    mediaRequestWasCancelled(new Error("Storage failed"), AbortSignal.abort())
  ).toBe(true);
  expect(mediaRequestWasCancelled(new Error("Storage failed"), signal)).toBe(
    false
  );
  expect(
    mediaRequestWasCancelled(
      new DOMException("Upstream timed out", "TimeoutError"),
      signal
    )
  ).toBe(false);
});
