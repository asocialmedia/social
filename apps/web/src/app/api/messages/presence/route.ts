import { getIdleUsers, getOnlineUsers, markUserOnline, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

export interface PresenceUser {
  avatarUrl: string | null;
  displayName: string;
  id: string;
  status: "idle" | "online";
  username: string;
}

export async function POST() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await markUserOnline(user.id);
  return Response.json({ ok: true });
}

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [onlineIds, idleIds, followed] = await Promise.all([
    getOnlineUsers(),
    getIdleUsers(),
    prisma.follow.findMany({
      select: { followingId: true },
      where: { followerId: user.id },
    }),
  ]);
  const followedIds = new Set(followed.map((follow) => follow.followingId));
  const onlineSet = new Set(onlineIds);
  // Online takes precedence over idle; a user is never both.
  const idleSet = new Set(idleIds.filter((id) => !onlineSet.has(id)));
  const visibleIds = [...onlineIds, ...idleIds].filter(
    (id) => followedIds.has(id) && (onlineSet.has(id) || idleSet.has(id))
  );

  if (visibleIds.length === 0) {
    return Response.json({ users: [] });
  }

  const blocked = await prisma.block.findMany({
    select: { blockedId: true },
    where: {
      OR: [
        { blockedId: { in: visibleIds }, blockerId: user.id },
        { blockedId: user.id, blockerId: { in: visibleIds } },
      ],
    },
  });
  const blockedIds = new Set(blocked.map((block) => block.blockedId));

  const visible = visibleIds.filter((id) => !blockedIds.has(id));
  if (visible.length === 0) {
    return Response.json({ users: [] });
  }

  const users = await prisma.user.findMany({
    select: {
      avatarUrl: true,
      displayName: true,
      id: true,
      username: true,
    },
    where: { id: { in: visible } },
  });

  const withStatus: PresenceUser[] = users.map((member) => ({
    ...member,
    status: onlineSet.has(member.id) ? "online" : "idle",
  }));

  return Response.json({ users: withStatus } satisfies {
    users: PresenceUser[];
  });
}
