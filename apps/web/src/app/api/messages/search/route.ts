import { and, prisma, SYSTEM_MODERATION_USER_ID } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();

  if (query.length < 1) {
    return Response.json({ users: [] });
  }

  const pattern = `%${query}%`;
  const [usernameMatches, displayNameMatches] = await Promise.all([
    prisma.orm.public.Users.select(
      "avatarUrl",
      "badge",
      "badges",
      "displayName",
      "id",
      "username"
    )
      .where((candidate) =>
        and(
          candidate.id.notIn([SYSTEM_MODERATION_USER_ID]),
          candidate.followsFollows.some((follow) =>
            follow.followerId.eq(user.id)
          ),
          candidate.username.ilike(pattern)
        )
      )
      .include("messageIdentities", (identity) => identity.select("userId"))
      .limit(10)
      .all(),
    prisma.orm.public.Users.select(
      "avatarUrl",
      "badge",
      "badges",
      "displayName",
      "id",
      "username"
    )
      .where((candidate) =>
        and(
          candidate.id.notIn([SYSTEM_MODERATION_USER_ID]),
          candidate.followsFollows.some((follow) =>
            follow.followerId.eq(user.id)
          ),
          candidate.displayName.ilike(pattern)
        )
      )
      .include("messageIdentities", (identity) => identity.select("userId"))
      .limit(10)
      .all(),
  ]);
  const users = [...usernameMatches, ...displayNameMatches].filter(
    (candidate, index, all) =>
      all.findIndex((other) => other.id === candidate.id) === index
  );

  return Response.json({
    users: users.map((u) => ({
      avatarUrl: u.avatarUrl,
      badge: u.badge,
      badges: u.badges,
      displayName: u.displayName,
      hasIdentity: u.messageIdentities !== null,
      id: u.id,
      username: u.username,
    })),
  });
}
