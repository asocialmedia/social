import type { MessageCountInfo } from "@asm/db";
import {
  and,
  fromPrismaDateTime,
  prisma,
  unreadMessageCache,
  unreadMessageWhere,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cached = await unreadMessageCache.get(user.id);
  if (cached !== null) {
    return Response.json({ unreadCount: cached } satisfies MessageCountInfo);
  }

  // Seed the Redis counter from the DB baseline so subsequent increments
  // build on the correct number (mirrors the notification badge flow). Each
  // conversation is bounded by its OWN read watermark - the global earliest
  // read would over-count threads the user has already read. Conversations
  // with a blocked partner are excluded entirely: blocked pairs must not see
  // each other's activity, unread badges included. Conversations the member has
  // muted are excluded for the same reason a mute exists at all: no badge.
  const [memberships, iBlocked, blockedMe] = await Promise.all([
    prisma.orm.public.MessageConversationMembers.select(
      "conversationId",
      "lastReadAt"
    )
      .where((member) =>
        and(member.userId.eq(user.id), member.mutedAt.isNull())
      )
      .all(),
    prisma.orm.public.Blocks.select("blockedId")
      .where({ blockerId: user.id })
      .all(),
    prisma.orm.public.Blocks.select("blockerId")
      .where({ blockedId: user.id })
      .all(),
  ]);
  const hiddenPartnerIds = new Set<string>([
    ...iBlocked.map((row) => row.blockedId),
    ...blockedMe.map((row) => row.blockerId),
  ]);
  let visibleMemberships = memberships;
  if (hiddenPartnerIds.size !== 0) {
    const resolved = await Promise.all(
      memberships.map(async (membership) => {
        const other = await prisma.orm.public.MessageConversationMembers.select(
          "userId"
        )
          .where((candidate) =>
            and(
              candidate.conversationId.eq(membership.conversationId),
              candidate.userId.notIn([user.id])
            )
          )
          .first();
        return other && hiddenPartnerIds.has(other.userId) ? null : membership;
      })
    );
    visibleMemberships = resolved.filter(
      (membership): membership is (typeof memberships)[number] =>
        membership !== null
    );
  }

  let unreadCount = 0;
  if (visibleMemberships.length > 0) {
    const counts = await Promise.all(
      visibleMemberships.map((membership) =>
        prisma.orm.public.Messages.where(
          unreadMessageWhere({
            conversationId: membership.conversationId,
            lastReadAt: membership.lastReadAt
              ? fromPrismaDateTime(membership.lastReadAt)
              : null,
            userId: user.id,
          })
        ).aggregate((aggregate) => ({ count: aggregate.count() }))
      )
    );
    unreadCount = counts.reduce((sum, count) => sum + count.count, 0);
  }

  if (unreadCount > 0) {
    await unreadMessageCache.increment(user.id, unreadCount);
  }

  return Response.json({ unreadCount } satisfies MessageCountInfo);
}
