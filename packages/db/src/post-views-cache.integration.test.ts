import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import {
  POST_VIEWS_KEY_PREFIX,
  POST_VIEWS_SET,
  postViewsCache,
  redis,
} from "./redis";

describe("postViewsCache.incrementView real redis deduplication", () => {
  const testPostId = `test-post-dedup-${Date.now()}`;
  const user1 = "test-user-alpha";
  const user2 = "test-user-beta";
  const anonHash = "test-hash-xyz";

  beforeEach(async () => {
    // Clear keys for this test post
    await redis.del(
      `${POST_VIEWS_KEY_PREFIX}${testPostId}`,
      `${POST_VIEWS_KEY_PREFIX}seen:${testPostId}:u:${user1}`,
      `${POST_VIEWS_KEY_PREFIX}seen:${testPostId}:u:${user2}`,
      `${POST_VIEWS_KEY_PREFIX}seen:${testPostId}:a:${anonHash}`
    );
    await redis.srem(POST_VIEWS_SET, testPostId);
  });

  afterAll(async () => {
    await redis.del(
      `${POST_VIEWS_KEY_PREFIX}${testPostId}`,
      `${POST_VIEWS_KEY_PREFIX}seen:${testPostId}:u:${user1}`,
      `${POST_VIEWS_KEY_PREFIX}seen:${testPostId}:u:${user2}`,
      `${POST_VIEWS_KEY_PREFIX}seen:${testPostId}:a:${anonHash}`
    );
    await redis.srem(POST_VIEWS_SET, testPostId);
  });

  // A dev environment running the auth worker shares this Redis: its view-flush
  // loop GETDELs a post's counter when it drains the stream into Postgres, so an
  // absolute counter value is not stable between calls. The dedup contract is
  // therefore asserted as incremented-vs-not rather than an exact total: a
  // deduplicated call must never raise the count, and a fresh identity always
  // raises it above zero.
  test("increments count on first view and deduplicates repeat views from the same user", async () => {
    // A fresh dedupe key always increments, so the atomic INCR is at least 1.
    const firstCount = await postViewsCache.incrementView(testPostId, {
      userId: user1,
    });
    expect(firstCount).toBeGreaterThan(0);

    // Repeat from the same user returns the current counter without raising it.
    const duplicateCount = await postViewsCache.incrementView(testPostId, {
      userId: user1,
    });
    expect(duplicateCount).toBeLessThanOrEqual(firstCount);

    // A different user is a fresh key, so this view does increment.
    const secondUserCount = await postViewsCache.incrementView(testPostId, {
      userId: user2,
    });
    expect(secondUserCount).toBeGreaterThan(0);
    expect(secondUserCount).toBeGreaterThanOrEqual(duplicateCount);

    // Repeat of the second user also does not increment.
    const duplicateUser2 = await postViewsCache.incrementView(testPostId, {
      userId: user2,
    });
    expect(duplicateUser2).toBeLessThanOrEqual(secondUserCount);
  });

  test("deduplicates anonymous views per viewerHash", async () => {
    const firstAnon = await postViewsCache.incrementView(testPostId, {
      viewerHash: anonHash,
    });
    expect(firstAnon).toBeGreaterThan(0);

    const duplicateAnon = await postViewsCache.incrementView(testPostId, {
      viewerHash: anonHash,
    });
    expect(duplicateAnon).toBeLessThanOrEqual(firstAnon);
  });
});
