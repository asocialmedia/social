import {
  and,
  externalPostId,
  externalPostStates,
  filterExternalMediaSafety,
  fromPrismaDateTime,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
  redis,
  refreshExternalPost,
  upsertExternalPostSnapshot,
  readNetworkPreferences,
} from "@asm/db";
import type { PostData } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import { abortable, externalPostSchema } from "@asm/protocols/discovery";
import { after } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";
import { networkPostAllowed } from "@/lib/posts/network-content-policy";
import { externalPostView } from "@/lib/posts/presentation";
import type { PresentedPost } from "@/lib/posts/presentation";
import { readBlueskyPosts } from "@/lib/protocols/service";

interface ParsedVisit {
  id: string;
  raw: string;
  type: "asm" | "bsky";
}

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const redisKey = `user:post-visits:${userId}`;
  const [{ preferences }, savedMembers] = await Promise.all([
    readNetworkPreferences(userId),
    abortable(redis.zrevrange(redisKey, 0, 49), AbortSignal.timeout(250)).catch(
      () => []
    ),
  ]);
  let rawMembers = savedMembers;

  // Fallback to PostgreSQL tables if Redis has no records for this user (e.g. after restart/flush)
  if (rawMembers.length === 0) {
    const [asmVisits, bskyVisits] = await Promise.all([
      (async () => {
        try {
          return await prisma.orm.public.PostVisits.select(
            "postId",
            "visitedAt"
          )
            .where({ userId })
            .orderBy((visit) => visit.visitedAt.desc())
            .limit(12)
            .all();
        } catch {
          return [];
        }
      })(),
      (async () => {
        try {
          return await prisma.orm.public.ExternalEngagements.where({ userId })
            .select("externalPostId", "updatedAt")
            .include("externalPost", (p) => p.select("uri", "available"))
            .orderBy((e) => e.updatedAt.desc())
            .limit(12)
            .all();
        } catch {
          return [];
        }
      })(),
    ]);

    interface TimedVisit {
      member: string;
      time: number;
    }
    const combined: TimedVisit[] = [];

    for (const v of asmVisits) {
      combined.push({
        member: `asm:${v.postId}`,
        time: v.visitedAt
          ? fromPrismaDateTime(v.visitedAt).getTime()
          : Date.now(),
      });
    }

    for (const v of bskyVisits) {
      if (v.externalPost?.uri && v.externalPost.available !== false) {
        combined.push({
          member: `bsky:${v.externalPost.uri}`,
          time: v.updatedAt
            ? fromPrismaDateTime(v.updatedAt).getTime()
            : Date.now(),
        });
      }
    }

    combined.sort((a, b) => b.time - a.time);

    if (combined.length === 0) {
      return Response.json({ posts: [] });
    }

    rawMembers = combined.slice(0, 20).map((c) => c.member);

    // Backfill Redis so subsequent calls are fast and unified
    if (typeof redis.pipeline === "function") {
      after(async () => {
        try {
          const pipeline = redis.pipeline();
          for (const item of combined.slice(0, 50)) {
            pipeline.zadd(redisKey, "NX", item.time, item.member);
          }
          await pipeline.exec();
        } catch (error) {
          console.error("Error backfilling Redis post visits:", error);
        }
      });
    }
  }

  const parsedVisits: ParsedVisit[] = [];
  for (const member of rawMembers) {
    if (member.startsWith("bsky:")) {
      parsedVisits.push({
        id: member.slice("bsky:".length),
        raw: member,
        type: "bsky",
      });
    } else if (member.startsWith("asm:")) {
      parsedVisits.push({
        id: member.slice("asm:".length),
        raw: member,
        type: "asm",
      });
    } else if (member.startsWith("at://")) {
      parsedVisits.push({
        id: member,
        raw: member,
        type: "bsky",
      });
    } else {
      parsedVisits.push({
        id: member,
        raw: member,
        type: "asm",
      });
    }
  }

  const asmIds = [
    ...new Set(parsedVisits.filter((v) => v.type === "asm").map((v) => v.id)),
  ];
  const bskyUris = [
    ...new Set(parsedVisits.filter((v) => v.type === "bsky").map((v) => v.id)),
  ].slice(0, 25);
  const bluesky = bskyUris.length
    ? (async () => {
        const signal = AbortSignal.timeout(1400);
        try {
          return await abortable(
            readBlueskyPosts(
              bskyUris,
              signal,
              undefined,
              false,
              true,
              preferences.showExplicitContent
            ),
            signal
          );
        } catch {
          return null;
        }
      })()
    : null;

  const asmPostMap = new Map<string, PostData>();
  if (asmIds.length > 0) {
    const postRows = await getPostDataQuery(prisma.orm, userId)
      .where((post) => and(post.id.in(asmIds), post.moderated.eq(false)))
      .all();
    const posts = postRows.map(mapPostData);
    for (const post of posts) {
      asmPostMap.set(post.id, post);
    }
  }

  const bskyPostMap = new Map<string, PresentedPost>();
  if (bskyUris.length > 0) {
    const livePosts = await bluesky;

    if (livePosts === null) {
      // Upstream Bluesky API failed: fall back to cached snapshots in Postgres
      const cachedRows = await prisma.orm.public.ExternalPosts.where((row) =>
        row.id.in(bskyUris.map(externalPostId))
      ).all();
      const availableRows = cachedRows.filter(
        (row) => row.available && row.snapshot
      );
      const availableUris = availableRows.map((r) => r.uri);
      if (availableUris.length > 0) {
        const states = await externalPostStates(availableUris, userId);
        const snapshots = availableRows.flatMap((row) => {
          const parsed = externalPostSchema.safeParse(row.snapshot);
          return parsed.success && parsed.data.id === row.uri
            ? [parsed.data]
            : [];
        });
        const safe = preferences.showExplicitContent
          ? snapshots
          : await filterExternalMediaSafety(snapshots).catch(() => []);
        for (const post of safe) {
          bskyPostMap.set(
            post.id,
            externalPostView({ ...post, asm: states.get(post.id) })
          );
        }
      }
    } else {
      const liveMap = new Map<string, ExternalPost>(
        livePosts.map((p) => [p.id, p])
      );
      const deletedUris: string[] = [];
      const validUris: string[] = [];

      for (const uri of bskyUris) {
        if (liveMap.has(uri)) {
          validUris.push(uri);
        } else {
          deletedUris.push(uri);
        }
      }

      if (deletedUris.length > 0) {
        after(async () => {
          await Promise.allSettled(
            deletedUris.map(async (uri) => {
              await refreshExternalPost(uri, null);
              await redis.zrem(redisKey, `bsky:${uri}`, uri);
            })
          );
        });
      }

      if (validUris.length > 0) {
        const states = await externalPostStates(validUris, userId);
        const snapshots: ExternalPost[] = [];
        for (const uri of validUris) {
          const post = liveMap.get(uri);
          if (post) {
            post.asm = states.get(uri);
            snapshots.push(post);
            bskyPostMap.set(uri, externalPostView(post));
          }
        }
        after(async () => {
          await Promise.allSettled(
            snapshots.map((post) => upsertExternalPostSnapshot(post))
          );
        });
      }
    }
  }

  const orderedPosts: (PostData | PresentedPost)[] = [];
  const seenIds = new Set<string>();

  const staleAsmMembers: string[] = [];
  for (const visit of parsedVisits) {
    if (orderedPosts.length >= 12) {
      break;
    }
    if (seenIds.has(visit.id)) {
      continue;
    }

    if (visit.type === "asm") {
      const post = asmPostMap.get(visit.id);
      if (post) {
        seenIds.add(visit.id);
        orderedPosts.push(post);
      } else {
        staleAsmMembers.push(visit.raw, `asm:${visit.id}`, visit.id);
      }
    } else {
      const post = bskyPostMap.get(visit.id);
      if (post) {
        seenIds.add(visit.id);
        orderedPosts.push(post);
      }
    }
  }

  if (staleAsmMembers.length > 0) {
    after(async () => {
      await redis.zrem(redisKey, ...staleAsmMembers).catch(() => 0);
    });
  }

  const hydrated = await hydrateViewCounts(
    orderedPosts.filter((post) => networkPostAllowed(post, preferences))
  );

  return Response.json({ posts: hydrated });
}
