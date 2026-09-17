import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createCommunity,
  getCommunityAuraMap,
  getCommunityBySlug,
  getMostActiveCategory,
  getRecentlyVisitedCommunities,
  getTopCommunitiesByAura,
  getCommunityCategoryCounts,
  getCommunityFeedPage,
  getCommunitySections,
  getCommunityStats,
  getJoinedCommunities,
  getMembership,
  joinCommunity,
  leaveCommunity,
  listCommunities,
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
  // Founding is gated on aura; the fixture owner must clear the first tier.
  await prisma.user.update({
    data: { aura: 1000 },
    where: { id: OWNER_ID },
  });
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
    expect(results.communities.some((c) => c.slug === SLUG)).toBe(true);
    expect(results.total).toBeGreaterThanOrEqual(1);
    const blank = await searchCommunities("   ", 10);
    expect(blank.communities).toHaveLength(0);
    expect(blank.total).toBe(0);
  });

  test("category counts and filtered listing", async () => {
    const counts = await getCommunityCategoryCounts();
    // "technology" rolls into the science-tech category.
    expect(counts["science-tech"]).toBeGreaterThanOrEqual(1);
    expect(counts.all).toBeGreaterThanOrEqual(1);
    // Categories hidden from discovery are never counted for the filter row.
    expect(counts.adult).toBeUndefined();

    const filtered = await listCommunities({ categories: ["technology"] });
    expect(filtered.communities.some((c) => c.slug === SLUG)).toBe(true);
    expect(filtered.total).toBeGreaterThanOrEqual(1);

    // A category the fixture does not belong to must not include it.
    const other = await listCommunities({ categories: ["sports"] });
    expect(other.communities.some((c) => c.slug === SLUG)).toBe(false);
  });

  test("aura map sums each community's posts and defaults to zero", async () => {
    const community = await getCommunityBySlug(SLUG);
    if (!community) {
      throw new Error("community missing");
    }

    // The three fixture posts carry 0 + 10 + 20.
    const auras = await getCommunityAuraMap([community.id]);
    expect(auras[community.id]).toBe(30);

    // An id with no posts still resolves to 0 rather than being absent, so the
    // card can read it without a fallback branch.
    const missing = await getCommunityAuraMap(["no-such-community"]);
    expect(missing["no-such-community"]).toBe(0);

    expect(await getCommunityAuraMap([])).toEqual({});
  });

  test("a growing community is excluded from the trending rail", async () => {
    const community = await getCommunityBySlug(SLUG);
    if (!community) {
      throw new Error("community missing");
    }

    const sections = await getCommunitySections();
    // The fixture is inside the growing window and has an active member, so it
    // is "growing" - and must therefore never also appear as "trending".
    expect(sections.growing.some((c) => c.id === community.id)).toBe(true);
    expect(sections.trending.some((c) => c.id === community.id)).toBe(false);

    const growingIds = new Set(sections.growing.map((c) => c.id));
    for (const trending of sections.trending) {
      expect(growingIds.has(trending.id)).toBe(false);
    }
  });
  test("sidebar leaderboards: top by aura, active category, recent visits", async () => {
    const community = await getCommunityBySlug(SLUG);
    if (!community) {
      throw new Error("community missing");
    }

    // The fixture's three posts make it the only community with aura, so it
    // must rank; a community with no posts can never outrank one with them.
    const topByAura = await getTopCommunitiesByAura();
    expect(topByAura.some((c) => c.id === community.id)).toBe(true);

    // "technology" files under science-tech, and the fixture is the only
    // community with posts, so that shelf wins.
    const active = await getMostActiveCategory();
    expect(active?.key).toBe("science-tech");
    expect(active?.count).toBeGreaterThanOrEqual(3);

    // The visit fixture recorded VISITOR_ID against this community.
    const recent = await getRecentlyVisitedCommunities(VISITOR_ID);
    const visit = recent.find((v) => v.community.id === community.id);
    expect(visit).toBeDefined();
    // Each row carries its visit time so the sidebar can show "x ago".
    expect(visit?.visitedAt).toBeInstanceOf(Date);

    // Guests have no trail at all.
    expect(await getRecentlyVisitedCommunities("")).toEqual([]);
  });
});
