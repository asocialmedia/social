import {
  and,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
} from "@asm/db";
import type { PostsPage } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Mirrors the profile tabs: "posts" (default) returns regular posts, while
  // "gusts" returns only short-form video posts.
  const url = new URL(request.url);
  const isGustFilter = url.searchParams.get("filter") === "gusts";

  const bookmarks = await prisma.orm.public.Bookmarks.select("postId")
    .where({ userId: user.id })
    .orderBy((bookmark) => bookmark.createdAt.desc())
    .all();

  const postIds = bookmarks
    .map((bookmark) => bookmark.postId)
    .filter((postId): postId is string => Boolean(postId));

  const postRows = await getPostDataQuery(prisma.orm, user.id)
    .where((post) => and(post.id.in(postIds), post.isGust.eq(isGustFilter)))
    .all();
  const posts = postRows.map(mapPostData);

  // Preserve the bookmark order (most recently bookmarked first).
  const postById = new Map(posts.map((post) => [post.id, post]));
  const orderedPosts = postIds
    .map((postId) => postById.get(postId))
    .filter((post) => post !== undefined);

  const hydrated = await hydrateViewCounts(orderedPosts);
  const data: PostsPage = {
    nextCursor: null,
    posts: hydrated,
  };
  return Response.json(data);
}
