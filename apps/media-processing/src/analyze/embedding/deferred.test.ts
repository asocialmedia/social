import { expect, test } from "bun:test";

import { embeddingRetryAt } from "./deferred";

test("embedding retries honor provider delays with bounded fallback for rate limits and outages", () => {
  const now = Date.UTC(2026, 10, 6);
  expect(embeddingRetryAt(429, null, now)).toBe(now + 900_000);
  expect(embeddingRetryAt(503, "120", now)).toBe(now + 120_000);
  expect(
    embeddingRetryAt(503, new Date(now + 180_000).toUTCString(), now)
  ).toBe(now + 180_000);
  expect(embeddingRetryAt(401, null, now)).toBe(now + 6 * 60 * 60_000);
  expect(embeddingRetryAt(500, "-1", now)).toBe(now + 60_000);
  expect(embeddingRetryAt(429, "99999999", now)).toBe(now + 86_400_000);
});
