// query: commitMessageHides.bumped
UPDATE public.message_conversations
          SET "changeSeq" = "changeSeq" + $2
        WHERE id = $1
        RETURNING "changeSeq"
// query: commitMessageHides.changesFragment
message.hidden
// query: commitMessageHides.conversation
SELECT "changeSeq"
         FROM public.message_conversations
        WHERE id = $1
        FOR UPDATE
// query: commitMessageHides.insertConversationChanges
INSERT INTO public.message_conversation_changes
         (id, "conversationId", sequence, "messageId", revision, kind, "audienceUserIds")
       VALUES {{placeholders}}
// query: commitMessageHides.inserted
INSERT INTO public.message_hidden ("messageId", "userId")
       SELECT message.id, $2
         FROM public.messages AS message
        WHERE message."conversationId" = $1
          AND message.id = ANY($3::text[])
       ON CONFLICT ("messageId", "userId") DO NOTHING
       RETURNING "messageId"
// query: commitMessageHides.membership
SELECT "lastReadAt", "lastReadSequence", "leftAt", "mutedAt"
         FROM public.message_conversation_members
        WHERE "conversationId" = $1 AND "userId" = $2
        FOR UPDATE
// query: commitMessageHides.placeholdersFragment
(${{parameter1}}, ${{parameter2}}, ${{parameter3}}, ${{parameter4}}, ${{parameter5}}, ${{parameter6}}, ${{parameter7}}::text[])
// query: commitMessageHides.source
SELECT id, "senderId", "createdAt", "creationSequence", "deletedAt", revision
         FROM public.messages
        WHERE "conversationId" = $1 AND id = ANY($2::text[])
        ORDER BY id
// query: commitMessageHides.updateConversationMembers
UPDATE public.message_conversation_members
          SET "unreadCount" = NULL
        WHERE "conversationId" = $1 AND "userId" = $2
