import { createHash } from "node:crypto";

import {
  and,
  or,
  communityVisibilityWhere,
  getPostDataQuery,
  getSubscribedCommunityIds,
  hydrateViewCounts,
  mapPostData,
  NETWORK_FEED_TTL_SECONDS,
  networkContentTopics,
  networkLanguageMatches,
  networkRegionalAffinity,
  networkSql,
  prisma,
  redis,
  scoreCandidate,
  networkSocialCandidates,
  computeVisibilityWeight,
  rankFeed,
  getNotInterestedPostIds,
  NetworkPreferenceConflictError,
} from "@asm/db";
import type { PostData, UserProfile } from "@asm/db";
import {
  networkInterestTerms,
  SharedReadCache,
  BoundedReadQueue,
  createRedisReadStore,
  isDiscoveryColdStart,
} from "@asm/protocols/discovery";
import { z } from "zod";

import { feedPostView } from "@/lib/posts/feed-post-view";
import {
  networkPostAllowed,
  postNetworkInterestScore,
} from "@/lib/posts/network-content-policy";
import {
  isGuestQualityPost,
  isTrendingPost,
} from "@/lib/posts/trending-eligibility";
import { uniqueFeedContent } from "@/lib/posts/unique-feed-content";

import { exploreTopics } from "./explore-topics";
import { admitFeedRead } from "./feed-admission";
import { feedTiming } from "./feed-timing";
import type { FeedTiming } from "./feed-timing";
import { reportRecommendationHealth } from "./health";
import { diversifyExploreCandidates } from "./mix-explore";
import { nativeCandidateIds } from "./native-candidates";
import type { NetworkFeedContext } from "./network-context";
import { networkFeedContext } from "./network-context";
import { signNetworkObservation } from "./network-observation";
import { readServedIds, recordServedIds, servedSetKey } from "./served-set";

const snapshotSchema = z.object({
  anchor: z.string().default(() => new Date().toISOString()),
  candidateOffset: z.number().int().min(0).max(100_000).default(0),
  ids: z.array(z.string()).max(400),
  level: z.number().int().min(0).max(2).default(0),
  moreCandidates: z.boolean().default(false),
  scope: z.string(),
  seen: z.array(z.string()).max(2000).default([]),
});

export function networkTopicAffinity(
  text: string,
  topics: string[],
  profile: UserProfile
): number {
  const normalized = text.normalize("NFKC").toLowerCase();
  const declared = new Set(
    topics.map((topic) => topic.toLowerCase().replaceAll("-", " "))
  );
  let affinity = 0;
  const weights = {
    ...profile.expandedEntityWeights,
    ...profile.tagWeights,
    ...profile.sessionTagWeights,
  };
  for (const [raw, weight] of Object.entries(weights)) {
    const topic = raw.toLowerCase().replaceAll("-", " ");
    const escaped = topic.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (
      declared.has(topic) ||
      new RegExp(
        `(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
        "u"
      ).test(normalized)
    ) {
      affinity += Math.max(0, weight);
    }
  }
  return affinity;
}

function topicsOf(post: PostData) {
  return networkContentTopics(post.content, [
    ...(post.semanticTags ?? []),
    ...post.tags.map((tag) => tag.name),
  ]);
}

const headCache = new SharedReadCache({
  deadlineMs: 15_000,
  parse: (value) => z.string().parse(value),
  queue: new BoundedReadQueue({
    // Admission already bounds foreground work to 32; a second eight-job gate serialized distinct viewers.
    concurrency: 32,
    maxQueued: 128,
    maxWaitMs: 5000,
  }),
  store: createRedisReadStore(redis),
  ttlMs: 15_000,
});

export async function networkNativeFeed(
  request: Request,
  userId: string | (() => Promise<string>),
  mode: "personalized" | "trending" | "latest",
  contentKind: "post" | "gust" = "post"
) {
  try {
    return await admitFeedRead(request, async () => {
      const viewerId =
        typeof userId === "function"
          ? await feedTiming(request).measure("auth", userId)
          : userId;
      return await readNetworkNativeFeed(request, viewerId, mode, contentKind);
    });
  } catch (error) {
    reportRecommendationHealth("native-feed", false, error);
    return feedTiming(request).finish(
      Response.json(
        { error: "Feed is busy. Try again shortly." },
        {
          headers: { "cache-control": "private, no-store", "retry-after": "2" },
          status: 503,
        }
      ),
      "native"
    );
  }
}

async function readNetworkNativeFeed(
  request: Request,
  userId: string,
  mode: "personalized" | "trending" | "latest",
  contentKind: "post" | "gust"
) {
  const timing = feedTiming(request);
  try {
    const query = new URL(request.url).searchParams;
    const context = await timing.measure("features", () =>
      networkFeedContext(userId || undefined, query.get("profile") ?? undefined)
    );
    // A freshness probe must observe new arrivals instead of replaying a cached head.
    if (
      mode === "latest" &&
      query.get("refresh") === "1" &&
      !query.has("cursor")
    ) {
      return timing.finish(
        await buildNetworkNativeFeed(
          request,
          userId,
          mode,
          contentKind,
          context,
          timing
        ),
        "native"
      );
    }
    // Empty cursor keys are malformed continuations and must not restart the feed.
    const cursorParam = query.get("cursor");
    if (cursorParam !== null) {
      if (cursorParam === "") {
        return timing.finish(
          Response.json({ error: "Refresh this feed" }, { status: 410 }),
          "native"
        );
      }
      return timing.finish(
        await buildNetworkNativeFeed(
          request,
          userId,
          mode,
          contentKind,
          context,
          timing
        ),
        "native"
      );
    }
    // The served count is part of the key so a viewer with history gets a fresh
    // ordering, while concurrent loads of the same page still share one read.
    // Both histories affect head ranking when a viewer switches surfaces.
    const servedCounts = userId
      ? await Promise.all(
          ["home", "explore"].map((surface) =>
            redis
              .zcard(servedSetKey(userId, `${surface}:${contentKind}:${mode}`))
              .catch(() => 0)
          )
        )
      : [0, 0];
    const recentServedPages = await Promise.all(
      ["home", "explore"].map((surface) =>
        readServedIds(userId, `${surface}:${contentKind}:${mode}`, 50)
      )
    );
    const version = userId
      ? await redis.get(`rec:suggestions:version:${userId}`).catch(() => null)
      : "guest";
    const key = `rec:native-head:v9:{${createHash("sha256")
      .update(
        JSON.stringify([
          userId,
          context.selected.id,
          context.revision,
          version,
          mode,
          contentKind,
          query.get("surface"),
          query.get("take"),
          query.get("locale"),
          query.get("source"),
          servedCounts,
          recentServedPages,
        ])
      )
      .digest("hex")}}`;
    const body = await timing.measure("cache", () =>
      headCache.read(
        key,
        async () => {
          const response = await buildNetworkNativeFeed(
            request,
            userId,
            mode,
            contentKind,
            context,
            timing
          );
          if (!response.ok) {
            throw new Error(`Native feed returned ${response.status}`);
          }
          return response.text();
        },
        request.signal
      )
    );
    reportRecommendationHealth("native-feed", true);
    return timing.finish(
      new Response(body, {
        headers: {
          "cache-control": "private, no-store",
          "content-type": "application/json",
          vary: "Cookie",
        },
      }),
      "native"
    );
  } catch (error) {
    if (error instanceof NetworkPreferenceConflictError) {
      return timing.finish(
        Response.json(
          { error: "Choose an available recommendation profile" },
          { status: 409 }
        ),
        "native"
      );
    }
    reportRecommendationHealth("native-feed", false, error);
    return timing.finish(
      Response.json(
        { error: "Feed is temporarily unavailable" },
        {
          headers: { "cache-control": "private, no-store", "retry-after": "2" },
          status: 503,
        }
      ),
      "native"
    );
  }
}

async function buildNetworkNativeFeed(
  request: Request,
  userId: string,
  mode: "personalized" | "trending" | "latest",
  contentKind: "post" | "gust",
  context: NetworkFeedContext,
  timing: FeedTiming
) {
  const query = new URL(request.url).searchParams;
  const exploring = query.get("surface") === "explore";
  const neighboringTopics = exploreTopics(
    context.profile,
    context.selected.interests,
    context.preferences.avoidedTopics,
    context.topicScope
  );
  const focused = mode !== "latest" && query.get("source") !== "asm";
  let maximumLevel = 0;
  if (focused) {
    maximumLevel = context.selected.interests.length ? 1 : 2;
  }
  const scope = `v13:${focused ? "focused" : "native"}:${exploring ? "explore" : "home"}:${userId || "guest"}:${context.selected.id}:${context.revision}:${context.topicScope?.version ?? "exact"}:${mode}:${contentKind}`;
  const coldStart = isDiscoveryColdStart(
    context.selected.interests,
    context.profile,
    "persona" in context ? context.persona.signalCount : 0
  );
  const social = await timing.measure("graph", () =>
    networkSocialCandidates(userId)
  );
  const socialById = new Map(social.native.map((entry) => [entry.id, entry]));
  const cursor = query.get("cursor") ?? undefined;
  const take = query.get("take") ?? (contentKind === "gust" ? "10" : "20");
  // Clamp numerically instead of falling back: `take=0` used to mean "the default
  // page", so a client asking for nothing got a full page.
  const requestedTake = Math.trunc(Number(take));
  const pageSize =
    Number.isFinite(requestedTake) && requestedTake > 0
      ? Math.min(20, requestedTake)
      : 20;
  let ids: string[] = [];
  let generation = crypto.randomUUID();
  let offset = 0;
  let canContinue = true;
  let level = 0;
  let candidateOffset = 0;
  let moreCandidates = false;
  let seen: string[] = [];
  let anchor = new Date().toISOString();
  let buildBatch = !cursor;
  if (cursor) {
    const match =
      /^nf1\.(?<generation>[a-f\d-]{36})\.(?<offset>\d{1,4})$/i.exec(cursor);
    if (!match?.groups?.generation || !match.groups.offset) {
      return Response.json({ error: "Refresh this feed" }, { status: 410 });
    }
    ({ generation } = match.groups);
    offset = Number(match.groups.offset);
    const stored = await redis
      .get(`rec:network-feed:v1:${generation}`)
      .catch(() => null);
    const parsed = snapshotSchema.safeParse(stored ? JSON.parse(stored) : null);
    if (!parsed.success || parsed.data.scope !== scope) {
      return Response.json({ error: "Refresh this feed" }, { status: 410 });
    }
    ({ ids, level, candidateOffset, moreCandidates, seen, anchor } =
      parsed.data);
    if (offset >= ids.length) {
      generation = crypto.randomUUID();
      seen = [...new Set([...seen, ...ids])].slice(-2000);
      if (moreCandidates) {
        candidateOffset += 180;
      } else {
        level += 1;
        candidateOffset = 0;
      }
      if (level > maximumLevel || (mode === "latest" && level > 0)) {
        return Response.json({ nextCursor: null, posts: [] });
      }
      offset = 0;
      buildBatch = true;
    }
  }
  const stopRetrieval = timing.start("retrieval");
  // Keep each surface's record and consider both when ranking a fresh head.
  const servedFeed = `${exploring ? "explore" : "home"}:${contentKind}:${mode}`;
  // Only a fresh head asks what this viewer already saw; a continuation page
  // belongs to the same snapshot and must not shift under the reader.
  const servedGroups =
    buildBatch && !cursor && mode !== "latest"
      ? await Promise.all(
          ["home", "explore"].map((surface) =>
            readServedIds(userId, `${surface}:${contentKind}:${mode}`)
          )
        )
      : [];
  const served = [...new Set(servedGroups.flat())];
  // Ranking re-sorts by score, which would discard the retrieval query's
  // served-last ordering. Demote seen ids in the score instead so a refresh
  // reaches new posts while a thin pool still fills the page.
  const servedSet = new Set(served);
  const recentPeerIds = new Set(
    buildBatch && !cursor && mode !== "latest"
      ? await readServedIds(
          userId,
          `${exploring ? "home" : "explore"}:${contentKind}:${mode}`,
          pageSize
        )
      : []
  );
  const servedPenalty = (score: number, id: string) =>
    servedSet.has(id) ? score * 0.35 : score;
  if (buildBatch) {
    const focusedSeeds = context.selected.interests.length
      ? networkInterestTerms(context.selected.interests, context.topicScope)
      : [
          ...new Set([
            ...context.selected.interests,
            ...Object.keys(context.profile.tagWeights),
            ...Object.keys(context.profile.expandedEntityWeights ?? {}),
          ]),
        ].slice(0, 40);
    let seeds = exploring ? neighboringTopics : focusedSeeds;
    if (!focused) {
      seeds = [];
    }
    if (level === 1) {
      seeds = [
        ...new Set(
          context.selected.interests.flatMap(
            (interest) => context.topicScope?.related?.[interest] ?? []
          )
        ),
      ].slice(0, 80);
    } else if (level === 2) {
      seeds = [];
    }
    const { rawQuery } = await import("@asm/db");
    const [relevant, exploration, guestCurated] = await Promise.all([
      level === 1 && seeds.length === 0
        ? Promise.resolve({ rows: [] as { id: string }[] })
        : nativeCandidateIds({
            anchor,
            continuation:
              query.get("refresh") === "1" ||
              Boolean(cursor) ||
              candidateOffset > 0 ||
              level > 0,
            explicit: context.preferences.showExplicitContent,
            gust: contentKind === "gust",
            mode,
            offset: candidateOffset,
            seeds,
            served,
            signal: request.signal,
          }),
      (!exploring && context.selected.interests.length) || !focused || level > 0
        ? Promise.resolve({ rows: [] })
        : rawQuery<{ id: string }>(
            networkSql.pagedCandidates,
            [
              [],
              context.preferences.showExplicitContent,
              mode,
              contentKind === "gust",
              candidateOffset,
              anchor,
              served,
            ],
            { id: "pg/text@1" }
          ),
      !userId && mode !== "latest" && level === 0 && candidateOffset === 0
        ? rawQuery<{ id: string }>(
            networkSql.candidates,
            [
              [],
              context.preferences.showExplicitContent,
              "trending",
              contentKind === "gust",
            ],
            { id: "pg/text@1" }
          )
        : Promise.resolve({ rows: [] as { id: string }[] }),
    ]);
    moreCandidates =
      relevant.rows.length === 180 || exploration.rows.length === 180;
    ids = [
      ...new Set([
        ...guestCurated.rows.map((row) => row.id),
        ...relevant.rows.map((row) => row.id),
        ...exploration.rows.slice(0, 60).map((row) => row.id),
        ...(level === 0 && candidateOffset === 0
          ? social.native.map((entry) => entry.id)
          : []),
      ]),
    ].filter((id) => !seen.includes(id));
  }
  stopRetrieval();
  const stopHydration = timing.start("hydration");
  const visibility = communityVisibilityWhere(userId);
  const [subscriptions, blocked, hidden] = await Promise.all([
    userId ? getSubscribedCommunityIds(userId) : Promise.resolve([]),
    userId
      ? prisma.orm.public.Blocks.select("blockerId", "blockedId")
          .where((block) =>
            or(block.blockerId.eq(userId), block.blockedId.eq(userId))
          )
          .all()
      : Promise.resolve([]),
    userId ? getNotInterestedPostIds(userId) : Promise.resolve([]),
  ]);
  const blockedIds = blocked.map((block) =>
    block.blockerId === userId ? block.blockedId : block.blockerId
  );
  const rows = ids.length
    ? await getPostDataQuery(prisma.orm, userId)
        .where((post) =>
          and(
            post.id.in(ids),
            post.isGust.eq(contentKind === "gust"),
            ...(contentKind === "gust"
              ? [
                  post.rootPostId.isNull(),
                  post.postMedias.some((media) => media._type.eq("VIDEO")),
                ]
              : []),
            post.moderated.eq(false),
            // A banned author's content is removed everywhere else in the app;
            // a feed that still ranks it is a moderation hole, not a preference.
            post.user.some((author) => author.banned.eq(false)),
            // Ranked discovery excludes self; explicit native browsing and Latest include the reader's posts.
            ...(userId && mode !== "latest" && focused
              ? [post.userId.neq(userId)]
              : []),
            visibility(post),
            // Membership grants access on its own: a reader who joined a PRIVATE
            // community without also subscribing is still a member, and the
            // visibility filter above already proves they may read it.
            or(
              post.communityId.isNull(),
              post.communityId.in(subscriptions),
              post.community.some((community) =>
                community.communityMembers.some((member) =>
                  and(member.status.eq("ACTIVE"), member.userId.eq(userId))
                )
              )
            ),
            ...(context.preferences.showExplicitContent
              ? []
              : [post.explicitContent.eq(false)]),
            ...(blockedIds.length ? [post.userId.notIn(blockedIds)] : []),
            ...(hidden.length ? [post.id.notIn(hidden)] : [])
          )
        )
        .all()
    : [];
  stopHydration();
  const stopFiltering = timing.start("filtering");
  let posts = rows
    .map(mapPostData)
    .filter((post) =>
      mode === "trending"
        ? isTrendingPost(post)
        : // Cold start means no persona to personalise with, not "only the hot
          // list": a stored positive aura is enough proof of quality there.
          !focused ||
          !coldStart ||
          isGuestQualityPost(post) ||
          socialById.has(post.id)
    )
    .filter(
      (post) =>
        networkLanguageMatches(
          post.content,
          [],
          context.preferences.contentLanguages ?? [context.preferences.language]
        ) &&
        networkPostAllowed(post, context.preferences, context.topicScope) &&
        // Chosen interests stay an eligibility gate on Explore too: a broadened
        // seed set decides what to retrieve, never whether a post the reader
        // explicitly excluded may appear. Explore differs from Home through its
        // surface-scoped served history, not by dropping this gate.
        (!focused ||
          !context.selected.interests.length ||
          postNetworkInterestScore(
            post,
            context.selected.interests,
            context.topicScope
          ) > 0)
    );
  stopFiltering();
  if (buildBatch) {
    const stopInference = timing.start("inference");
    const inferredTopics = new Map(
      posts.map((post) => [post.id, topicsOf(post)])
    );
    stopInference();
    const stopRanking = timing.start("ranking");
    const followedAuthorIds = new Set(social.followedIds);
    const enriched = posts.map((post) => {
      const topics = inferredTopics.get(post.id) ?? [];
      let fit: number;
      if (exploring) {
        fit = postNetworkInterestScore(post, neighboringTopics);
      } else if (context.selected.interests.length) {
        fit = postNetworkInterestScore(
          post,
          context.selected.interests,
          context.topicScope
        );
      } else {
        fit = networkTopicAffinity(post.content, topics, context.profile);
      }
      const candidate = {
        aura: post.aura,
        authorId: post.userId,
        bookmarkCount: post._count.bookmarks,
        commentCount: post._count.comments,
        createdAt: post.createdAt,
        embedding: post.embedding ? [...post.embedding] : undefined,
        embeddingModel: post.embeddingModel,
        hasImage: post.attachments.some((media) => media.type === "IMAGE"),
        hasVideo: post.attachments.some((media) => media.type === "VIDEO"),
        id: post.id,
        semanticTags: topics,
        tags: topics,
      };
      const region =
        context.preferences.region === "auto"
          ? (query.get("locale")?.split("-")[1] ?? "")
          : context.preferences.region;
      const geographicAffinity = networkRegionalAffinity(
        post.content,
        topics,
        region,
        context.preferences.contentLanguages?.[0] ??
          (context.preferences.language === "all" ||
          context.preferences.language === "auto"
            ? "en"
            : context.preferences.language)
      );
      const nativeScore = scoreCandidate(candidate, context.profile, {
        authorVisibilityWeight: computeVisibilityWeight(post.user.aura),
        followedAuthorIds,
        geographicAffinity,
        socialProofAffinity: socialById.get(post.id)?.weight,
      });
      const trend = Math.log1p(Math.max(0, post.trendingScore));
      let mediaBoost = 0;
      if (candidate.hasVideo) {
        mediaBoost = 4;
      } else if (candidate.hasImage) {
        mediaBoost = 2;
      }
      const auraBoost =
        post.aura > 0 ? Math.min(6, Math.log10(post.aura + 1) * 2) : 0;
      const guestQualityBoost = userId
        ? 0
        : trend * 6 + Math.log1p(post.viewCount) * 1.5 + mediaBoost + auraBoost;
      return {
        authorId: post.userId,
        fit,
        id: post.id,
        mediaKeys: post.attachments.map((media) => media.id),
        post,
        score: servedPenalty(
          mode === "trending"
            ? Math.min(3, fit) +
                trend * 8 +
                geographicAffinity * 0.4 +
                (socialById.get(post.id)?.weight ?? 0) * 2
            : nativeScore * (exploring ? 0.35 : 1) +
                fit * 20 +
                guestQualityBoost,
          post.id
        ),
        semanticTags: topics,
      };
    });
    const eligiblePool = enriched;
    eligiblePool.sort((a, b) =>
      mode === "latest"
        ? b.post.createdAt.getTime() - a.post.createdAt.getTime() ||
          b.post.id.localeCompare(a.post.id)
        : b.score - a.score ||
          b.post.createdAt.getTime() - a.post.createdAt.getTime() ||
          b.post.id.localeCompare(a.post.id)
    );
    const eligible = uniqueFeedContent(
      eligiblePool,
      (item) => item.post.content,
      (item) => item.post.parentPostId ?? ""
    );
    // Rank the whole pool once. Ranking a page at a time reset the author and
    // topic caps on every call, so a dominant author could hold their full share
    // of slot 1..20, then again of 21..40, indefinitely.
    ids =
      mode === "latest"
        ? eligible.map((item) => item.post.id)
        : rankFeed(
            eligible.map((item) => ({ post: item, score: item.score })),
            {
              // Guests keep the stricter mix: no follow graph exists to explain
              // a repeated author, so an unfamiliar reader sees more variety.
              maxConsecutivePerAuthor: userId ? 2 : 1,
              maxSingleAuthorShare: userId ? 0.3 : 0.15,
              maxSingleTopicShare: userId ? 0.6 : 0.35,
              pageSize: eligible.length,
            }
          ).map((item) => item.id);
    if (exploring) {
      const related = new Set(
        enriched.filter((item) => item.fit > 0).map((item) => item.id)
      );
      ids = diversifyExploreCandidates(ids, (id) => related.has(id));
    }
    // Preserve ranking within each group while avoiding the other surface's latest page.
    if (recentPeerIds.size) {
      ids = [
        ...ids.filter((id) => !recentPeerIds.has(id)),
        ...ids.filter((id) => recentPeerIds.has(id)),
      ];
    }
    ids = ids.slice(0, 400);
    stopRanking();
    canContinue = await redis
      .set(
        `rec:network-feed:v1:${generation}`,
        JSON.stringify({
          anchor,
          candidateOffset,
          ids,
          level,
          moreCandidates,
          scope,
          seen,
        }),
        "EX",
        NETWORK_FEED_TTL_SECONDS
      )
      .then(() => true)
      .catch(() => false);
  }
  const byId = new Map(posts.map((post) => [post.id, post]));
  const ordered: PostData[] = [];
  let consumed = offset;
  while (consumed < ids.length && ordered.length < pageSize) {
    const id = ids[consumed];
    consumed += 1;
    const post = id ? byId.get(id) : undefined;
    if (post) {
      ordered.push(post);
    }
  }
  posts = await timing.measure("hydration", () => hydrateViewCounts(ordered));
  const stopFeatures = timing.start("features");
  const observed = await Promise.all(
    posts.map(async (post) => ({
      ...feedPostView(post),
      ...(level > 0
        ? { discoveryContext: { interests: context.selected.interests, level } }
        : {}),
      recommendationSources: socialById.get(post.id)?.sources,
      ...(userId
        ? {
            networkRecommendationToken: await signNetworkObservation(userId, {
              authorId: post.userId,
              hasImage: post.attachments.some(
                (media) => media.type === "IMAGE"
              ),
              hasVideo: post.attachments.some(
                (media) => media.type === "VIDEO"
              ),
              postId: post.id,
              profileId: context.selected.id,
              publicContent: post.communityId === null && !post.explicitContent,
              revision: context.revision,
              source: "asm",
              topics: topicsOf(post),
            }),
          }
        : {}),
    }))
  );
  stopFeatures();
  // Remember this page so the next head starts past it instead of replaying it.
  await recordServedIds(
    userId,
    servedFeed,
    observed.map((post) => post.id)
  );
  const stopSerialization = timing.start("serialization");
  const response = Response.json(
    {
      nextCursor:
        canContinue &&
        (consumed < ids.length ||
          moreCandidates ||
          (mode !== "latest" && level < maximumLevel))
          ? `nf1.${generation}.${consumed}`
          : null,
      posts: observed,
    },
    { headers: { "cache-control": "private, no-store", vary: "Cookie" } }
  );
  stopSerialization();
  return response;
}
