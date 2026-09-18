import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  canViewCommunity,
  createCommunity,
  getCommunityBySlug,
  getCommunitySubscriberIds,
  getSubscribedCommunityIds,
  isSubscribedToCommunity,
  joinCommunity,
  leaveCommunity,
  notifyCommunitySubscribers,
  prisma,
  subscribeToCommunity,
  unsubscribeFromCommunity,
} from "@asm/db";

// Community subscriptions and the post-notification fan-out they drive.
// Subscribing is independent of membership for a PUBLIC community, but a
// PRIVATE one stays members-only: a stranger must not be able to follow (or
// infer the existence of) a community they cannot read. One shared fixture so
// the fan-out tests reuse the same owner/follower without a second user setup.

// Community names and slugs cap at 21 chars, so the run suffix stays short.
const RUN_ID = Math.random().toString(36).slice(2, 7);

const OWNER_ID = `sub-owner-${RUN_ID}`;
const FOLLOWER_ID = `sub-follower-${RUN_ID}`;
const STRANGER_ID = `sub-stranger-${RUN_ID}`;
const PUBLIC_SLUG = `subpub${RUN_ID}`;
const PRIVATE_SLUG = `sbprv${RUN_ID}`;
const FANOUT_SLUG = `sbfan${RUN_ID}`;

async function createUser(id: string): Promise<void> {
  await prisma.user.create({
    data: {
      displayName: id,
      email: `${id}@example.test`,
      id,
      username: id,
    },
  });
}

let publicCommunityId: string;
let privateCommunityId: string;
let fanoutCommunityId: string;
const fanoutPosts: string[] = [];

async function createFanoutPost(): Promise<string> {
  const post = await prisma.post.create({
    data: {
      communityId: fanoutCommunityId,
      content: "a community post",
      userId: OWNER_ID,
    },
  });
  fanoutPosts.push(post.id);
  return post.id;
}

// Runs the fan-out in a transaction exactly as the publish path does, returning
// the fresh-notification recipients.
async function runFanout(postId: string): Promise<string[]> {
  let fresh: string[] = [];
  await prisma.$transaction(async (tx) => {
    fresh = await notifyCommunitySubscribers(tx, {
      authorId: OWNER_ID,
      communityId: fanoutCommunityId,
      postId,
    });
  });
  return fresh;
}

beforeAll(async () => {
  await createUser(OWNER_ID);
  await createUser(FOLLOWER_ID);
  await createUser(STRANGER_ID);
  // Founding is gated on standing derived from earned ledger income, so the
  // owner needs a real aura balance AND a non-milestone ledger row before
  // createCommunity will pass.
  await prisma.user.update({
    data: { aura: 100_000 },
    where: { id: OWNER_ID },
  });
  await prisma.auraLog.create({
    data: {
      amount: 100_000,
      issuerId: OWNER_ID,
      targetUserId: OWNER_ID,
      type: "POST_CREATION",
      userId: OWNER_ID,
    },
  });

  const publicCommunity = await createCommunity({
    description: "A public community for the subscription test.",
    name: `SubPublic ${RUN_ID}`,
    ownerId: OWNER_ID,
    slug: PUBLIC_SLUG,
    topics: ["testing"],
    type: "PUBLIC",
  });
  publicCommunityId = publicCommunity.id;

  const privateCommunity = await createCommunity({
    description: "A private community for the subscription test.",
    name: `SubPriv ${RUN_ID}`,
    ownerId: OWNER_ID,
    slug: PRIVATE_SLUG,
    topics: ["testing"],
    type: "PRIVATE",
  });
  privateCommunityId = privateCommunity.id;

  const fanoutCommunity = await createCommunity({
    description: "Fan-out fixture community.",
    name: `SubFan ${RUN_ID}`,
    ownerId: OWNER_ID,
    slug: FANOUT_SLUG,
    topics: ["testing"],
    type: "PUBLIC",
  });
  fanoutCommunityId = fanoutCommunity.id;
  await subscribeToCommunity(fanoutCommunityId, FOLLOWER_ID);
});

afterAll(async () => {
  const userIds = [OWNER_ID, FOLLOWER_ID, STRANGER_ID];
  // Notifications and posts hold FKs that block the community/user deletes.
  await prisma.notification.deleteMany({
    where: { communityId: { in: [fanoutCommunityId] } },
  });
  await prisma.post.deleteMany({ where: { id: { in: fanoutPosts } } });
  // aura_logs holds a RESTRICT foreign key, so it must go before the users.
  await prisma.auraLog.deleteMany({
    where: { OR: [{ issuerId: { in: userIds } }, { userId: { in: userIds } }] },
  });
  // Cascades clear memberships and subscriptions with the communities.
  await prisma.community.deleteMany({
    where: {
      id: { in: [publicCommunityId, privateCommunityId, fanoutCommunityId] },
    },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("community subscriptions", () => {
  test("a public community can be followed without joining", async () => {
    expect(await isSubscribedToCommunity(publicCommunityId, FOLLOWER_ID)).toBe(
      false
    );
    await subscribeToCommunity(publicCommunityId, FOLLOWER_ID);
    expect(await isSubscribedToCommunity(publicCommunityId, FOLLOWER_ID)).toBe(
      true
    );
    // Independent of membership: no member row was created.
    const membership = await prisma.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId: publicCommunityId,
          userId: FOLLOWER_ID,
        },
      },
    });
    expect(membership).toBeNull();
  });

  test("subscribing twice is idempotent", async () => {
    await subscribeToCommunity(publicCommunityId, FOLLOWER_ID);
    const rows = await prisma.communitySubscription.count({
      where: { communityId: publicCommunityId, userId: FOLLOWER_ID },
    });
    expect(rows).toBe(1);
  });

  test("unsubscribing removes the follow and is a no-op when absent", async () => {
    await unsubscribeFromCommunity(publicCommunityId, FOLLOWER_ID);
    expect(await isSubscribedToCommunity(publicCommunityId, FOLLOWER_ID)).toBe(
      false
    );
    // A second unsubscribe must not throw.
    await expect(
      unsubscribeFromCommunity(publicCommunityId, FOLLOWER_ID)
    ).resolves.toBeUndefined();
  });

  test("a private community cannot be followed by a non-member", async () => {
    await expect(
      subscribeToCommunity(privateCommunityId, STRANGER_ID)
    ).rejects.toThrow("Community not found");
    expect(await isSubscribedToCommunity(privateCommunityId, STRANGER_ID)).toBe(
      false
    );
  });

  test("a private community can be followed once the member is approved", async () => {
    await joinCommunity(privateCommunityId, STRANGER_ID);
    // A PRIVATE join opens a PENDING request; approval flips it ACTIVE.
    const community = await getCommunityBySlug(PRIVATE_SLUG);
    expect(community).not.toBeNull();
    if (!community) {
      throw new Error("community missing");
    }
    await prisma.communityMember.update({
      data: { status: "ACTIVE" },
      where: {
        communityId_userId: {
          communityId: privateCommunityId,
          userId: STRANGER_ID,
        },
      },
    });
    const readable = await canViewCommunity(community, STRANGER_ID);
    expect(readable).toBe(true);
    await subscribeToCommunity(privateCommunityId, STRANGER_ID);
    expect(await isSubscribedToCommunity(privateCommunityId, STRANGER_ID)).toBe(
      true
    );
  });

  test("getSubscribedCommunityIds returns only currently-readable follows", async () => {
    await subscribeToCommunity(publicCommunityId, FOLLOWER_ID);
    const ids = await getSubscribedCommunityIds(FOLLOWER_ID);
    expect(ids).toContain(publicCommunityId);
    // The follower never joined the private community they don't follow.
    expect(ids).not.toContain(privateCommunityId);
  });

  test("leaving a private community drops its subscription and notifications", async () => {
    // STRANGER is an ACTIVE member of the private community (set up above) and
    // subscribed to it. Seed a post notification so the cleanup has something to
    // remove.
    await subscribeToCommunity(privateCommunityId, STRANGER_ID);
    const post = await prisma.post.create({
      data: {
        communityId: privateCommunityId,
        content: "private post",
        userId: OWNER_ID,
      },
    });
    await prisma.notification.create({
      data: {
        communityId: privateCommunityId,
        count: 1,
        issuerId: OWNER_ID,
        postId: post.id,
        recipientId: STRANGER_ID,
        type: "COMMUNITY_POST",
      },
    });

    await leaveCommunity(privateCommunityId, STRANGER_ID);

    // Read access is gone, so both the follow and the already-delivered
    // notification (whose rendered body carries the post) must be gone too.
    expect(await isSubscribedToCommunity(privateCommunityId, STRANGER_ID)).toBe(
      false
    );
    expect(
      await prisma.notification.count({
        where: { communityId: privateCommunityId, recipientId: STRANGER_ID },
      })
    ).toBe(0);

    await prisma.post.delete({ where: { id: post.id } });
  });

  test("the fan-out drops a stale subscription to a private community", async () => {
    // Simulate the leak directly: a subscription row for a user with no ACTIVE
    // membership (the state leave would have produced before cleanup existed).
    await prisma.communitySubscription.upsert({
      create: { communityId: privateCommunityId, userId: FOLLOWER_ID },
      update: {},
      where: {
        communityId_userId: {
          communityId: privateCommunityId,
          userId: FOLLOWER_ID,
        },
      },
    });

    const notified = await getCommunitySubscriberIds(
      privateCommunityId,
      OWNER_ID
    );
    expect(notified).not.toContain(FOLLOWER_ID);

    await prisma.communitySubscription.deleteMany({
      where: { communityId: privateCommunityId, userId: FOLLOWER_ID },
    });
  });
});

describe("community post notification fan-out", () => {
  test("excludes the author and returns the fresh recipients", async () => {
    const postId = await createFanoutPost();
    const fresh = await runFanout(postId);
    // The follower is notified; the author is not.
    expect(fresh).toEqual([FOLLOWER_ID]);
  });

  test("folds a second post into the unread row instead of adding another", async () => {
    const postId = await createFanoutPost();
    const fresh = await runFanout(postId);

    // An already-unread row is folded in place, so no new row and no unread
    // bump - the badge was already counting this reader.
    expect(fresh).toEqual([]);
    const rows = await prisma.notification.findMany({
      where: { communityId: fanoutCommunityId, recipientId: FOLLOWER_ID },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
    expect(rows[0]?.postId).toBe(postId);
  });

  test("starts a fresh row after the previous one is read", async () => {
    await prisma.notification.updateMany({
      data: { read: true },
      where: { communityId: fanoutCommunityId, recipientId: FOLLOWER_ID },
    });
    const postId = await createFanoutPost();
    const fresh = await runFanout(postId);

    expect(fresh).toEqual([FOLLOWER_ID]);
    const rows = await prisma.notification.findMany({
      where: { communityId: fanoutCommunityId, recipientId: FOLLOWER_ID },
    });
    expect(rows).toHaveLength(2);
    const unread = rows.find((row) => !row.read);
    expect(unread?.count).toBe(1);
  });

  test("getCommunitySubscriberIds excludes the given author", async () => {
    const ids = await getCommunitySubscriberIds(fanoutCommunityId, OWNER_ID);
    expect(ids).toEqual([FOLLOWER_ID]);
  });
});
