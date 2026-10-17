import {
  and,
  externalPostId,
  externalPostStates,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
  redis,
  refreshExternalPost,
  upsertExternalPostSnapshot,
} from "@asm/db";
import type { PostData } from "@asm/db";
import { BlueskyClient } from "@asm/protocols/bluesky";
import type { ExternalPost } from "@asm/protocols/contracts";
import { externalPostSchema } from "@asm/protocols/discovery";

import { getSessionFromApi } from "@/lib/auth/session";
import { externalPostView } from "@/lib/posts/presentation";
import type { PresentedPost } from "@/lib/posts/presentation";

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

  let rawMembers: string[] = [];
  try {
    rawMembers = await redis.zrevrange(redisKey, 0, 49);
  } catch (error) {
    console.error("Error reading post visits from Redis:", error);
  }

  // Fallback to PostVisits table in Postgres if Redis has no records for this user
  if (rawMembers.length === 0) {
    const visits = await prisma.orm.public.PostVisits.select("postId")
      .where({ userId })
      .orderBy((visit) => visit.visitedAt.desc())
      .limit(12)
      .all();

    if (visits.length === 0) {
      return Response.json({ posts: [] });
    }

    rawMembers = visits.map((v) => `asm:${v.postId}`);

    // Backfill Redis so subsequent calls are fast and unified
    if (typeof redis.pipeline === "function") {
      try {
        const pipeline = redis.pipeline();
      const now = Date.now();
      for (let i = 0; i < visits.length; i += 1) {
        pipeline.zadd(redisKey, now - i * 1000, `asm:${visits[i].postId}`);
      }
      await pipeline.exec();
      } catch (error) {
        console.error("Error backfilling Redis post visits:", error);
      }
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
    let livePosts: ExternalPost[] = [];
    let fetchFailed = false;
    try {
      const client = new BlueskyClient();
      livePosts = await client.getPosts(bskyUris);
    } catch (error) {
      fetchFailed = true;
      console.error("Error fetching Bluesky posts for history:", error);
    }

    if (fetchFailed) {
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
        for (const row of availableRows) {
          const parsed = externalPostSchema.safeParse(row.snapshot);
          if (parsed.success) {
            const post = parsed.data;
            post.asm = states.get(row.uri);
            bskyPostMap.set(row.uri, externalPostView(post));
          }
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
        await Promise.allSettled(
          deletedUris.map(async (uri) => {
            await refreshExternalPost(uri, null);
            await redis.zrem(redisKey, `bsky:${uri}`, uri);
          })
        );
      }

      if (validUris.length > 0) {
        const states = await externalPostStates(validUris, userId);
        await Promise.allSettled(
          validUris.map(async (uri) => {
            const post = liveMap.get(uri);
            if (post) {
              post.asm = states.get(uri);
              await upsertExternalPostSnapshot(post);
              bskyPostMap.set(uri, externalPostView(post));
            }
          })
        );
      }
    }
  }

  const orderedPosts: (PostData | PresentedPost)[] = [];
  const seenIds = new Set<string>();
  const staleVisitsToRemove: string[] = [];

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
        staleVisitsToRemove.push(visit.raw, `asm:${visit.id}`, visit.id);
      }
    } else {
      const post = bskyPostMap.get(visit.id);
      if (post) {
        seenIds.add(visit.id);
        orderedPosts.push(post);
      }
    }
  }

  if (staleVisitsToRemove.length > 0) {
    try {
      await redis.zrem(redisKey, ...staleVisitsToRemove);
    } catch {
      /* empty */
    }
  }

  const hydrated = await hydrateViewCounts(orderedPosts);

  return Response.json({ posts: hydrated });
}
