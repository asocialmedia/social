import {
  and,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
  readNetworkPreferences,
} from "@asm/db";
import type { PostsPage } from "@asm/db";
import { defaultNetworkPreferences } from "@asm/protocols/discovery";

import { getSessionFromApi } from "@/lib/auth/session";
import { followingGustsPage } from "@/lib/gusts/following";
import { networkPostAllowed } from "@/lib/posts/network-content-policy";
import { filterNetworkFeed } from "@/lib/recommendations/filter-network-feed";

const TAKE_PATTERN = /^[1-9]\d*$/;

async function queryChronologicalGusts(
  userId: string,
  excludeModerated: boolean,
  cursor: string | undefined,
  limit: number
) {
  let query = getPostDataQuery(prisma.orm, userId)
    .where((post) => {
      const filters = [
        post.postMedias.some((media) => media._type.eq("VIDEO")),
        post.isGust.eq(true),
        post.rootPostId.isNull(),
      ];
      if (excludeModerated) {
        filters.push(post.moderated.eq(false));
      }
      return and(...filters);
    })
    .orderBy([(post) => post.createdAt.desc(), (post) => post.id.desc()]);
  if (cursor) {
    // Prisma 8 cursors are keyset seeks built from the values passed in, so
    // every orderBy column needs one: the anchor's createdAt is read back here
    // because the feed cursor only carries a post id. The seek is exclusive,
    // so no .offset(1) hop is needed.
    const anchor = await prisma.orm.public.Posts.select("createdAt")
      .where({ id: cursor })
      .first();
    if (!anchor) {
      return null;
    }
    query = query.cursor({ createdAt: anchor.createdAt, id: cursor });
  }
  const postRows = await query.limit(limit).all();
  return postRows.map(mapPostData);
}

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const settings = userId ? await readNetworkPreferences(userId) : null;
  const preferences = settings?.preferences ?? defaultNetworkPreferences();
  const allowed = (post: Parameters<typeof networkPostAllowed>[0]) =>
    networkPostAllowed(post, preferences);

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const initialId = url.searchParams.get("initialId") || undefined;
  const mode = url.searchParams.get("mode") === "personalized";
  // Explore's trending-gusts rail opts out of moderated gusts; the reels feed
  // keeps showing them.
  const excludeModerated = url.searchParams.get("excludeModerated") === "1";
  const takeValue = url.searchParams.get("take");
  const requestedTake =
    takeValue && TAKE_PATTERN.test(takeValue)
      ? Math.trunc(Number(takeValue))
      : 0;
  const pageSize = requestedTake > 0 ? Math.min(requestedTake, 20) : 10;

  if (url.searchParams.get("mode") === "following" && !initialId) {
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const data = await followingGustsPage({
      cursor,
      excludeModerated,
      pageSize,
      userId,
    });
    return Response.json(
      { ...data, mode: "following", posts: data.posts.filter(allowed) },
      {
        headers: { "cache-control": "private, no-cache", vary: "Cookie" },
      }
    );
  }

  // Both formats use the selected Network persona and revision-bound cursors.
  if (!initialId && (mode || url.searchParams.has("network"))) {
    const { networkNativeFeed } =
      await import("@/lib/recommendations/network-native-feed");
    return networkNativeFeed(
      request,
      userId,
      mode ? "personalized" : "latest",
      "gust"
    );
  }

  // When initialId is requested on the first page, ensure that gust is returned at the top
  if (initialId && !cursor) {
    const initialPostRow = await getPostDataQuery(prisma.orm, userId)
      .where((post) => {
        const filters = [
          post.postMedias.some((media) => media._type.eq("VIDEO")),
          post.id.eq(initialId),
          post.isGust.eq(true),
          post.rootPostId.isNull(),
        ];
        if (excludeModerated) {
          filters.push(post.moderated.eq(false));
        }
        return and(...filters);
      })
      .first();
    const initialPost = initialPostRow ? mapPostData(initialPostRow) : null;

    const otherPostRows = await getPostDataQuery(prisma.orm, userId)
      .where((post) => {
        const filters = [
          post.postMedias.some((media) => media._type.eq("VIDEO")),
          post.id.neq(initialId),
          post.isGust.eq(true),
          post.rootPostId.isNull(),
        ];
        if (excludeModerated) {
          filters.push(post.moderated.eq(false));
        }
        return and(...filters);
      })
      .orderBy((post) => post.createdAt.desc())
      .limit(pageSize + 1)
      .all();
    const otherPosts = otherPostRows.map(mapPostData);

    const combined = initialPost ? [initialPost, ...otherPosts] : otherPosts;
    const hydrated = await hydrateViewCounts(combined.slice(0, pageSize));
    const nextCursor =
      combined.length > pageSize ? combined[pageSize - 1].id : null;

    const data: PostsPage = {
      nextCursor,
      posts: hydrated.filter(allowed),
    };
    const responseHeaders = userId
      ? { "cache-control": "private, no-cache", vary: "Cookie" }
      : {
          "cache-control": "public, s-maxage=10, stale-while-revalidate=30",
          vary: "Cookie",
        };

    return Response.json(data, { headers: responseHeaders });
  }

  const chronologicalCursor = cursor?.startsWith("exp.")
    ? cursor.slice(4) || undefined
    : cursor;

  const posts =
    (await queryChronologicalGusts(
      userId,
      excludeModerated,
      chronologicalCursor,
      pageSize + 1
    )) ??
    (await queryChronologicalGusts(
      userId,
      excludeModerated,
      undefined,
      pageSize + 1
    )) ??
    [];

  const hydrated = await hydrateViewCounts(posts.slice(0, pageSize));
  const nextCursor = posts.length > pageSize ? posts[pageSize - 1].id : null;
  const data: PostsPage = {
    nextCursor,
    posts: await filterNetworkFeed(hydrated, userId),
  };
  const responseHeaders = userId
    ? { "cache-control": "private, no-cache", vary: "Cookie" }
    : {
        "cache-control": "public, s-maxage=10, stale-while-revalidate=30",
        vary: "Cookie",
      };

  return Response.json(data, { headers: responseHeaders });
}
