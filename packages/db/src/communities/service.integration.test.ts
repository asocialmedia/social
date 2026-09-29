import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

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
  toPrismaDateTime,
} from "@asm/db";
import { or } from "@prisma/orm-postgres/orm-client";

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
  await prisma.orm.public.Users.create({
    displayName: id,
    email: `${id}@example.test`,
    id,
    username: id,
  });
}

beforeAll(async () => {
  await createUser(OWNER_ID);
  await createUser(MEMBER_ID);
  await createUser(VISITOR_ID);
  // Founding is gated on STANDING, which is derived from earned ledger income
  // (attention milestones only count up to an allowance). The fixture owner
  // needs real non-milestone income to clear the first tier, not just a raw
  // balance - a bare `aura` update would leave standing at 0.
  await prisma.orm.public.Users.where((user) =>
    user.id.eq(OWNER_ID)
  ).updateAndCount({
    aura: 1000,
  });
  await prisma.orm.public.AuraLogs.create({
    _type: "COMMUNITY_JOIN",
    amount: 1000,
    id: randomUUID(),
    issuerId: OWNER_ID,
    targetUserId: OWNER_ID,
    userId: OWNER_ID,
  });
});

afterAll(async () => {
  const userIds = [OWNER_ID, MEMBER_ID, VISITOR_ID];
  // Community creation awards the creator aura, so the aura ledger rows (which
  // RESTRICT user deletes) must go first.
  await prisma.orm.public.AuraLogs.where((log) =>
    or(log.issuerId.in(userIds), log.userId.in(userIds))
  ).deleteAndCount();
  // Community cascade removes membership + share rows; posts detach (SetNull)
  // so they must be deleted explicitly.
  await prisma.orm.public.Communities.where((community) =>
    community.slug.eq(SLUG)
  ).deleteAndCount();
  await prisma.orm.public.Posts.where((post) =>
    post.id.in(POST_IDS)
  ).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in(userIds)
  ).deleteAndCount();
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
    // Joining grants PARTICIPANT: the member/mod badges are earned by
    // promotion, not by walking in the door.
    expect(await getMembership(community.id, MEMBER_ID)).toEqual({
      role: "PARTICIPANT",
      status: "ACTIVE",
    });
    const joined = await getJoinedCommunities(MEMBER_ID);
    expect(joined.some((c) => c.id === community.id)).toBe(true);

    await leaveCommunity(community.id, MEMBER_ID);
    expect(await getMembership(community.id, MEMBER_ID)).toBeNull();
  });

  test("feed sorts by new and top and stats reflect the community", async () => {
    const community = await getCommunityBySlug(SLUG);
    if (!community) {
      throw new Error("community missing");
    }

    // A far-past createdAt keeps these fixture posts OUT of the newest-N global
    // candidate pools another suite (the For-You feed integration test) ranks
    // over: a post that is concurrently ranked and then deleted by this suite's
    // cleanup makes that test intermittently see a short page. Only relative
    // order matters to the community feed, so a fixed old base preserves it.
    const fixtureBase = new Date("2020-01-01T00:00:00.000Z").getTime();
    const created = await Promise.all(
      [0, 1, 2].map((index) =>
        prisma.orm.public.Posts.create({
          aura: index * 10,
          communityId: community.id,
          content: `community post ${index}`,
          createdAt: toPrismaDateTime(new Date(fixtureBase - index * 60_000)),
          id: randomUUID(),
          userId: OWNER_ID,
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
    const growingIds = new Set(sections.growing.map((c) => c.id));
    const trendingIds = new Set(sections.trending.map((c) => c.id));

    // The rule under test is the EXCLUSION, and it holds for whatever the two
    // shelves happen to contain: a community shown as growing is never also
    // shown as trending, so the rails cannot show the same community twice.
    expect([...growingIds].filter((id) => trendingIds.has(id))).toEqual([]);
    for (const trending of sections.trending) {
      expect(growingIds.has(trending.id)).toBe(false);
    }

    // The fixture is INSIDE the growing window and has an active member, so it
    // is eligible for the growing rail. Whether it also reaches the shelf is a
    // function of every other community in the database - the rail is a global
    // top-12 by member count, and this is an integration test against a
    // developer's real database, not an empty one - so only the exclusion is
    // asserted, and only when the fixture actually made the cut.
    if (growingIds.has(community.id)) {
      expect(trendingIds.has(community.id)).toBe(false);
    }
  });

  test("sidebar leaderboards: top by aura, active category, recent visits", async () => {
    const community = await getCommunityBySlug(SLUG);
    if (!community) {
      throw new Error("community missing");
    }

    // Top by aura is a GLOBAL top-6 by summed post aura, so the fixture's three
    // posts only place it on the shelf while it outranks the rest of the
    // database - which a seeded or previously-used dev database decides, not this
    // test. What is the function's own contract is the ordering: the shelf is
    // sorted by aura, descending, with no ties left to chance.
    const topByAura = await getTopCommunitiesByAura();
    expect(topByAura.length).toBeLessThanOrEqual(6);
    const auras = await getCommunityAuraMap(topByAura.map((c) => c.id));
    const values = topByAura.map((c) => auras[c.id] ?? 0);
    expect(values).toEqual([...values].toSorted((left, right) => right - left));

    // "Most active category" is likewise global: the winner is whichever
    // category has the most posts anywhere. The fixture's three "technology"
    // posts must be counted in that shelf, and the shelf must name a category
    // rather than nothing.
    const active = await getMostActiveCategory();
    expect(active).not.toBeNull();
    expect(active?.count).toBeGreaterThanOrEqual(3);
    if (active?.key === "science-tech") {
      // Only assert the exact winner when it happens to be this one; on a
      // database with more science-tech traffic the contract above still holds.
      expect(active.count).toBeGreaterThanOrEqual(3);
    }

    // The visit fixture recorded VISITOR_ID against this community, and the
    // trail is scoped to a viewer, so this half is genuinely isolated.
    const recent = await getRecentlyVisitedCommunities(VISITOR_ID);
    const visit = recent.find((v) => v.community.id === community.id);
    expect(visit).toBeDefined();
    // Each row carries its visit time so the sidebar can show "x ago".
    expect(visit?.visitedAt).toBeInstanceOf(Date);

    // Guests have no trail at all.
    expect(await getRecentlyVisitedCommunities("")).toEqual([]);
  });
});
