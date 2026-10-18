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
  getNotInterestedPostIds,
  NetworkPreferenceConflictError,
} from "@asm/db";
import type { PostData, UserProfile } from "@asm/db";
import { matchesAvoidedTopic } from "@asm/protocols/discovery";
import { z } from "zod";

import { networkFeedContext } from "./network-context";
import { signNetworkObservation } from "./network-observation";

const snapshotSchema = z.object({
  ids: z.array(z.string()).max(400),
  scope: z.string(),
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

export async function networkNativeFeed(
  request: Request,
  userId: string,
  mode: "personalized" | "trending" | "latest"
) {
  const query = new URL(request.url).searchParams;
  const context = await networkFeedContext(
    userId || undefined,
    query.get("profile") ?? undefined
  ).catch((error: unknown) =>
    error instanceof NetworkPreferenceConflictError
      ? null
      : Promise.reject(error)
  );
  if (!context) {
    return Response.json(
      { error: "Choose an available recommendation profile" },
      { status: 409 }
    );
  }
  const scope = `${userId || "guest"}:${context.selected.id}:${context.revision}:${mode}`;
  const cursor = query.get("cursor");
  const take = query.get("take") ?? "20";
  const pageSize = /^[1-9]\d*$/u.test(take) ? Math.min(20, Number(take)) : 20;
  let ids: string[];
  let generation = crypto.randomUUID();
  let offset = 0;
  let canContinue = true;
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
    ({ ids } = parsed.data);
  } else {
    const seeds = [
      ...new Set([
        ...context.selected.interests,
        ...Object.keys(context.profile.tagWeights),
        ...Object.keys(context.profile.expandedEntityWeights ?? {}),
      ]),
    ].slice(0, 40);
    const { rawQuery } = await import("@asm/db");
    const [relevant, exploration] = await Promise.all([
      rawQuery<{ id: string }>(
        networkSql.candidates,
        [seeds, context.preferences.showExplicitContent, mode],
        { id: "pg/text@1" }
      ),
      rawQuery<{ id: string }>(
        networkSql.candidates,
        [[], context.preferences.showExplicitContent, mode],
        { id: "pg/text@1" }
      ),
    ]);
    ids = [
      ...new Set(
        [...relevant.rows, ...exploration.rows.slice(0, 60)].map(
          (row) => row.id
        )
      ),
    ];
  }
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
            post.isGust.eq(false),
            post.moderated.eq(false),
            visibility(post),
            or(post.communityId.isNull(), post.communityId.in(subscriptions)),
            ...(context.preferences.showExplicitContent
              ? []
              : [post.explicitContent.eq(false)]),
            ...(blockedIds.length ? [post.userId.notIn(blockedIds)] : []),
            ...(hidden.length ? [post.id.notIn(hidden)] : [])
          )
        )
        .all()
    : [];
  let posts = rows
    .map(mapPostData)
    .filter(
      (post) =>
        networkLanguageMatches(
          post.content,
          [],
          context.preferences.language
        ) &&
        !matchesAvoidedTopic(
          post.content,
          topicsOf(post),
          context.preferences.avoidedTopics
        )
    );
  if (!cursor) {
    const enriched = posts.map((post) => {
      const topics = topicsOf(post);
      const fit = networkTopicAffinity(post.content, topics, context.profile);
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
        context.preferences.language === "all" ||
          context.preferences.language === "auto"
          ? "en"
          : context.preferences.language
      );
      const nativeScore = scoreCandidate(candidate, context.profile, {
        geographicAffinity,
      });
      const trend = Math.log1p(Math.max(0, post.trendingScore));
      return {
        fit,
        post,
        score:
          mode === "trending"
            ? trend + Math.min(2, fit) * 2 + geographicAffinity * 0.4
            : nativeScore + fit * 20,
      };
    });
    const hasInterests = Object.keys(context.profile.tagWeights).length > 0;
    const eligible =
      mode === "latest" && hasInterests
        ? enriched.filter((item) => item.fit > 0)
        : enriched;
    eligible.sort((a, b) =>
      mode === "latest"
        ? b.post.createdAt.getTime() - a.post.createdAt.getTime() ||
          b.post.id.localeCompare(a.post.id)
        : b.score - a.score ||
          b.post.createdAt.getTime() - a.post.createdAt.getTime() ||
          b.post.id.localeCompare(a.post.id)
    );
    ids = eligible.map((item) => item.post.id);
    canContinue = await redis
      .set(
        `rec:network-feed:v1:${generation}`,
        JSON.stringify({ ids, scope }),
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
  posts = await hydrateViewCounts(ordered);
  const observed = await Promise.all(
    posts.map(async (post) => ({
      ...post,
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
  return Response.json(
    {
      nextCursor:
        canContinue && consumed < ids.length
          ? `nf1.${generation}.${consumed}`
          : null,
      posts: observed,
    },
    { headers: { "cache-control": "private, no-store", vary: "Cookie" } }
  );
}
