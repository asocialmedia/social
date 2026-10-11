import type { MessageCountInfo } from "@asm/db";
import {
  and,
  fromPrismaDateTime,
  listDenMembershipEventsForUser,
  prisma,
  unreadMessageCache,
  unreadMessagesWhere,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { dmPeerId, isHiddenByBlock } from "@/lib/messages/blocks";
import { readerMessageWindows } from "@/lib/messages/reader-window";

// The number of conversations a reader is in is not bounded by anything they
// control: a member of a hundred dens plus a few hundred DMs is an ordinary
// account. Two things follow, and they are the two things this route is careful
// about.
//
// SHAPE. Ready per-member counters answer the common case without scanning message
// history. One grouped read handles only rows awaiting backfill, not one count per
// membership. `unreadMessagesWhere` remains the shared fallback predicate, so a
// partial rollout cannot disagree with the conversation list about unread rows.
//
// QUESTION. Only a DM can be hidden by a block, and a den is a room that admits
// regardless of blocks, so the candidate query is filtered to DMs in SQL and a
// den's roster is never loaded at all. Loading it was pure waste: a member of a
// hundred-member den paid for a hundred ids that the DM-only question threw away
// on the next line.
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

  // Seed the Redis counter from the DB baseline so subsequent increments build on
  // the correct number (mirrors the notification badge flow).
  //
  // Each conversation is bounded by its OWN read watermark - the global earliest
  // read would over-count threads the user has already read. Muted memberships are
  // excluded here and not later: a mute is this member's own preference and the
  // query is the only place that can skip the conversation entirely.
  const [memberships, iBlocked, blockedMe] = await Promise.all([
    prisma.orm.public.MessageConversationMembers.select(
      "conversationId",
      "createdAt",
      "lastReadAt",
      "lastReadSequence",
      "unreadCount"
    )
      // The conversation's type rides the same read: the windows below apply to
      // dens only, and asking the type separately would be a second round trip
      // for a fact this row already points at.
      .include("conversation", (conversation) => conversation.select("_type"))
      .where((member) =>
        and(
          member.userId.eq(user.id),
          // A den this person left is kept in their list and stays readable, and
          // it is not part of their unread count: they cannot clear it, because
          // the read route refuses them, so counting it would be a badge they can
          // never spend. Same reasoning as the mute on the next line.
          member.leftAt.isNull(),
          member.mutedAt.isNull()
        )
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
  if (hiddenPartnerIds.size !== 0 && memberships.length > 0) {
    // DMs ONLY, because that is the only kind of conversation a block applies to.
    // The type filter is the rule, applied where it is cheapest: a den has no
    // peer, so asking whether one is hidden by a block has no answer other than
    // no. Restricting in SQL means a hundred-member den contributes nothing at
    // all here, where the previous shape read a hundred member ids and then
    // resolved an arbitrary "peer" out of them - which made the badge for a den
    // depend on row order. That is worse than either possible answer, because a
    // member could watch their own badge move as somebody unrelated joined.
    //
    // The peer is then resolved by the shared predicate rather than by the
    // conversation list, the detail gate and the send path re-deriving it.
    const blockedDms = await prisma.orm.public.MessageConversations.select(
      "id",
      "_type"
    )
      .include("messageConversationMembers", (member) =>
        member.select("userId")
      )
      .where((conversation) =>
        and(
          conversation._type.eq("DM"),
          conversation.id.in(memberships.map((entry) => entry.conversationId))
        )
      )
      .all();
    const hiddenConversationIds = new Set(
      blockedDms
        .filter((conversation) => {
          const peer = dmPeerId(
            conversation.messageConversationMembers,
            user.id
          );
          return isHiddenByBlock(
            conversation._type,
            peer,
            peer !== undefined && hiddenPartnerIds.has(peer)
          );
        })
        .map((conversation) => conversation.id)
    );
    if (hiddenConversationIds.size > 0) {
      visibleMemberships = memberships.filter(
        (membership) => !hiddenConversationIds.has(membership.conversationId)
      );
    }
  }

  // The membership windows each den branch is counted within. A reader who left
  // a den and came back is shown neither stint's gap in the transcript, and the
  // badge must not count what the thread refuses to show - a badge that opens to
  // nothing reads as lost messages. Only dens need the log: a DM has no stints,
  // and its branch carries no windows at all.
  const denMemberships = visibleMemberships.filter(
    (membership) => membership.conversation?._type === "DEN"
  );
  const windowsByDen = new Map<
    string,
    ReturnType<typeof readerMessageWindows>
  >();
  if (denMemberships.length > 0) {
    const membershipEventsByDen = await listDenMembershipEventsForUser(
      denMemberships.map((membership) => membership.conversationId),
      user.id
    );
    for (const membership of denMemberships) {
      windowsByDen.set(
        membership.conversationId,
        readerMessageWindows({
          conversationType: "DEN",
          events: membershipEventsByDen.get(membership.conversationId) ?? [],
          membership: {
            createdAt: fromPrismaDateTime(membership.createdAt),
            leftAt: null,
          },
          userId: user.id,
        })
      );
    }
  }

  const readyUnreadCount = visibleMemberships.reduce(
    (total, membership) => total + (membership.unreadCount ?? 0),
    0
  );
  const pendingMemberships = visibleMemberships.filter(
    (membership) =>
      membership.unreadCount === null || membership.unreadCount === undefined
  );
  let unreadCount = readyUnreadCount;
  if (pendingMemberships.length > 0) {
    // ONE read for the whole inbox.
    //
    // The conversation list buckets these rows by `conversationId` because it has
    // to render a count per row. Nothing here does: the response is a single
    // number, so the rows are already the answer and a Map of per-conversation
    // totals would be summed straight back into the same integer. The shape that
    // matters is the one shared predicate above, not the shape of the bookkeeping
    // after it.
    //
    // The OR-branch form is index-friendly rather than merely correct: there is a
    // `messages(conversationId, createdAt)` index, so every branch is one bounded
    // range scan and Postgres folds N of them into a single BitmapOr. The N moved
    // from N round trips in this process to N index probes inside one, which is
    // where it belonged - the loop spent its time on the network, not on the scan.
    let unreadCounts: { count: number }[];
    try {
      unreadCounts = await prisma.orm.public.Messages.where(
        unreadMessagesWhere({
          userId: user.id,
          watermarks: pendingMemberships.map((membership) => {
            const { lastReadSequence } = membership;
            return {
              conversationId: membership.conversationId,
              lastReadAt: membership.lastReadAt
                ? fromPrismaDateTime(membership.lastReadAt)
                : null,
              ...(lastReadSequence === null || lastReadSequence === undefined
                ? {}
                : { lastReadSequence }),
              // Undefined for a DM: no windows, no range, the branch stays exactly
              // what it was. For a den the windows are the reader's stints, so a
              // stretch they were away for cannot inflate a badge they will spend
              // against a thread that hides it.
              windows: windowsByDen.get(membership.conversationId),
            };
          }),
        })
      )
        .groupBy("conversationId")
        .aggregate((aggregate) => ({ count: aggregate.count() }));
    } catch {
      return Response.json(
        { error: "Unread message count is temporarily unavailable" },
        { status: 503 }
      );
    }
    unreadCount += unreadCounts.reduce((total, row) => total + row.count, 0);
    if (!Number.isSafeInteger(unreadCount) || unreadCount < 0) {
      return Response.json(
        { error: "Unread message count is temporarily unavailable" },
        { status: 503 }
      );
    }
  }

  if (unreadCount > 0) {
    await unreadMessageCache.increment(user.id, unreadCount);
  }

  return Response.json({ unreadCount } satisfies MessageCountInfo);
}
