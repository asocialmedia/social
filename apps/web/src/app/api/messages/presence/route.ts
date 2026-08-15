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

  // Resolve the online list first so it can be shared with the idle lookup -
  // the online set is read exactly once per poll instead of once here and once
  // inside getIdleUsers.
  const onlineIds = await getOnlineUsers();
  const [idleIds, follows] = await Promise.all([
    getIdleUsers(onlineIds),
    // Presence is mutual: a user is visible to anyone they follow AND anyone
    // who follows them. DM creation only requires the sender to follow the
    // recipient (one direction), so gating presence on a single direction
    // would leave one side seeing "offline" while the other sees "online".
    prisma.follow.findMany({
      select: { followerId: true, followingId: true },
      where: {
        OR: [{ followerId: user.id }, { followingId: user.id }],
      },
    }),
  ]);
  const connectedIds = new Set<string>();
  for (const follow of follows) {
    if (follow.followerId !== user.id) {
      connectedIds.add(follow.followerId);
    }
    if (follow.followingId !== user.id) {
      connectedIds.add(follow.followingId);
    }
  }
  const onlineSet = new Set(onlineIds);
  // Online takes precedence over idle; a user is never both. Deriving the
  // visible list from the two (already disjoint) sets avoids the duplicated
  // concatenation the raw arrays would produce.
  const idleSet = new Set(idleIds.filter((id) => !onlineSet.has(id)));
  const visibleIds = [...onlineSet, ...idleSet].filter((id) =>
    connectedIds.has(id)
  );

  if (visibleIds.length === 0) {
    return Response.json({ users: [] });
  }

  const blocked = await prisma.block.findMany({
    select: { blockedId: true, blockerId: true },
    where: {
      OR: [
        { blockedId: { in: visibleIds }, blockerId: user.id },
        { blockedId: user.id, blockerId: { in: visibleIds } },
      ],
    },
  });
  const blockedIds = new Set<string>();
  for (const block of blocked) {
    // Both block directions remove the other party: when I blocked someone
    // the row names them as blockedId; when someone blocked ME the row names
    // them as blockerId. Either way they must not appear in my results.
    blockedIds.add(
      block.blockedId === user.id ? block.blockerId : block.blockedId
    );
  }

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
