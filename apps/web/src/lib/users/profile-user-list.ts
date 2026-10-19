import { and, prisma } from "@asm/db";
import type {
  ProfileUserListData,
  UserListMutual,
} from "@asm/ui/lib/user-list";

export async function getProfileUserList(
  profileId: string,
  viewerId: string,
  kind: "followers" | "following"
): Promise<ProfileUserListData[]> {
  const [users, viewerFollows, external, viewerExternal] = await Promise.all([
    prisma.orm.public.Users.select(
      "avatarUrl",
      "bio",
      "displayName",
      "id",
      "username"
    )
      .where((user) =>
        kind === "followers"
          ? user.follows.some((follow) => follow.followingId.eq(profileId))
          : user.followsFollows.some((follow) =>
              follow.followerId.eq(profileId)
            )
      )
      .include("followsFollows", (follows) =>
        follows.combine({ total: follows.count() })
      )
      .orderBy((user) => user.id.asc())
      .all(),
    prisma.orm.public.Follows.select("followingId")
      .where({ followerId: viewerId })
      .all(),
    kind === "following"
      ? prisma.orm.public.ExternalFollows.where({ userId: profileId })
          .include("author")
          .orderBy((row) => row.createdAt.desc())
          .all()
      : [],
    kind === "following"
      ? prisma.orm.public.ExternalFollows.select("authorDid")
          .where({ userId: viewerId })
          .all()
      : [],
  ]);
  const externalFollowing = new Set(viewerExternal.map((row) => row.authorDid));
  const followingIds = viewerFollows.map((follow) => follow.followingId);
  const following = new Set(followingIds);
  const ids = users.map((user) => user.id);
  const mutualRows =
    ids.length && followingIds.length
      ? await prisma.orm.public.Follows.select("followingId", "followerId")
          .where((follow) =>
            and(follow.followingId.in(ids), follow.followerId.in(followingIds))
          )
          .include("follower", (follower) =>
            follower.select("avatarUrl", "displayName", "id", "username")
          )
          .orderBy((follow) => follow.followerId.asc())
          .all()
      : [];
  const mutuals = new Map<string, { count: number; users: UserListMutual[] }>();
  for (const row of mutualRows) {
    if (
      !row.follower?.username ||
      row.followerId === row.followingId ||
      row.followerId === viewerId ||
      row.followingId === viewerId
    ) {
      continue;
    }
    const entry = mutuals.get(row.followingId) ?? { count: 0, users: [] };
    entry.count += 1;
    if (entry.users.length < 3) {
      entry.users.push({ ...row.follower, username: row.follower.username });
    }
    mutuals.set(row.followingId, entry);
  }
  const native = users.flatMap((user) =>
    user.username
      ? [
          {
            _count: { followers: user.followsFollows.total },
            avatarUrl: user.avatarUrl,
            bio: user.bio,
            displayName: user.displayName,
            id: user.id,
            isFollowing: following.has(user.id),
            mutualCount: mutuals.get(user.id)?.count ?? 0,
            mutualFollowers: mutuals.get(user.id)?.users ?? [],
            username: user.username,
          },
        ]
      : []
  );
  return [
    ...native,
    ...external.map(({ author }) => ({
      _count: { followers: 0 },
      avatarUrl: null,
      bio:
        author.status === "active"
          ? null
          : "This account is currently unavailable.",
      displayName: author.displayName,
      href: `/network/bluesky/profile?${new URLSearchParams({ actor: author.did })}`,
      id: author.did,
      isFollowing: externalFollowing.has(author.did),
      mutualCount: 0,
      mutualFollowers: [],
      source: "bluesky" as const,
      status: author.status,
      username: author.handle,
    })),
  ];
}
