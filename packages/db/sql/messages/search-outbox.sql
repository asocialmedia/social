// query: markSearchOutboxUnreadable.completed
UPDATE public.message_search_outbox
          SET "completedAt" = now()
        WHERE id = $1 AND revision = $2 AND "completedAt" IS NULL
        RETURNING "conversationId"
// query: markSearchOutboxUnreadable.coverage
SELECT MAX("changeSequence") AS "maxSequence",
                MIN("changeSequence") FILTER (WHERE "completedAt" IS NULL) AS "pendingSequence"
           FROM public.message_search_outbox
          WHERE "conversationId" = $1
// query: markSearchOutboxUnreadable.deleteSearchGaps
DELETE FROM public.message_search_gaps
            WHERE "conversationId" = $1 AND "messageId" = $2 AND revision <= $3
// query: markSearchOutboxUnreadable.insertSearchGaps
INSERT INTO public.message_search_gaps
             ("conversationId", "messageId", revision, "keyEpoch", "unrecoverableEpoch")
           SELECT $1, message.id, message.revision, message."keyEpoch", $4
             FROM public.messages AS message
            WHERE message.id = $2
              AND message."conversationId" = $1
              AND message.revision = $3
              AND message."deletedAt" IS NULL
           ON CONFLICT ("conversationId", "messageId") DO UPDATE
             SET revision = EXCLUDED.revision,
                 "keyEpoch" = EXCLUDED."keyEpoch",
                 "unrecoverableEpoch" = EXCLUDED."unrecoverableEpoch"
           WHERE public.message_search_gaps.revision <= EXCLUDED.revision
// query: markSearchOutboxUnreadable.pending
SELECT "messageId", "conversationId", "changeSequence"
         FROM public.message_search_outbox
        WHERE id = $1 AND revision = $2 AND "completedAt" IS NULL
// query: markSearchOutboxUnreadable.source
SELECT revision, "deletedAt"
         FROM public.messages
        WHERE id = $1 AND "conversationId" = $2
        FOR SHARE
// query: markSearchOutboxUnreadable.updatedCoverage
UPDATE public.message_search_coverage
            SET "completedChangeSeq" = GREATEST("completedChangeSeq", $2),
                "updatedAt" = now()
          WHERE "conversationId" = $1
// query: recordMessageSearchOutboxFailure.result
UPDATE public.message_search_outbox
          SET attempts = attempts + 1
        WHERE id = $1
          AND "completedAt" IS NULL
          AND attempts < $2
        RETURNING attempts
