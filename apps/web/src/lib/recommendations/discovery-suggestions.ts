import { createHash } from "node:crypto";

import {
  and,
  or,
  prisma,
  redis,
  networkSql,
  rawQuery,
  networkSocialCandidates,
  externalFollowAuthors,
  fromPrismaDateTime,
  getNotInterestedPostIds,
  networkLanguageMatches,
  SYSTEM_MODERATION_USER_ID,
} from "@asm/db";
import type { ExternalAuthor } from "@asm/protocols/contracts";
import { externalPostTopics } from "@asm/protocols/contracts";
import {
  abortable,
  BoundedReadQueue,
  SharedReadCache,
  createRedisReadStore,
  matchesAvoidedTopic,
  scopedNetworkPreferences,
  networkInterestScore,
} from "@asm/protocols/discovery";

import { externalNetworkPostAllowed } from "@/lib/posts/network-content-policy";
import {
  isExplicitTagOrTopic,
  postHasExplicitMedia,
} from "@/lib/protocols/content-labels";
import { blueskyProfilePath } from "@/lib/protocols/paths";
import { discoveryTopics } from "@/lib/protocols/recommendations";
import {
  readBlueskyDiscovery,
  readBlueskyPosts,
  readBlueskyProfileResource,
} from "@/lib/protocols/service";
import { getPostPath } from "@/lib/seo/seo";

import { networkFeedContext } from "./network-context";
import { readSuggestionPublicSearch } from "./suggestion-public-search";
import { suggestionAffinity } from "./suggestion-ranking";
import { suggestionReason } from "./suggestion-reason";
import {
  discoverySuggestionsSchema,
  mixSuggestionSources,
} from "./suggestion-types";
import type {
  DiscoverySuggestions,
  RecommendedAccount,
  RecommendedPost,
} from "./suggestion-types";

const queue = new BoundedReadQueue({
  concurrency: 8,
  maxQueued: 48,
  maxWaitMs: 6500,
});
const cache = new SharedReadCache({
  deadlineMs: 9000,
  parse: (value) => discoverySuggestionsSchema.parse(value),
  queue,
  store: createRedisReadStore(redis),
  ttlMs: 30_000,
});

// A shared account-scoped snapshot serves both placements; provider reads never run once per card.
export async function readDiscoverySuggestions(
  viewerId: string,
  signal: AbortSignal,
  profileId?: string
): Promise<DiscoverySuggestions> {
  const version = viewerId
    ? await abortable(
        redis.get(`rec:suggestions:version:${viewerId}`),
        AbortSignal.timeout(250)
      ).catch(() => null)
    : "guest";
  const key = `rec:suggestions:v5:{${createHash("sha256")
    .update(`${viewerId}:${profileId ?? "active"}:${version ?? "0"}`)
    .digest("hex")}}`;
  return cache.read(
    key,
    () =>
      buildDiscoverySuggestions(viewerId, AbortSignal.timeout(6500), profileId),
    signal
  );
}

export async function buildDiscoverySuggestions(
  viewerId: string,
  signal: AbortSignal,
  profileId?: string
): Promise<DiscoverySuggestions> {
  const context = await networkFeedContext(viewerId || undefined, profileId);
  const policy = scopedNetworkPreferences(
    context.preferences,
    context.topicScope
  );
  const terms = [
    ...new Set([
      ...discoveryTopics(
        context.profile,
        context.selected.interests,
        context.topicScope
      ),
      ...discoveryTopics(context.profile),
    ]),
  ]
    .filter((term) => !matchesAvoidedTopic(term, [], policy.avoidedTopics))
    .slice(0, 8);
  const hasPersonalization =
    context.selected.interests.length > 0 ||
    Object.values(context.profile.tagWeights).some(
      (weight) => weight >= 0.15
    ) ||
    Object.values(context.profile.authorWeights).some((weight) => weight > 0.1);
  const reasonFor = (text: string, topics: string[], author: string) =>
    suggestionReason(
      context.profile,
      context.selected.interests,
      text,
      topics,
      author,
      context.topicScope
    );
  const affinityFor = (text: string, topics: string[], author: string) =>
    suggestionAffinity(context.profile, text, topics, author) +
    Math.min(
      1,
      networkInterestScore(
        text,
        topics,
        context.selected.interests,
        context.topicScope
      )
    ) *
      2;
  const social = await networkSocialCandidates(viewerId);
  const follows = social.followedIds.slice(0, 100);
  const [
    blockedRows,
    nativeEdges,
    externalEdges,
    externalFollowing,
    relevant,
    hiddenPosts,
  ] = await Promise.all([
    viewerId
      ? prisma.orm.public.Blocks.select("blockerId", "blockedId")
          .where((block) =>
            or(block.blockerId.eq(viewerId), block.blockedId.eq(viewerId))
          )
          .all()
      : [],
    follows.length
      ? prisma.orm.public.Follows.select("followerId", "followingId")
          .where((edge) => edge.followerId.in(follows))
          .limit(400)
          .all()
      : [],
    follows.length
      ? prisma.orm.public.ExternalFollows.select("userId", "authorDid")
          .where((edge) => edge.userId.in(follows))
          .include("author")
          .limit(300)
          .all()
      : [],
    viewerId ? externalFollowAuthors(viewerId) : [],
    rawQuery<{ id: string }>(
      networkSql.candidates,
      [terms, policy.showExplicitContent, "personalized", false],
      { id: "pg/text@1" }
    ),
    getNotInterestedPostIds(viewerId),
  ]);
  const blocked = new Set(
    blockedRows.map((row) =>
      row.blockerId === viewerId ? row.blockedId : row.blockerId
    )
  );
  const dismissed = new Set(
    await redis
      .zrange(
        `rec:suggestions:dismissed:${viewerId}:${context.selected.id}`,
        "0",
        "-1"
      )
      .catch(() => [])
  );
  const followed = new Set(social.followedIds);
  const followedExternal = new Set(externalFollowing.map((entry) => entry.did));
  const nativeMutual = new Map<string, Set<string>>();
  for (const edge of nativeEdges) {
    const sources = nativeMutual.get(edge.followingId) ?? new Set<string>();
    sources.add(edge.followerId);
    nativeMutual.set(edge.followingId, sources);
  }
  const externalMutual = new Map<string, Set<string>>();
  for (const edge of externalEdges) {
    if (edge.author.status !== "active") {
      continue;
    }
    const sources = externalMutual.get(edge.authorDid) ?? new Set<string>();
    sources.add(edge.userId);
    externalMutual.set(edge.authorDid, sources);
  }
  const seedIds = [
    ...new Set([
      ...social.native.map((entry) => entry.id),
      ...relevant.rows.map((row) => row.id),
    ]),
  ].slice(0, 200);
  const nativePosts = await prisma.orm.public.Posts.select(
    "id",
    "content",
    "semanticTags",
    "userId",
    "createdAt",
    "aura",
    "explicitContent",
    "isGust"
  )
    .where((post) =>
      and(
        post.moderated.eq(false),
        post.communityId.isNull(),
        policy.showExplicitContent
          ? post.id.neq("")
          : post.explicitContent.eq(false),
        ...(seedIds.length ? [post.id.in(seedIds)] : [])
      )
    )
    .orderBy((post) => post.createdAt.desc())
    .limit(80)
    .all();
  const authorIds = [
    ...new Set([
      ...nativeMutual.keys(),
      ...nativePosts.map((post) => post.userId),
      ...Object.keys(context.profile.authorWeights)
        .filter((id) => id.startsWith("asm:"))
        .map((id) => id.slice(4)),
    ]),
  ]
    .filter((id) => !blocked.has(id))
    .slice(0, 120);
  const people = await prisma.orm.public.Users.select(
    "id",
    "username",
    "displayName",
    "avatarUrl",
    "bannerUrl",
    "bio",
    "aura"
  )
    .where((person) =>
      and(
        person.banned.eq(false),
        person.id.neq(SYSTEM_MODERATION_USER_ID),
        ...(blocked.size ? [person.id.notIn([...blocked])] : []),
        ...(authorIds.length ? [person.id.in(authorIds)] : [])
      )
    )
    .orderBy((person) => person.aura.desc())
    .limit(100)
    .all();
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const nativeSocial = new Map(
    social.native.map((entry) => [entry.id, entry.weight])
  );
  const posts: (RecommendedPost & { score: number })[] = [];
  const accountEvidence = new Map<
    string,
    { score: number; topics: string[]; reason: string | null }
  >();
  for (const post of nativePosts) {
    const author = peopleById.get(post.userId);
    const topics = [...(post.semanticTags ?? [])];
    if (
      hiddenPosts.includes(post.id) ||
      !networkLanguageMatches(post.content, [], policy.language) ||
      !author ||
      matchesAvoidedTopic(post.content, topics, policy.avoidedTopics) ||
      (!policy.showExplicitContent &&
        postHasExplicitMedia({
          content: post.content,
          explicitContent: post.explicitContent,
          semanticTags: post.semanticTags,
        }))
    ) {
      continue;
    }
    const affinity = affinityFor(post.content, topics, `asm:${author.id}`);
    const age = Math.max(
      0,
      (Date.now() - fromPrismaDateTime(post.createdAt).getTime()) / 86_400_000
    );
    const score =
      affinity * 5 +
      (nativeSocial.get(post.id) ?? 0) * 3 +
      (followed.has(author.id) ? 1 : 0) +
      1 / (1 + age);
    if (
      affinity < -1 ||
      (hasPersonalization &&
        affinity <= 0.05 &&
        !nativeSocial.has(post.id) &&
        !followed.has(author.id))
    ) {
      continue;
    }
    const evidence = accountEvidence.get(author.id);
    if (!evidence || score > evidence.score) {
      accountEvidence.set(author.id, {
        reason: reasonFor(post.content, topics, `asm:${author.id}`),
        score,
        topics,
      });
    }
    posts.push({
      authorId: author.id,
      avatarUrl: author.avatarUrl,
      displayName: post.content.slice(0, 280) || "Media post",
      href: getPostPath({ ...post, community: null }),
      id: post.id,
      reason: nativeSocial.has(post.id)
        ? "Amplified by people you follow"
        : (reasonFor(post.content, topics, `asm:${author.id}`) ??
          "From accounts you follow"),
      score,
      source: "asm",
      subtitle: `@${author.username}`,
    });
  }
  const accounts: (RecommendedAccount & { score: number })[] = [];
  for (const person of people) {
    if (
      dismissed.has(`asm:${person.id}`) ||
      person.id === viewerId ||
      followed.has(person.id) ||
      matchesAvoidedTopic(
        `${person.displayName} ${person.bio ?? ""}`,
        [],
        policy.avoidedTopics
      ) ||
      (!policy.showExplicitContent &&
        (isExplicitTagOrTopic(person.username) ||
          isExplicitTagOrTopic(person.displayName) ||
          (person.bio && isExplicitTagOrTopic(person.bio))))
    ) {
      continue;
    }
    const evidence = accountEvidence.get(person.id);
    const affinity = affinityFor(
      `${person.displayName} ${person.bio ?? ""}`,
      evidence?.topics ?? [],
      `asm:${person.id}`
    );
    if (affinity < -1) {
      continue;
    }
    const mutual = nativeMutual.get(person.id)?.size ?? 0;
    const reason =
      evidence?.reason ??
      reasonFor(
        `${person.displayName} ${person.bio ?? ""}`,
        evidence?.topics ?? [],
        `asm:${person.id}`
      );
    if (!reason && !mutual) {
      continue;
    }
    accounts.push({
      avatarUrl: person.avatarUrl,
      bannerUrl: person.bannerUrl,
      bio: person.bio,
      displayName: person.displayName || person.username,
      followers: 0,
      following: false,
      handle: person.username,
      href: `/users/${person.username}`,
      id: person.id,
      reason: mutual
        ? `Followed by ${mutual} ${mutual === 1 ? "person" : "people"} you follow`
        : (reason ?? "From your network"),
      score:
        affinity * 5 +
        (evidence?.score ?? 0) +
        Math.log1p(mutual) * 5 +
        Math.min(0.5, Math.log1p(Math.max(0, person.aura)) / 20),
      source: "asm",
    });
  }
  let partial = false;
  const requestId = crypto.randomUUID();
  const [remote, socialRemote] = await Promise.allSettled([
    terms.length
      ? Promise.allSettled(
          terms
            .slice(0, 3)
            .map((term) =>
              readSuggestionPublicSearch(
                term,
                policy.showExplicitContent,
                signal,
                requestId
              )
            )
        )
      : readBlueskyDiscovery(
          "personalized",
          undefined,
          signal,
          requestId,
          undefined,
          [],
          policy.showExplicitContent
        ),
    social.external.length
      ? readBlueskyPosts(
          social.external.slice(0, 12).map((entry) => entry.id),
          signal,
          requestId,
          true
        )
      : Promise.resolve([]),
  ]);
  const profiles: ExternalAuthor[] = [];
  const connections = await Promise.allSettled(
    social.externalConnections.slice(0, 6).map(async (connection) => {
      const author = await readBlueskyProfileResource(
        "profile",
        new URLSearchParams({ actor: connection.id }),
        signal,
        requestId,
        policy.showExplicitContent
      );
      if ("id" in author) {
        externalMutual.set(connection.id, new Set(connection.via));
        return author;
      }
      return null;
    })
  );
  for (const result of connections) {
    if (result.status === "fulfilled" && result.value) {
      profiles.push(result.value);
    }
  }
  const externalPosts =
    socialRemote.status === "fulfilled" ? socialRemote.value : [];
  if (socialRemote.status === "rejected") {
    partial = true;
  }
  if (remote.status === "fulfilled") {
    if (Array.isArray(remote.value)) {
      for (const result of remote.value) {
        if (result.status === "rejected") {
          partial = true;
          continue;
        }
        profiles.push(...result.value.profiles);
        externalPosts.push(...result.value.posts);
        partial ||= result.value.unavailable.length > 0;
      }
    } else {
      externalPosts.push(...remote.value.items);
    }
  } else {
    partial = true;
  }
  const externalSocial = new Map(
    social.external.map((entry) => [entry.id, entry.weight])
  );
  for (const post of externalPosts) {
    if (
      !externalNetworkPostAllowed(post, policy) ||
      !networkLanguageMatches(post.text, post.languages, policy.language) ||
      !post.author.id.startsWith("did:")
    ) {
      continue;
    }
    const topics = externalPostTopics(post);
    const affinity = affinityFor(
      post.text,
      topics,
      `bluesky:${post.author.id}`
    );
    if (affinity < -1) {
      continue;
    }
    if (
      hasPersonalization &&
      affinity <= 0.05 &&
      !externalSocial.has(post.id) &&
      !followedExternal.has(post.author.id)
    ) {
      continue;
    }
    profiles.push(post.author);
    const evidenceKey = `bluesky:${post.author.id}`;
    const score =
      affinity * 5 +
      (externalSocial.get(post.id) ?? 0) * 3 +
      (followedExternal.has(post.author.id) ? 1 : 0);
    const existing = accountEvidence.get(evidenceKey);
    if (!existing || score > existing.score) {
      accountEvidence.set(evidenceKey, {
        reason: reasonFor(post.text, topics, evidenceKey),
        score,
        topics,
      });
    }
    posts.push({
      authorId: post.author.id,
      avatarUrl: post.author.avatarUrl ?? null,
      displayName: post.text.slice(0, 280) || "Media post",
      href: `/network/bluesky?uri=${encodeURIComponent(post.id)}`,
      id: post.id,
      reason: externalSocial.has(post.id)
        ? "Amplified by people you follow"
        : (reasonFor(post.text, topics, `bluesky:${post.author.id}`) ??
          "From accounts you follow"),
      score,
      source: "bluesky",
      subtitle: `@${post.author.handle}`,
    });
  }
  for (const edge of externalEdges) {
    if (edge.author.status === "active") {
      profiles.push({
        displayName: edge.author.displayName,
        handle: edge.author.handle,
        id: edge.authorDid,
        labels: [],
        source: "bluesky",
        upstreamCounts: {},
        url: "",
      });
    }
  }
  for (const author of profiles) {
    if (
      dismissed.has(`bluesky:${author.id}`) ||
      followedExternal.has(author.id) ||
      matchesAvoidedTopic(
        `${author.displayName} ${author.description ?? ""}`,
        author.labels,
        policy.avoidedTopics
      ) ||
      (!policy.showExplicitContent &&
        (author.labels.some((l) => isExplicitTagOrTopic(l)) ||
          isExplicitTagOrTopic(author.handle) ||
          isExplicitTagOrTopic(author.displayName) ||
          (author.description && isExplicitTagOrTopic(author.description))))
    ) {
      continue;
    }
    const evidence = accountEvidence.get(`bluesky:${author.id}`);
    const affinity = affinityFor(
      `${author.displayName} ${author.description ?? ""}`,
      evidence?.topics ?? [],
      `bluesky:${author.id}`
    );
    if (affinity < -1) {
      continue;
    }
    const mutual = externalMutual.get(author.id)?.size ?? 0;
    const reason =
      evidence?.reason ??
      reasonFor(
        `${author.displayName} ${author.description ?? ""}`,
        evidence?.topics ?? [],
        `bluesky:${author.id}`
      );
    if (!reason && !mutual) {
      continue;
    }
    accounts.push({
      avatarUrl: author.avatarUrl ?? null,
      bannerUrl: author.bannerUrl ?? null,
      bio: author.description ?? null,
      displayName: author.displayName || author.handle,
      followers: author.upstreamCounts.followers ?? 0,
      following: false,
      handle: author.handle,
      href: blueskyProfilePath(author.id),
      id: author.id,
      reason: mutual
        ? `Followed by ${mutual} ${mutual === 1 ? "person" : "people"} you follow`
        : (reason ?? "From your network"),
      score: affinity * 5 + (evidence?.score ?? 0) + Math.log1p(mutual) * 5,
      source: "bluesky",
    });
  }
  return {
    accounts: mixSuggestionSources(accounts, 12).map(
      ({ score: _score, ...account }) => account
    ),
    partial,
    posts: mixSuggestionSources(posts, 12).map(
      ({ score: _score, ...post }) => post
    ),
    profileId: context.selected.id,
  };
}
