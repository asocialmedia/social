// query: lockMessageSearchCoverageRow.insertSearchCoverage
INSERT INTO public.message_search_coverage ("conversationId")
     VALUES ($1)
     ON CONFLICT ("conversationId") DO NOTHING
// query: lockMessageSearchCoverageRow.locked
SELECT "conversationId"
       FROM public.message_search_coverage
      WHERE "conversationId" = $1
      FOR UPDATE
// query: refreshUnreadableSearchCoverage.coverage
SELECT to_jsonb((SELECT COALESCE(
               array_agg(DISTINCT gap."keyEpoch" ORDER BY gap."keyEpoch")
                 FILTER (WHERE gap."unrecoverableEpoch" AND gap."keyEpoch" IS NOT NULL),
               '{}'::int[]
             )
               FROM public.message_search_gaps AS gap
               JOIN public.messages AS message
                 ON message.id = gap."messageId"
                AND message."conversationId" = gap."conversationId"
                AND message.revision = gap.revision
              WHERE gap."conversationId" = $1
                AND message."deletedAt" IS NULL
             )) AS "unrecoverableEpochIds",
             EXISTS (
               SELECT 1
                 FROM public.message_search_gaps AS gap
                 JOIN public.messages AS message
                   ON message.id = gap."messageId"
                  AND message."conversationId" = gap."conversationId"
                  AND message.revision = gap.revision
                WHERE gap."conversationId" = $1
                  AND message."deletedAt" IS NULL
             ) AS "hasUnreadableMessages"
// query: refreshUnreadableSearchCoverage.updated
UPDATE public.message_search_coverage
        SET "unrecoverableEpochIds" = $2::int[],
            "unrecoverableEpochs" = cardinality($2::int[]),
            "hasUnreadableMessages" = $3,
            "updatedAt" = now()
      WHERE "conversationId" = $1
