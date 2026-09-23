import { describe, expect, test } from "bun:test";

import { idempotencyRedisKey, parseIdempotencyKey } from "./idempotency";

describe("parseIdempotencyKey", () => {
  test("allows a missing header", () => {
    expect(parseIdempotencyKey(null)).toEqual({ key: null, ok: true });
    expect(parseIdempotencyKey("")).toEqual({ key: null, ok: true });
  });

  test("accepts url-safe keys between 16 and 128 characters", () => {
    const key = "abcDEF0123456789_-xy";
    expect(parseIdempotencyKey(key)).toEqual({ key, ok: true });
  });

  test("rejects short, long or unsafe keys", () => {
    expect(parseIdempotencyKey("short")).toEqual({ ok: false });
    expect(parseIdempotencyKey("a".repeat(129))).toEqual({ ok: false });
    expect(parseIdempotencyKey("has spaces in it here!!")).toEqual({
      ok: false,
    });
  });
});

describe("idempotencyRedisKey", () => {
  test("scopes the key to the user", () => {
    expect(idempotencyRedisKey("u1", "k".repeat(16))).toBe(
      `post-idem:u1:${"k".repeat(16)}`
    );
  });
});
