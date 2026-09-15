import {
  getCachedCommunityCategoryCounts,
  getCachedCommunityDiscoveryStats,
  getCachedCommunitySections,
  getCachedMostActiveCategory,
  getCachedTopCommunities,
  getCachedTopCommunitiesByAura,
  getCommunityAuraMap,
  getCommunityCategory,
  getJoinedCommunities,
  getRecentlyVisitedCommunities,
  listCommunities,
  searchCommunities,
} from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const logger = createLogger({ serviceName: "community-api" });

// Discovery listing + search. Public for everyone; when a session exists the
// response also carries the viewer's joined communities so the discovery page
// can flag the ones already joined without a second round trip.
export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const categoryKey = url.searchParams.get("category")?.trim() || "all";
  const cursor = url.searchParams.get("cursor")?.trim() || undefined;
  const joinedOnly = url.searchParams.get("joined") === "1";
  const limitParam = Number(url.searchParams.get("limit") ?? "24");
  const limit = Number.isFinite(limitParam) ? limitParam : 24;

  try {
    // The sidebar rail only needs the viewer's joined communities; skip the
    // listing, the counts and the totals entirely for that call.
    if (joinedOnly) {
      const joined = userId ? await getJoinedCommunities(userId) : [];
      return Response.json({
        auras: {},
        communities: [],
        counts: {},
        joined,
        nextCursor: null,
        sections: { growing: [], trending: [] },
        sidebar: {
          activeCategory: null,
          popular: [],
          recentVisits: [],
          topByAura: [],
        },
        stats: { communities: 0, members: 0, posts: 0 },
        total: joined.length,
      });
    }

    const category = getCommunityCategory(categoryKey);
    const [counts, joined, stats] = await Promise.all([
      getCachedCommunityCategoryCounts(),
      userId ? getJoinedCommunities(userId) : Promise.resolve([]),
      getCachedCommunityDiscoveryStats(),
    ]);

    // The sidebar is GLOBAL: its leaderboards and the viewer's own recent trail
    // describe the wider directory, not the current query. Fetched once here so
    // searching or filtering the grid never blanks it. Everything is cached.
    const [popular, topByAura, activeCategory, recentVisits] =
      await Promise.all([
        getCachedTopCommunities(),
        getCachedTopCommunitiesByAura(),
        getCachedMostActiveCategory(),
        userId ? getRecentlyVisitedCommunities(userId) : Promise.resolve([]),
      ]);
    const sidebar = { activeCategory, popular, recentVisits, topByAura };

    // A search overrides the category filter: the query is the intent, so the
    // grid's curated rails are suppressed (an empty sections payload). The
    // sidebar above is deliberately unaffected.
    if (q) {
      const result = await searchCommunities(q, limit);
      const auras = await getCommunityAuraMap([
        ...result.communities.map((community) => community.id),
        ...popular.map((community) => community.id),
        ...topByAura.map((community) => community.id),
        ...recentVisits.map((visit) => visit.community.id),
        ...joined.map((community) => community.id),
      ]);
      return Response.json({
        auras,
        communities: result.communities,
        counts,
        joined,
        nextCursor: null,
        sections: { growing: [], trending: [] },
        sidebar,
        stats,
        total: result.total,
      });
    }

    const page = await listCommunities({
      categories: category?.topics.length ? [...category.topics] : undefined,
      cursor,
      limit,
    });

    // The curated rails only belong on the unfiltered first page; deeper pages
    // and category-filtered views reuse the listing without them.
    const isDefaultView = !cursor && category?.key === "all";
    const rawSections = isDefaultView
      ? await getCachedCommunitySections()
      : { growing: [], trending: [] };

    // The rails are for DISCOVERY: a community the viewer already belongs to
    // is already shown by "Joined communities", so it is dropped from both
    // rails rather than repeated. Filtering here (not in the query) keeps the
    // cached section payload viewer-agnostic. The sidebar (already built above)
    // is global and deliberately not filtered this way.
    const joinedIds = new Set(joined.map((community) => community.id));
    const sections = {
      growing: rawSections.growing.filter(
        (community) => !joinedIds.has(community.id)
      ),
      trending: rawSections.trending.filter(
        (community) => !joinedIds.has(community.id)
      ),
    };

    // One batched aggregate covers every community on this response (grid +
    // both rails + the joined rail + the sidebar lists), so per-card aura costs
    // a single query.
    const auras = await getCommunityAuraMap([
      ...page.communities.map((community) => community.id),
      ...joined.map((community) => community.id),
      ...sections.growing.map((community) => community.id),
      ...sections.trending.map((community) => community.id),
      ...sidebar.popular.map((community) => community.id),
      ...sidebar.topByAura.map((community) => community.id),
      ...sidebar.recentVisits.map((visit) => visit.community.id),
    ]);

    return Response.json({
      auras,
      communities: page.communities,
      counts,
      joined,
      nextCursor: page.nextCursor,
      sections,
      sidebar,
      stats,
      total: page.total,
    });
  } catch (error) {
    logger.error({ error: String(error) }, "community list failed");
    return Response.json(
      { error: "Couldn't load communities" },
      { status: 500 }
    );
  }
}
