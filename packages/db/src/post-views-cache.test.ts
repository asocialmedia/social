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

  test("increments count on first view and deduplicates repeat views from the same user", async () => {
    // First view from user1 -> increments to 1
    const firstCount = await postViewsCache.incrementView(testPostId, {
      userId: user1,
    });
    expect(firstCount).toBe(1);

    // Immediate repeat view from same user1 -> returns 1 without incrementing
    const duplicateCount = await postViewsCache.incrementView(testPostId, {
      userId: user1,
    });
    expect(duplicateCount).toBe(1);

    // View from user2 -> increments to 2
    const secondUserCount = await postViewsCache.incrementView(testPostId, {
      userId: user2,
    });
    expect(secondUserCount).toBe(2);

    // Immediate repeat view from user2 -> returns 2 without incrementing
    const duplicateUser2 = await postViewsCache.incrementView(testPostId, {
      userId: user2,
    });
    expect(duplicateUser2).toBe(2);
  });

  test("deduplicates anonymous views per viewerHash", async () => {
    const firstAnon = await postViewsCache.incrementView(testPostId, {
      viewerHash: anonHash,
    });
    expect(firstAnon).toBe(1);

    const duplicateAnon = await postViewsCache.incrementView(testPostId, {
      viewerHash: anonHash,
    });
    expect(duplicateAnon).toBe(1);
  });
});
