// query: commitMessageSearchMutation.audience
SELECT to_jsonb(COALESCE(array_agg("userId"), ARRAY[]::text[])) AS "audienceUserIds"
         FROM public.message_conversation_members
        WHERE "conversationId" = $1 AND "leftAt" IS NULL
// query: commitMessageSearchMutation.conversationLock
SELECT id
         FROM public.message_conversations
        WHERE id = $1
        FOR UPDATE
// query: commitMessageSearchMutation.deleteMessage
UPDATE public.messages
                SET "deletedAt" = $4, revision = revision + 1
              WHERE id = $1 AND "conversationId" = $2 AND revision = $3
              RETURNING revision
// query: commitMessageSearchMutation.deleteSearchGaps
DELETE FROM public.message_search_gaps
        WHERE "conversationId" = $1 AND "messageId" = $2 AND revision < $3
// query: commitMessageSearchMutation.editMessage
UPDATE public.messages
                SET ciphertext = $4, iv = $5, "editedAt" = $6,
                    revision = revision + 1
              WHERE id = $1 AND "conversationId" = $2 AND revision = $3
              RETURNING revision
// query: commitMessageSearchMutation.insertConversationChanges
INSERT INTO public.message_conversation_changes
         (id, "conversationId", sequence, "messageId", revision, kind, "audienceUserIds")
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[])
// query: commitMessageSearchMutation.insertSearchOutbox
INSERT INTO public.message_search_outbox
         (id, "conversationId", "messageId", revision, "changeSequence", kind, "audienceUserIds")
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[])
// query: commitMessageSearchMutation.readPredicateFragment
message.deleted
// query: commitMessageSearchMutation.readPredicateFragment2
message.edited
// query: commitMessageSearchMutation.sequence
UPDATE public.message_conversations
          SET "changeSeq" = "changeSeq" + 1
        WHERE id = $1
        RETURNING "changeSeq"
// query: commitMessageSearchMutation.source
SELECT "deletedAt", revision,
              COALESCE("createdAt" >= $4::timestamp, false) AS "withinEditWindow"
         FROM public.messages AS message
        WHERE id = $1
          AND "conversationId" = $2
          AND "senderId" = $3
          AND EXISTS (
            SELECT 1
              FROM public.message_conversation_members AS member
             WHERE member."conversationId" = message."conversationId"
               AND member."userId" = $3
               AND member."leftAt" IS NULL
          )
        FOR UPDATE OF message
// query: commitMessageSearchMutation.updateConversationMembers
UPDATE public.message_conversation_members
            SET "unreadCount" = NULL
          WHERE "conversationId" = $1
            AND "leftAt" IS NULL
            AND "mutedAt" IS NULL
