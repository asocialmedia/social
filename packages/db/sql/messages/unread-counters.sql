// query: reconcileMessageUnreadCounter.conversation
SELECT "type"
         FROM public.message_conversations
        WHERE id = $1
        FOR NO KEY UPDATE
// query: reconcileMessageUnreadCounter.count
SELECT COUNT(*)::text AS count
         FROM public.messages AS message
        WHERE message."conversationId" = $1
          AND message."senderId" <> $2
          AND message."deletedAt" IS NULL
          AND (
            ($4::integer IS NULL AND message."createdAt" > $3)
            OR ($4::integer IS NOT NULL AND (
              message."creationSequence" > $4
              OR (message."creationSequence" = 0 AND message."createdAt" > $3)
            ))
          )
          AND ($5::timestamp IS NULL OR message."createdAt" >= $5)
          AND NOT EXISTS (
            SELECT 1
              FROM public.message_hidden AS hidden
             WHERE hidden."messageId" = message.id
               AND hidden."userId" = $2
          )
// query: reconcileMessageUnreadCounter.joined
SELECT MAX("createdAt") AS "joinedAt"
           FROM public.message_conversation_membership_events
          WHERE "conversationId" = $1
            AND "targetUserId" = $2
            AND action = 'JOINED'
// query: reconcileMessageUnreadCounter.member
SELECT "createdAt", "lastReadAt", "lastReadSequence", "leftAt",
              "mutedAt", "unreadCount"
         FROM public.message_conversation_members
        WHERE "conversationId" = $1 AND "userId" = $2
        FOR UPDATE
// query: reconcileMessageUnreadCounter.updateConversationMembers
UPDATE public.message_conversation_members
            SET "unreadCount" = 0
          WHERE "conversationId" = $1 AND "userId" = $2
            AND "unreadCount" IS NULL
// query: reconcileMessageUnreadCounter.updated
UPDATE public.message_conversation_members
          SET "unreadCount" = $3
        WHERE "conversationId" = $1 AND "userId" = $2
          AND "unreadCount" IS NULL
