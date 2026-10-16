// query: commitMessageConversationRead.conversation
SELECT "changeSeq"
         FROM public.message_conversations
        WHERE id = $1
        FOR NO KEY UPDATE
// query: commitMessageConversationRead.membership
SELECT "lastReadAt", "lastReadSequence", "leftAt", "mutedAt"
         FROM public.message_conversation_members
        WHERE "conversationId" = $1 AND "userId" = $2
        FOR UPDATE
// query: commitMessageConversationRead.rangesFragment
message."createdAt" >= ${{parameter1}}
// query: commitMessageConversationRead.rangesFragment2
message."createdAt" <= ${{parameter1}}
// query: commitMessageConversationRead.rangesFragment3
({{bounds}})
// query: commitMessageConversationRead.readPredicateFragment
message."createdAt" > $3
// query: commitMessageConversationRead.readPredicateFragment2
(message."creationSequence" > {{sequenceParameter}}
        OR (message."creationSequence" = 0 AND message."createdAt" > $3))
// query: commitMessageConversationRead.readPredicateFragment3
AND ({{ranges}})
// query: commitMessageConversationRead.unread
SELECT COUNT(*)::text AS count
         FROM public.messages AS message
        WHERE message."conversationId" = $1
          AND message."senderId" <> $2
          AND message."deletedAt" IS NULL
          AND {{readPredicate}}
          AND NOT EXISTS (
            SELECT 1
              FROM public.message_hidden AS hidden
             WHERE hidden."messageId" = message.id
               AND hidden."userId" = $2
          )
          {{membershipPredicate}}
// query: commitMessageConversationRead.updatedMembership
UPDATE public.message_conversation_members
          SET "lastReadAt" = statement_timestamp(),
              "lastDeliveredAt" = statement_timestamp(),
              "lastReadSequence" = $3,
              "unreadCount" = 0
        WHERE "conversationId" = $1 AND "userId" = $2
        RETURNING "lastReadAt"
