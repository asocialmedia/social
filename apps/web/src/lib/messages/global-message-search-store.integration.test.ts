import { afterEach, describe, expect, test } from "bun:test";

import { redis } from "@asm/db";

import {
  GLOBAL_SEARCH_SESSION_TTL_SECONDS,
  MAX_GLOBAL_SEARCH_SESSIONS,
  SAVE_GLOBAL_SEARCH_MANIFEST,
} from "./global-message-search-store";

const accountKey = `test:global-search-sessions:${crypto.randomUUID()}`;

afterEach(async () => {
  await redis.del(accountKey);
});

function save(index: number, now: number) {
  return redis.eval(
    SAVE_GLOBAL_SEARCH_MANIFEST,
    1,
    accountKey,
    `${now + 900_000 + index}:session-${index}`,
    `manifest-${index}`,
    now,
    GLOBAL_SEARCH_SESSION_TTL_SECONDS,
    MAX_GLOBAL_SEARCH_SESSIONS
  );
}

describe("atomic global search session storage", () => {
  test("bounds concurrent writes and retains the most recent session", async () => {
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) => save(index, now))
    );
    expect(results.every((result) => result === 1)).toBe(true);
    expect(await redis.hlen(accountKey)).toBe(MAX_GLOBAL_SEARCH_SESSIONS);
    expect(await redis.hget(accountKey, `${now + 900_099}:session-99`)).toBe(
      "manifest-99"
    );
    const ttl = await redis.ttl(accountKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(GLOBAL_SEARCH_SESSION_TTL_SECONDS);
  });

  test("purges expired entries even when newer searches extend the account TTL", async () => {
    const now = Date.now();
    await redis.hset(accountKey, `${now - 1}:expired`, "expired-manifest");
    await save(0, now);
    expect(await redis.hget(accountKey, `${now - 1}:expired`)).toBeNull();
    expect(await redis.hlen(accountKey)).toBe(1);
  });
});
