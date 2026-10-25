import type { RecommendationSource } from "@asm/protocols/contracts";
import { readPublicSocialGraph } from "@asm/protocols/discovery";
import { and, or } from "@prisma/orm-postgres/orm-client";

import { fromPrismaDateTime } from "../../dates";
import prisma from "../../prisma";
import { redis } from "../../redis";

export interface NetworkSocialCandidate {
  id: string;
  sources: RecommendationSource[];
  weight: number;
}

// A public amplification follows the existing directed follow edge. Bookmarks and private activity never enter this pool.
export async function networkSocialCandidates(viewerId: string) {
  const empty = {
    external: [] as NetworkSocialCandidate[],
    externalConnections: [] as { id: string; via: string[] }[],
    followedIds: [] as string[],
    native: [] as NetworkSocialCandidate[],
  };
  if (!viewerId) {
    return empty;
  }
  const [follows, blocks, remoteFollows] = await Promise.all([
    prisma.orm.public.Follows.select("followingId")
      .where({ followerId: viewerId })
      .all(),
    prisma.orm.public.Blocks.select("blockerId", "blockedId")
      .where((block) =>
        or(block.blockerId.eq(viewerId), block.blockedId.eq(viewerId))
      )
      .all(),
    prisma.orm.public.ExternalFollows.where({ userId: viewerId })
      .include("author")
      .limit(80)
      .all(),
  ]);
  const blocked = new Set(
    blocks.map((block) =>
      block.blockerId === viewerId ? block.blockedId : block.blockerId
    )
  );
  const followedIds = follows
    .map((follow) => follow.followingId)
    .filter((id) => !blocked.has(id) && id !== viewerId);
  if (!followedIds.length && !remoteFollows.length) {
    return empty;
  }
  const [people, votes, external, remoteActivity] = await Promise.all([
    prisma.orm.public.Users.select("id", "username", "displayName", "avatarUrl")
      .where((person) =>
        and(person.id.in(followedIds), person.banned.eq(false))
      )
      .all(),
    prisma.orm.public.Votes.select("postId", "userId", "createdAt")
      .where((vote) => and(vote.userId.in(followedIds), vote.value.eq(1)))
      .orderBy((vote) => vote.createdAt.desc())
      .limit(200)
      .all(),
    prisma.orm.public.ExternalEngagements.select("userId", "updatedAt")
      .where((entry) =>
        and(entry.userId.in(followedIds), entry.amplified.eq(true))
      )
      .include("externalPost", (post) => post.select("uri", "available"))
      .orderBy((entry) => entry.updatedAt.desc())
      .limit(100)
      .all(),
    readPublicSocialGraph(
      redis,
      remoteFollows
        .filter((row) => row.author.status === "active")
        .map((row) => row.authorDid)
    ).catch(() => []),
  ]);
  const byId = new Map(people.map((person) => [person.id, person]));
  function collect(
    rows: { id: string; userId: string; at: Date }[]
  ): NetworkSocialCandidate[] {
    const candidates = new Map<
      string,
      { sources: Map<string, RecommendationSource>; weight: number }
    >();
    for (const row of rows) {
      const person = byId.get(row.userId);
      const ageDays = Math.max(0, (Date.now() - row.at.getTime()) / 86_400_000);
      if (!person || ageDays > 30) {
        continue;
      }
      const candidate = candidates.get(row.id) ?? {
        sources: new Map(),
        weight: 0,
      };
      if (!candidate.sources.has(person.id)) {
        candidate.weight += 0.5 ** (ageDays / 7);
        candidate.sources.set(person.id, person);
      }
      candidates.set(row.id, candidate);
    }
    return [...candidates].map(([id, candidate]) => ({
      id,
      sources: [...candidate.sources.values()].slice(0, 5),
      weight: Math.min(1, candidate.weight / 3),
    }));
  }
  const connections = new Map<string, Set<string>>();
  for (const activity of remoteActivity) {
    if (activity.action !== "follow") {
      continue;
    }
    const via = connections.get(activity.target) ?? new Set<string>();
    via.add(activity.actor);
    connections.set(activity.target, via);
  }
  const remotePeople = new Map(
    remoteFollows.map((row) => [row.authorDid, row.author])
  );
  const remoteCandidates = new Map<string, NetworkSocialCandidate>();
  for (const activity of remoteActivity) {
    if (activity.action === "follow") {
      continue;
    }
    const author = remotePeople.get(activity.actor);
    if (!author) {
      continue;
    }
    const candidate = remoteCandidates.get(activity.target) ?? {
      id: activity.target,
      sources: [],
      weight: 0,
    };
    if (!candidate.sources.some((source) => source.id === activity.actor)) {
      candidate.sources.push({
        action: activity.action,
        avatarUrl: null,
        displayName: author.displayName,
        id: author.did,
        username: author.handle,
      });
      candidate.weight = Math.min(
        1,
        candidate.weight +
          (activity.action === "repost" ? 0.5 : 0.25) *
            0.5 ** ((Date.now() - activity.at) / (3 * 86_400_000))
      );
    }
    remoteCandidates.set(activity.target, candidate);
  }
  const externalCandidates = collect(
    external.flatMap((entry) =>
      entry.externalPost?.available
        ? [
            {
              at: fromPrismaDateTime(entry.updatedAt),
              id: entry.externalPost.uri,
              userId: entry.userId,
            },
          ]
        : []
    )
  );
  for (const candidate of remoteCandidates.values()) {
    const existing = externalCandidates.find(
      (entry) => entry.id === candidate.id
    );
    if (existing) {
      existing.weight = Math.min(1, existing.weight + candidate.weight);
      existing.sources = [...existing.sources, ...candidate.sources].slice(
        0,
        5
      );
    } else {
      externalCandidates.push({
        ...candidate,
        sources: candidate.sources.slice(0, 5),
      });
    }
  }
  return {
    external: externalCandidates
      .toSorted((a, b) => b.weight - a.weight)
      .slice(0, 25),
    externalConnections: [...connections]
      .map(([id, via]) => ({ id, via: [...via] }))
      .slice(0, 30),
    followedIds: [...byId.keys()],
    native: collect(
      votes.map((vote) => ({
        at: fromPrismaDateTime(vote.createdAt),
        id: vote.postId,
        userId: vote.userId,
      }))
    ),
  };
}
