import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { randomUUID } from "node:crypto";

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
  toPrismaDateTime,
} from "@asm/db";
import { and, or } from "@prisma/orm-postgres/orm-client";

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
  await prisma.orm.public.Users.create({
    displayName: id,
    email: `${id}@example.test`,
    id,
    username: id,
  });
}

let publicCommunityId: string;
let privateCommunityId: string;
let fanoutCommunityId: string;
const fanoutPosts: string[] = [];

// A far-past createdAt keeps these fixture posts OUT of the newest-N global
// candidate pools that other integration suites (the For-You feed test) rank
// over: a post that is concurrently ranked and then deleted by this suite's
// cleanup makes that test intermittently see a short page. The notification
// fan-out does not read createdAt, so an arbitrary timestamp is harmless here.
const FANOUT_POST_CREATED_AT = new Date("2020-01-01T00:00:00.000Z");

async function createFanoutPost(): Promise<string> {
  const post = await prisma.orm.public.Posts.create({
    communityId: fanoutCommunityId,
    content: "a community post",
    createdAt: toPrismaDateTime(FANOUT_POST_CREATED_AT),
    id: randomUUID(),
    userId: OWNER_ID,
  });
  fanoutPosts.push(post.id);
  return post.id;
}

// Runs the fan-out in a transaction exactly as the publish path does, returning
// the fresh-notification recipients.
async function runFanout(postId: string): Promise<string[]> {
  let fresh: string[] = [];
  await prisma.transaction(async (tx) => {
    const created = await notifyCommunitySubscribers(tx, {
      authorId: OWNER_ID,
      communityId: fanoutCommunityId,
      postId,
    });
    fresh = created.map((notification) => notification.recipientId);
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
  await prisma.orm.public.Users.where((user) =>
    user.id.eq(OWNER_ID)
  ).updateAndCount({
    aura: 100_000,
  });
  await prisma.orm.public.AuraLogs.create({
    _type: "COMMUNITY_JOIN",
    amount: 100_000,
    id: randomUUID(),
    issuerId: OWNER_ID,
    targetUserId: OWNER_ID,
    userId: OWNER_ID,
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
  await prisma.orm.public.Notifications.where((notification) =>
    notification.communityId.eq(fanoutCommunityId)
  ).deleteAndCount();
  await prisma.orm.public.Posts.where((post) =>
    post.id.in(fanoutPosts)
  ).deleteAndCount();
  await prisma.orm.public.AuraLogs.where((log) =>
    or(log.issuerId.in(userIds), log.userId.in(userIds))
  ).deleteAndCount();
  await prisma.orm.public.Communities.where((community) =>
    community.id.in([publicCommunityId, privateCommunityId, fanoutCommunityId])
  ).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in(userIds)
  ).deleteAndCount();
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
    const membership = await prisma.orm.public.CommunityMembers.select("id")
      .where((member) =>
        and(
          member.communityId.eq(publicCommunityId),
          member.userId.eq(FOLLOWER_ID)
        )
      )
      .first();
    expect(membership).toBeNull();
  });

  test("subscribing twice is idempotent", async () => {
    await subscribeToCommunity(publicCommunityId, FOLLOWER_ID);
    const rows = await prisma.orm.public.CommunitySubscriptions.where(
      (subscription) =>
        and(
          subscription.communityId.eq(publicCommunityId),
          subscription.userId.eq(FOLLOWER_ID)
        )
    ).aggregate((aggregate) => ({ count: aggregate.count() }));
    expect(rows.count).toBe(1);
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
    await prisma.orm.public.CommunityMembers.where((member) =>
      and(
        member.communityId.eq(privateCommunityId),
        member.userId.eq(STRANGER_ID)
      )
    ).updateAndCount({ status: "ACTIVE" });
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
    const post = await prisma.orm.public.Posts.create({
      communityId: privateCommunityId,
      content: "private post",
      id: randomUUID(),
      userId: OWNER_ID,
    });
    await prisma.orm.public.Notifications.create({
      _type: "COMMUNITY_POST",
      communityId: privateCommunityId,
      count: 1,
      id: randomUUID(),
      issuerId: OWNER_ID,
      postId: post.id,
      recipientId: STRANGER_ID,
    });

    await leaveCommunity(privateCommunityId, STRANGER_ID);

    // Read access is gone, so both the follow and the already-delivered
    // notification (whose rendered body carries the post) must be gone too.
    expect(await isSubscribedToCommunity(privateCommunityId, STRANGER_ID)).toBe(
      false
    );
    const remainingNotifications = await prisma.orm.public.Notifications.where(
      (notification) =>
        and(
          notification.communityId.eq(privateCommunityId),
          notification.recipientId.eq(STRANGER_ID)
        )
    ).aggregate((aggregate) => ({ count: aggregate.count() }));
    expect(remainingNotifications.count).toBe(0);

    await prisma.orm.public.Posts.where((candidate) =>
      candidate.id.eq(post.id)
    ).deleteAndCount();
  });

  test("the fan-out drops a stale subscription to a private community", async () => {
    // Simulate the leak directly: a subscription row for a user with no ACTIVE
    // membership (the state leave would have produced before cleanup existed).
    await prisma.orm.public.CommunitySubscriptions.create({
      communityId: privateCommunityId,
      id: randomUUID(),
      userId: FOLLOWER_ID,
    });

    const notified = await getCommunitySubscriberIds(
      privateCommunityId,
      OWNER_ID
    );
    expect(notified).not.toContain(FOLLOWER_ID);

    await prisma.orm.public.CommunitySubscriptions.where((subscription) =>
      and(
        subscription.communityId.eq(privateCommunityId),
        subscription.userId.eq(FOLLOWER_ID)
      )
    ).deleteAndCount();
  });
});

describe("community post notification fan-out", () => {
  // Each case owns the notification state it asserts on. The fan-out's behavior
  // depends on which unread rows already exist, so a shared fixture would make
  // these pass only when run in file order (and fail under a name filter). A
  // clean slate per test keeps fresh/fold/row-count independent of order.
  beforeEach(async () => {
    await prisma.orm.public.Notifications.where((notification) =>
      notification.communityId.eq(fanoutCommunityId)
    ).deleteAndCount();
  });

  test("excludes the author and creates one unread row per subscriber", async () => {
    const postId = await createFanoutPost();
    const fresh = await runFanout(postId);

    // The follower gets a fresh row; the author is not notified.
    expect(fresh).toEqual([FOLLOWER_ID]);
    const rows = await prisma.orm.public.Notifications.where((notification) =>
      and(
        notification.communityId.eq(fanoutCommunityId),
        notification.recipientId.eq(FOLLOWER_ID)
      )
    ).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(1);
    expect(rows[0]?.postId).toBe(postId);
    expect(rows[0]?.read).toBe(false);
  });

  test("folds a second post into the unread row instead of adding another", async () => {
    // Seed exactly the state this case is about: one unread row already waiting.
    await runFanout(await createFanoutPost());

    const postId = await createFanoutPost();
    const fresh = await runFanout(postId);

    // An already-unread row is folded in place, so no new row and no unread
    // bump - the badge was already counting this reader.
    expect(fresh).toEqual([]);
    const rows = await prisma.orm.public.Notifications.where((notification) =>
      and(
        notification.communityId.eq(fanoutCommunityId),
        notification.recipientId.eq(FOLLOWER_ID)
      )
    ).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
    expect(rows[0]?.postId).toBe(postId);
  });

  test("starts a fresh row after the previous one is read", async () => {
    // Seed a read row, so the next fan-out has nothing to fold into.
    await runFanout(await createFanoutPost());
    await prisma.orm.public.Notifications.where((notification) =>
      and(
        notification.communityId.eq(fanoutCommunityId),
        notification.recipientId.eq(FOLLOWER_ID)
      )
    ).updateAndCount({ read: true });

    const postId = await createFanoutPost();
    const fresh = await runFanout(postId);

    expect(fresh).toEqual([FOLLOWER_ID]);
    const rows = await prisma.orm.public.Notifications.where((notification) =>
      and(
        notification.communityId.eq(fanoutCommunityId),
        notification.recipientId.eq(FOLLOWER_ID)
      )
    ).all();
    expect(rows).toHaveLength(2);
    const unread = rows.find((row) => !row.read);
    expect(unread?.count).toBe(1);
    expect(unread?.postId).toBe(postId);
  });

  test("getCommunitySubscriberIds excludes the given author", async () => {
    const ids = await getCommunitySubscriberIds(fanoutCommunityId, OWNER_ID);
    expect(ids).toEqual([FOLLOWER_ID]);
  });
});
