import { expect, test } from "bun:test";

import { processStorageDeferral } from "./storage-retry";

test("a missing bucket defers processing with a bounded independent backoff", () => {
  const error = { code: "NoSuchBucket" };
  const first = processStorageDeferral(error, undefined, 1000);
  expect(first).toEqual({ bucketDeferrals: 1, retryAt: 31_000 });
  expect(
    processStorageDeferral(
      new Error("Network failure"),
      first?.bucketDeferrals,
      1000
    )
  ).toBeUndefined();
  const second = processStorageDeferral(error, first?.bucketDeferrals, 1000);
  expect(second).toEqual({ bucketDeferrals: 2, retryAt: 121_000 });
  const third = processStorageDeferral(error, second?.bucketDeferrals, 1000);
  expect(third).toEqual({ bucketDeferrals: 3, retryAt: 301_000 });
  expect(
    processStorageDeferral(error, third?.bucketDeferrals, 1000)
  ).toBeUndefined();
});

test("missing objects use normal queue failure handling", () => {
  expect(
    processStorageDeferral({ code: "NoSuchKey" }, 0, 1000)
  ).toBeUndefined();
});
