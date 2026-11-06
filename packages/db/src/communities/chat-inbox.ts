import { rawQuery } from "../messages/infrastructure/raw-sql";
import { getJoinedCommunities } from "./service";

// One aggregate read for the viewer, independent of community population.
// No room contents, private-thread metadata, or recipient rosters leave this query.
export async function getCommunityChatInbox(userId: string) {
  if (!userId) {
    return [];
  }
  const [communities, activity] = await Promise.all([
    getJoinedCommunities(userId),
    rawQuery<{ communityId: string; hasUnread: boolean }>(
      `SELECT member."communityId",
        preference."mutedAt" IS NULL AND EXISTS (
          SELECT 1 FROM public.community_chat_rooms room
          LEFT JOIN public.community_chat_rooms parent ON parent.id = room."parentRoomId"
          LEFT JOIN public.community_chat_read_states state
            ON state."roomId" = room.id AND state."userId" = $1
          WHERE room."communityId" = member."communityId"
            AND NOT room.archived AND NOT COALESCE(parent.archived, false)
            AND room."nextSequence" > COALESCE(state."readSequence", 0)
            AND (room.visibility = 'PUBLIC' OR member.role IN ('OWNER', 'MODERATOR') OR EXISTS (
              SELECT 1 FROM public.community_chat_room_members invite
              WHERE invite."roomId" = room.id AND invite."communityMemberId" = member.id
            ))
            AND EXISTS (
              SELECT 1 FROM public.community_chat_messages message
              WHERE message."roomId" = room.id
                AND message.sequence > COALESCE(state."readSequence", 0)
                AND message."senderId" <> $1 AND message."deletedAt" IS NULL
            )
        ) AS "hasUnread"
       FROM public.community_members member
       LEFT JOIN public.community_chat_preferences preference
         ON preference."communityId" = member."communityId" AND preference."userId" = $1
       WHERE member."userId" = $1 AND member.status = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM public.community_chat_sanctions sanction
           WHERE sanction."communityId" = member."communityId" AND sanction."userId" = $1
             AND sanction.kind = 'BAN' AND (sanction."expiresAt" IS NULL OR sanction."expiresAt" > NOW())
         )`,
      [userId],
      { communityId: "pg/text@1", hasUnread: "pg/bool@1" }
    ),
  ]);
  const unreadByCommunity = new Map(
    activity.rows.map((row) => [row.communityId, row.hasUnread])
  );
  return communities.flatMap((community) =>
    unreadByCommunity.has(community.id)
      ? [{ community, hasUnread: unreadByCommunity.get(community.id) ?? false }]
      : []
  );
}
