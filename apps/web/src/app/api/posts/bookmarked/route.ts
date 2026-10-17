import {
  and,
  externalPostStates,
  fromPrismaDateTime,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
} from "@asm/db";
import type { PostData, PostsPage } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";

import { getSessionFromApi } from "@/lib/auth/session";
import { externalPostView } from "@/lib/posts/presentation";
import type { PresentedPost } from "@/lib/posts/presentation";

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Mirrors the profile tabs: "posts" (default) returns regular posts (and external fleets), while
  // "gusts" returns only short-form video posts.
  const url = new URL(request.url);
  const isGustFilter = url.searchParams.get("filter") === "gusts";

  const [bookmarks, externalEngagements] = await Promise.all([
    prisma.orm.public.Bookmarks.select("postId", "createdAt")
      .where({ userId: user.id })
      .orderBy((bookmark) => bookmark.createdAt.desc())
      .all(),
    isGustFilter
      ? Promise.resolve([])
      : prisma.orm.public.ExternalEngagements.where((entry) =>
          and(entry.userId.eq(user.id), entry.bookmarked.eq(true))
        )
          .select("externalPostId", "updatedAt")
          .include("externalPost", (post) =>
            post.select("uri", "snapshot", "available", "checkedAt")
          )
          .orderBy((entry) => entry.updatedAt.desc())
          .all(),
  ]);

  const postIds = bookmarks
    .map((bookmark) => bookmark.postId)
    .filter((postId): postId is string => Boolean(postId));

  const postRows =
    postIds.length > 0
      ? await getPostDataQuery(prisma.orm, user.id)
          .where((post) => and(post.id.in(postIds), post.isGust.eq(isGustFilter)))
          .all()
      : [];
  const posts = postRows.map(mapPostData);

  const postById = new Map(posts.map((post) => [post.id, post]));

  if (isGustFilter) {
    const orderedGusts = postIds
      .map((postId) => postById.get(postId))
      .filter((post): post is PostData => post !== undefined);
    const hydrated = await hydrateViewCounts(orderedGusts);
    const data: PostsPage = {
      nextCursor: null,
      posts: hydrated,
    };
    return Response.json(data);
  }

  // Regular posts/fleets tab: interleave native ASM posts and External Bluesky posts
  const asmItems: { post: PostData; timestamp: number }[] = [];
  for (const b of bookmarks) {
    const post = postById.get(b.postId);
    if (post) {
      asmItems.push({
        post,
        timestamp: b.createdAt
          ? fromPrismaDateTime(b.createdAt).getTime()
          : 0,
      });
    }
  }

  const bskyItems: { post: PresentedPost; timestamp: number }[] = [];
  if (externalEngagements.length > 0) {
    const externalUris = externalEngagements
      .map((entry) => entry.externalPost?.uri)
      .filter((uri): uri is string => Boolean(uri));
    const states =
      externalUris.length > 0
        ? await externalPostStates(externalUris.slice(0, 50), user.id).catch(
            () => new Map()
          )
        : new Map();

    for (const entry of externalEngagements) {
      if (entry.externalPost?.snapshot) {
        const raw = entry.externalPost.snapshot as unknown as ExternalPost;
        const asmState = states.get(raw.id);
        const postWithState = asmState ? { ...raw, asm: asmState } : raw;
        bskyItems.push({
          post: externalPostView(postWithState),
          timestamp: entry.updatedAt
            ? fromPrismaDateTime(entry.updatedAt).getTime()
            : 0,
        });
      }
    }
  }

  const allItems = [...asmItems, ...bskyItems].toSorted(
    (a, b) => b.timestamp - a.timestamp
  );
  const orderedPosts = allItems.map((item) => item.post);

  const hydrated = await hydrateViewCounts(orderedPosts);
  const data: PostsPage = {
    nextCursor: null,
    posts: hydrated,
  };
  return Response.json(data);
}
