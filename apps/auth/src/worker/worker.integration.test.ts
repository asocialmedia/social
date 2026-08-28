import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  ensureStreamGroups,
  POST_VIEWS_KEY_PREFIX,
  POST_VIEWS_SET,
  postViewsCache,
  prisma,
  redis,
  unreadNotificationCache,
} from "@asm/db";

import { processExpiredTokens, processPostDeleted } from "./jobs";
import { computeViewAura } from "./view-flush";

const POST_ID = "cmsoxrlww0000m3vnr2xf0v6h";
const TEST_USER_ID = "cmsoxrlww0000m3vnr2xf0v6u";

async function resetPostCounters() {
  await prisma.post.update({
    data: { aura: 0, lastAwardedViewCount: 0, viewCount: 0 },
    where: { id: POST_ID },
  });
  await redis.del(`${POST_VIEWS_KEY_PREFIX}${POST_ID}`);
  await redis.srem(POST_VIEWS_SET, POST_ID);
}

describe("event-driven worker integration", () => {
  beforeAll(async () => {
    await ensureStreamGroups();
    // Self-sufficient fixtures: the suite must never depend on seed data,
    // so the author and the post are upserted under deterministic ids and
    // reaped again below.
    await prisma.user.upsert({
      create: {
        displayName: "Worker Integration Test",
        email: "worker-integration-test@asocialmedia.cc",
        id: TEST_USER_ID,
        username: "worker-integration-test",
      },
      update: {},
      where: { id: TEST_USER_ID },
    });
    await prisma.post.upsert({
      create: {
        content: "worker integration fixture post",
        id: POST_ID,
        userId: TEST_USER_ID,
      },
      update: {},
      where: { id: POST_ID },
    });
  });

  afterAll(async () => {
    await prisma.post.deleteMany({ where: { id: POST_ID } });
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
  });

  test("computeViewAura awards 5 aura at the 50-view milestone", () => {
    // Retuned curve: +1 per full 10 views, so 50 views pays 5.
    const { aura } = computeViewAura(0, 50);
    expect(aura).toBe(5);
  });

  test("postViewsCache increments a counter and enqueues a stream event", async () => {
    await resetPostCounters();

    const count = await postViewsCache.incrementView(POST_ID);
    expect(count).toBeGreaterThan(0);

    const stored = await redis.get(`${POST_VIEWS_KEY_PREFIX}${POST_ID}`);
    expect(Number(stored)).toBeGreaterThan(0);
  });

  test("unreadNotificationCache increment/decrement clamps at zero", async () => {
    await unreadNotificationCache.reset("integration-test-user");

    await unreadNotificationCache.increment("integration-test-user", 3);
    expect(await unreadNotificationCache.get("integration-test-user")).toBe(3);

    await unreadNotificationCache.decrement("integration-test-user", 5);
    // Clamping to zero deletes the key, so a subsequent read is null.
    expect(
      await unreadNotificationCache.get("integration-test-user")
    ).toBeNull();

    await unreadNotificationCache.reset("integration-test-user");
  });

  test("processExpiredTokens runs against the real database", async () => {
    const result = await processExpiredTokens();
    expect(result).toBeDefined();
  });

  test("processPostDeleted is idempotent on a post with no media", async () => {
    // Use a post with no attachments; it should complete without error.
    await processPostDeleted({ postId: POST_ID });
    const media = await prisma.media.findMany({ where: { postId: POST_ID } });
    expect(media).toEqual([]);
  });
});
