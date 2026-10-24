import {
  externalPostId,
  findExternalPost,
  readNetworkPreferences,
  prisma,
  recordExternalPostVisit,
  redis,
  toPrismaDateTime,
} from "@asm/db";
import { BlueskyClient } from "@asm/protocols/bluesky";

import { getSessionFromApi } from "@/lib/auth/session";

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = (await request.json().catch(() => null)) as {
    externalPost?: unknown;
    postId?: string;
    uri?: string;
  } | null;

  const targetId = body?.uri || body?.postId;
  if (!targetId) {
    return Response.json({ error: "postId is required" }, { status: 400 });
  }

  const isBluesky = targetId.startsWith("at://") || Boolean(body?.externalPost);

  if (isBluesky) {
    const rawUri =
      body?.uri ||
      (targetId.startsWith("at://")
        ? targetId
        : (body?.externalPost as { id?: string } | undefined)?.id);

    if (!rawUri || !rawUri.startsWith("at://")) {
      return Response.json(
        { error: "Invalid Bluesky post URI" },
        { status: 400 }
      );
    }

    const cached = await findExternalPost(rawUri);
    if (cached && !cached.available) {
      return Response.json({ error: "Post deleted" }, { status: 404 });
    }
    if (cached) {
      const id = externalPostId(rawUri);
      await prisma.orm.public.ExternalEngagements.upsert({
        conflictOn: { externalPostId: id, userId },
        create: {
          amplified: false,
          bookmarked: false,
          externalPostId: id,
          updatedAt: toPrismaDateTime(new Date()),
          userId,
        },
        update: {
          updatedAt: toPrismaDateTime(new Date()),
        },
      }).catch((error) =>
        console.error("Error recording external engagement visit:", error)
      );
    } else {
      try {
        const { preferences } = await readNetworkPreferences(userId);
        const client = new BlueskyClient({
          allowExplicitMedia: preferences.showExplicitContent,
        });
        const posts = await client.getPosts([rawUri]);
        const found = posts.find((p) => p.id === rawUri);
        if (!found) {
          return Response.json({ error: "Post not found" }, { status: 404 });
        }
        await recordExternalPostVisit(userId, found);
      } catch {
        return Response.json({ error: "Post not found" }, { status: 404 });
      }
    }

    if (typeof redis?.zadd === "function") {
      try {
        const key = `user:post-visits:${userId}`;
        await redis.zadd(key, Date.now(), `bsky:${rawUri}`);
        await redis.zremrangebyrank(key, 0, -51);
      } catch (error) {
        console.error("Error updating user visit history in Redis:", error);
      }
    }

    return Response.json({ success: true, type: "bluesky" });
  }

  const post = await prisma.orm.public.Posts.select("id")
    .where({ id: targetId })
    .first();

  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  await prisma.orm.public.PostVisits.upsert({
    conflictOn: { postId: targetId, userId },
    create: { postId: targetId, userId },
    update: { visitedAt: toPrismaDateTime(new Date()) },
  });

  if (typeof redis?.zadd === "function") {
    try {
      const key = `user:post-visits:${userId}`;
      await redis.zadd(key, Date.now(), `asm:${targetId}`);
      await redis.zremrangebyrank(key, 0, -51);
    } catch (error) {
      console.error("Error updating user visit history in Redis:", error);
    }
  }

  return Response.json({ success: true, type: "asm" });
}
