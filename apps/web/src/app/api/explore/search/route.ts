import {
  and,
  communityVisibilityWhere,
  getPostDataQuery,
  getUserDataQuery,
  hydrateViewCounts,
  mapPostData,
  mapUserData,
  prisma,
  searchCommunitiesForSearch,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

const TAKE_PATTERN = /^[1-9]\d*$/;

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const tabParam = url.searchParams.get("tab");
  let tab: "for-you" | "people" | "trending" | "gusts" = "for-you";
  if (tabParam === "trending") {
    tab = "trending";
  } else if (tabParam === "gusts") {
    tab = "gusts";
  } else if (tabParam === "people") {
    tab = "people";
  }

  const takeValue = url.searchParams.get("take");
  const requestedTake =
    takeValue && TAKE_PATTERN.test(takeValue)
      ? Math.trunc(Number(takeValue))
      : 0;
  const pageSize = requestedTake > 0 ? Math.min(requestedTake, 20) : 20;

  if (!q) {
    return Response.json({ posts: [], users: [] });
  }

  const lowerQ = q.toLowerCase();
  const pattern = `%${q.replaceAll(/[\\%_]/g, "\\$&")}%`;
  const visibility = communityVisibilityWhere(userId);
  const [
    contentPosts,
    tagPosts,
    semanticPosts,
    transcriptPosts,
    ocrPosts,
    mediaSemanticPosts,
    usernameUsers,
    displayNameUsers,
    displayUsernameUsers,
    communities,
  ] = await Promise.all([
    getPostDataQuery(prisma.orm, userId)
      .where((post) =>
        and(
          post.content.ilike(pattern),
          visibility(post),
          post.moderated.eq(false),
          post.rootPostId.isNull(),
          ...(tab === "gusts" ? [post.isGust.eq(true)] : [])
        )
      )
      .limit(pageSize)
      .all(),
    getPostDataQuery(prisma.orm, userId)
      .where((post) =>
        and(
          post.postToTags.some((postTag) =>
            postTag.tag.some((tag) => tag.name.ilike(pattern))
          ),
          visibility(post),
          post.moderated.eq(false),
          post.rootPostId.isNull(),
          ...(tab === "gusts" ? [post.isGust.eq(true)] : [])
        )
      )
      .limit(pageSize)
      .all(),
    getPostDataQuery(prisma.orm, userId)
      .where((post) =>
        and(
          post.semanticTags.in([[lowerQ]]),
          visibility(post),
          post.moderated.eq(false),
          post.rootPostId.isNull(),
          ...(tab === "gusts" ? [post.isGust.eq(true)] : [])
        )
      )
      .limit(pageSize)
      .all(),
    getPostDataQuery(prisma.orm, userId)
      .where((post) =>
        and(
          post.postMedias.some((media) => media.transcript.ilike(pattern)),
          visibility(post),
          post.moderated.eq(false),
          post.rootPostId.isNull(),
          ...(tab === "gusts" ? [post.isGust.eq(true)] : [])
        )
      )
      .limit(pageSize)
      .all(),
    getPostDataQuery(prisma.orm, userId)
      .where((post) =>
        and(
          post.postMedias.some((media) => media.ocrText.ilike(pattern)),
          visibility(post),
          post.moderated.eq(false),
          post.rootPostId.isNull(),
          ...(tab === "gusts" ? [post.isGust.eq(true)] : [])
        )
      )
      .limit(pageSize)
      .all(),
    getPostDataQuery(prisma.orm, userId)
      .where((post) =>
        and(
          post.postMedias.some((media) => media.semanticTags.in([[lowerQ]])),
          visibility(post),
          post.moderated.eq(false),
          post.rootPostId.isNull(),
          ...(tab === "gusts" ? [post.isGust.eq(true)] : [])
        )
      )
      .limit(pageSize)
      .all(),
    getUserDataQuery(prisma.orm, userId)
      .where((user) => user.username.ilike(pattern))
      .orderBy((user) => user.aura.desc())
      .limit(pageSize)
      .all(),
    getUserDataQuery(prisma.orm, userId)
      .where((user) => user.displayName.ilike(pattern))
      .orderBy((user) => user.aura.desc())
      .limit(pageSize)
      .all(),
    getUserDataQuery(prisma.orm, userId)
      .where((user) => user.displayUsername.ilike(pattern))
      .orderBy((user) => user.aura.desc())
      .limit(pageSize)
      .all(),
    searchCommunitiesForSearch(q, pageSize),
  ]);

  const uniquePosts = new Map(
    [
      ...contentPosts,
      ...tagPosts,
      ...semanticPosts,
      ...transcriptPosts,
      ...ocrPosts,
      ...mediaSemanticPosts,
    ].map((post) => [post.id, post])
  );
  const rawPosts = [...uniquePosts.values()]
    .toSorted((left, right) => {
      if (tab === "trending") {
        return right.aura - left.aura || right.id.localeCompare(left.id);
      }
      return right.createdAt
        .toString()
        .localeCompare(left.createdAt.toString());
    })
    .slice(0, pageSize);

  const uniqueUsers = new Map(
    [...usernameUsers, ...displayNameUsers, ...displayUsernameUsers].map(
      (user) => [user.id, user]
    )
  );
  const users = [...uniqueUsers.values()]
    .toSorted((left, right) => right.aura - left.aura)
    .slice(0, pageSize)
    .map(mapUserData);
  const posts = await hydrateViewCounts(rawPosts.map(mapPostData));

  return Response.json({ communities, posts, users });
}
