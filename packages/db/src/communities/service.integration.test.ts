import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createCommunity,
  getCommunityBySlug,
  getCommunityFeedPage,
  getCommunityStats,
  getJoinedCommunities,
  getMembership,
  joinCommunity,
  leaveCommunity,
  prisma,
  recordCommunityVisit,
  redis,
  searchCommunities,
} from "@asm/db";

const RUN_ID =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    .replaceAll("-", "_")
    .slice(0, 18);
const SLUG = `c${RUN_ID}`;
const OWNER_ID = `comm-it-owner-${RUN_ID}`;
const MEMBER_ID = `comm-it-member-${RUN_ID}`;
const VISITOR_ID = `comm-it-visitor-${RUN_ID}`;
const POST_IDS: string[] = [];

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

beforeAll(async () => {
  await createUser(OWNER_ID);
  await createUser(MEMBER_ID);
  await createUser(VISITOR_ID);
});

afterAll(async () => {
  const userIds = [OWNER_ID, MEMBER_ID, VISITOR_ID];
  // Community creation awards the creator aura, so the aura ledger rows (which
  // RESTRICT user deletes) must go first.
  await prisma.auraLog.deleteMany({
    where: { OR: [{ issuerId: { in: userIds } }, { userId: { in: userIds } }] },
  });
  // Community cascade removes membership + share rows; posts detach (SetNull)
  // so they must be deleted explicitly.
  await prisma.community.deleteMany({ where: { slug: SLUG } });
  await prisma.post.deleteMany({ where: { id: { in: POST_IDS } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await redis.del(`community:stats:${SLUG}`);
});

describe("community service integration", () => {
  test("creates a community with the owner as an active member", async () => {
    const community = await createCommunity({
      description: "Integration test community for the feed and stats paths.",
      name: "IT Community",
      ownerId: OWNER_ID,
      slug: SLUG,
      topics: ["technology"],
    });
    expect(community.slug).toBe(SLUG);

    const bySlug = await getCommunityBySlug(SLUG);
    expect(bySlug?.id).toBe(community.id);

    const membership = await getMembership(community.id, OWNER_ID);
    expect(membership).toEqual({ role: "OWNER", status: "ACTIVE" });
  });

  test("join / leave and the joined listing", async () => {
    const community = await getCommunityBySlug(SLUG);
    if (!community) {
      throw new Error("community missing");
    }

    await joinCommunity(community.id, MEMBER_ID);
    expect(await getMembership(community.id, MEMBER_ID)).toEqual({
      role: "MEMBER",
      status: "ACTIVE",
    });
    const joined = await getJoinedCommunities(MEMBER_ID);
    expect(joined.some((c) => c.id === community.id)).toBe(true);

    await leaveCommunity(community.id, MEMBER_ID);
    expect(await getMembership(community.id, MEMBER_ID)).toBeNull();
  });

  test("feed sorts by new and top and stats count contributors", async () => {
    const community = await getCommunityBySlug(SLUG);
    if (!community) {
      throw new Error("community missing");
    }

    const created = await Promise.all(
      [0, 1, 2].map((index) =>
        prisma.post.create({
          data: {
            aura: index * 10,
            communityId: community.id,
            content: `community post ${index}`,
            userId: OWNER_ID,
          },
        })
      )
    );
    POST_IDS.push(...created.map((post) => post.id));

    const newest = await getCommunityFeedPage({
      communityId: community.id,
      loggedInUserId: "",
      sort: "new",
    });
    expect(newest.posts).toHaveLength(3);
    expect(newest.nextCursor).toBeNull();

    const top = await getCommunityFeedPage({
      communityId: community.id,
      loggedInUserId: "",
      sort: "top",
    });
    expect(top.posts[0]?.aura).toBe(20);
    expect(top.posts[2]?.aura).toBe(0);

    const stats = await getCommunityStats(community.id);
    expect(stats.members).toBe(1);
    expect(stats.contributors).toBe(1);
    expect(stats.communityAura).toBe(30);
  });

  test("visit rows feed the weekly visitor count", async () => {
    const community = await getCommunityBySlug(SLUG);
    if (!community) {
      throw new Error("community missing");
    }
    await recordCommunityVisit(community.id, VISITOR_ID);
    // A second visit refreshes the same row rather than adding a second.
    await recordCommunityVisit(community.id, VISITOR_ID);
    const stats = await getCommunityStats(community.id);
    expect(stats.weeklyVisitors).toBe(1);
  });

  test("search finds the community and excludes unknown queries", async () => {
    const results = await searchCommunities("IT Community", 10);
    expect(results.some((c) => c.slug === SLUG)).toBe(true);
    expect(await searchCommunities("   ", 10)).toHaveLength(0);
  });
});
