// query: listMessageConversationChanges.result
SELECT change_event.id,
            change_event."conversationId",
            change_event.sequence,
            change_event."messageId",
            change_event.revision,
            change_event.kind,
            to_jsonb(change_event."audienceUserIds") AS "audienceUserIds",
            change_event."createdAt",
            (message.id IS NOT NULL) AS "sourceAvailable",
            message.revision AS "sourceRevision",
            COALESCE(message."deletedAt" IS NOT NULL, false) AS "globallyDeleted",
            (hidden."messageId" IS NOT NULL) AS "hiddenForViewer"
       FROM public.message_conversation_changes AS change_event
       LEFT JOIN public.messages AS message
         ON message.id = change_event."messageId"
        AND message."conversationId" = change_event."conversationId"
       LEFT JOIN public.message_hidden AS hidden
         ON hidden."messageId" = change_event."messageId"
        AND hidden."userId" = $4
      WHERE change_event."conversationId" = $1
        AND change_event.sequence > $2
        AND change_event.sequence <= $3
        AND change_event."audienceUserIds" @> ARRAY[$4::text]
        AND (
          change_event."messageId" IS NULL OR message.id IS NULL OR (
            $5::jsonb IS NULL OR EXISTS (
              SELECT 1
                FROM jsonb_array_elements($5::jsonb) AS membership_window
               WHERE (membership_window.value->>'after' IS NULL OR message."createdAt" >= (membership_window.value->>'after')::timestamp)
                 AND (membership_window.value->>'before' IS NULL OR message."createdAt" <= (membership_window.value->>'before')::timestamp)
            )
          )
        )
      ORDER BY change_event.sequence ASC
      LIMIT $6
