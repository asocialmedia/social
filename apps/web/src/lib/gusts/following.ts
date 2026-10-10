import {
  and,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  or,
  prisma,
} from "@asm/db";
import type { GustsPage } from "@asm/db";

export async function followingGustsPage(options: {
  cursor?: string;
  excludeModerated: boolean;
  pageSize: number;
  userId: string;
}): Promise<GustsPage> {
  const { cursor, excludeModerated, pageSize, userId } = options;
  const follows = await prisma.orm.public.Follows.select("followingId")
    .where({ followerId: userId })
    .all();
  const followingIds = follows.map((follow) => follow.followingId);
  if (followingIds.length === 0) {
    return { nextCursor: null, posts: [] };
  }
  let query = getPostDataQuery(prisma.orm, userId)
    .where((post) =>
      and(
        post.isGust.eq(true),
        post.rootPostId.isNull(),
        post.postMedias.some((media) => media._type.eq("VIDEO")),
        ...(excludeModerated ? [post.moderated.eq(false)] : []),
        or(
          post.userId.in(followingIds),
          post.votes.some((vote) =>
            and(vote.value.eq(1), vote.userId.in(followingIds))
          )
        )
      )
    )
    .orderBy([(post) => post.createdAt.desc(), (post) => post.id.desc()]);
  if (cursor) {
    const anchor = await prisma.orm.public.Posts.select("createdAt")
      .where({ id: cursor })
      .first();
    if (anchor) {
      query = query.cursor({ createdAt: anchor.createdAt, id: cursor });
    }
  }
  const rows = await query.limit(pageSize + 1).all();
  const posts = rows.slice(0, pageSize).map(mapPostData);
  if (posts.length === 0) {
    return { nextCursor: null, posts: [] };
  }
  const [people, amplifications] = await Promise.all([
    prisma.orm.public.Users.select("avatarUrl", "id", "username")
      .where((person) => person.id.in(followingIds))
      .all(),
    prisma.orm.public.Votes.select("postId", "userId")
      .where((vote) =>
        and(
          vote.postId.in(posts.map((post) => post.id)),
          vote.userId.in(followingIds),
          vote.value.eq(1)
        )
      )
      .orderBy([(vote) => vote.createdAt.desc(), (vote) => vote.userId.asc()])
      .all(),
  ]);
  const byId = new Map(people.map((person) => [person.id, person]));
  const hydrated = await hydrateViewCounts(posts);
  return {
    nextCursor: rows.length > pageSize ? (posts.at(-1)?.id ?? null) : null,
    posts: hydrated.map((post) => {
      const sourceIds = new Set([
        ...(byId.has(post.userId) ? [post.userId] : []),
        ...amplifications
          .filter((vote) => vote.postId === post.id)
          .map((vote) => vote.userId),
      ]);
      return {
        ...post,
        followingSources: [...sourceIds].flatMap((id) => {
          const person = byId.get(id);
          return person ? [person] : [];
        }),
      };
    }),
  };
}
