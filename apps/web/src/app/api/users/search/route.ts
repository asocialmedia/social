import { and, prisma, toPrismaDateTime } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET(request: Request) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const query = url.searchParams.get("q");

    if (!query) {
      return Response.json({ users: [] });
    }

    const pattern = `%${query}%`;
    const [usernameMatches, displayNameMatches, aliasRows] = await Promise.all([
      prisma.orm.public.Users.select(
        "avatarUrl",
        "displayName",
        "id",
        "username"
      )
        .where((candidate) => candidate.username.ilike(pattern))
        .limit(10)
        .all(),
      prisma.orm.public.Users.select(
        "avatarUrl",
        "displayName",
        "id",
        "username"
      )
        .where((candidate) => candidate.displayName.ilike(pattern))
        .limit(10)
        .all(),
      prisma.orm.public.UsernameAliases.where((alias) =>
        and(
          alias.expiresAt.gt(toPrismaDateTime(new Date())),
          alias.username.ilike(pattern)
        )
      )
        .include("user", (includedUser) =>
          includedUser.select("avatarUrl", "displayName", "id", "username")
        )
        .all(),
    ]);
    const users = [
      ...usernameMatches,
      ...displayNameMatches,
      ...aliasRows.flatMap((alias) => (alias.user ? [alias.user] : [])),
    ]
      .filter(
        (candidate, index, all) =>
          all.findIndex((other) => other.id === candidate.id) === index
      )
      .slice(0, 10);

    return Response.json({ users });
  } catch (error) {
    console.error("Error searching users:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
