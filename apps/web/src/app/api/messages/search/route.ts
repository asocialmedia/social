import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

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

  const users = await prisma.user.findMany({
    select: {
      avatarUrl: true,
      badge: true,
      displayName: true,
      id: true,
      messageIdentity: { select: { userId: true } },
      username: true,
    },
    take: 10,
    where: {
      AND: [
        // Only people the caller follows are messageable; filter through the
        // relation instead of a separate follow query + id list.
        { followers: { some: { followerId: user.id } } },
        {
          OR: [
            { displayName: { contains: query, mode: "insensitive" } },
            { username: { contains: query, mode: "insensitive" } },
          ],
        },
      ],
    },
  });

  return Response.json({
    users: users.map((u) => ({
      avatarUrl: u.avatarUrl,
      badge: u.badge,
      displayName: u.displayName,
      hasIdentity: u.messageIdentity !== null,
      id: u.id,
      username: u.username,
    })),
  });
}
