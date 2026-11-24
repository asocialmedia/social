import { expect, test } from "bun:test";

import { processStorageRetryAt } from "./storage-retry";

test("a missing bucket defers processing with a bounded backoff", () => {
  const error = { code: "NoSuchBucket" };
  expect(processStorageRetryAt(error, 1, 1000)).toBe(31_000);
  expect(processStorageRetryAt(error, 2, 1000)).toBe(121_000);
  expect(processStorageRetryAt(error, 3, 1000)).toBe(301_000);
  expect(processStorageRetryAt(error, 4, 1000)).toBeUndefined();
});

test("missing objects and generic errors use normal queue failure handling", () => {
  expect(processStorageRetryAt({ code: "NoSuchKey" }, 1, 1000)).toBeUndefined();
  expect(
    processStorageRetryAt(new Error("Network failure"), 1, 1000)
  ).toBeUndefined();
});
