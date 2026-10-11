// query: startMessageSearchBackfill.insertSearchCoverage
INSERT INTO public.message_search_coverage
       ("conversationId", "backfillThroughSequence", "backfillStartedAt", "updatedAt")
     SELECT id, "changeSeq", now(), now()
       FROM public.message_conversations
      WHERE id = $1
     ON CONFLICT ("conversationId") DO UPDATE
       SET "backfillThroughSequence" = EXCLUDED."backfillThroughSequence",
           "backfillStartedAt" = now(),
           "backfillCursorCreatedAt" = CASE WHEN public.message_search_coverage."backfillCompletedAt" IS NOT NULL THEN NULL ELSE public.message_search_coverage."backfillCursorCreatedAt" END,
           "backfillCursorMessageId" = CASE WHEN public.message_search_coverage."backfillCompletedAt" IS NOT NULL THEN NULL ELSE public.message_search_coverage."backfillCursorMessageId" END,
           "backfillCompletedAt" = NULL,
           "updatedAt" = now()
     WHERE public.message_search_coverage."backfillStartedAt" IS NULL
       AND public.message_search_coverage."backfillCompletedAt" IS NULL
       OR (public.message_search_coverage."backfillCompletedAt" IS NOT NULL
           AND (
             EXISTS ({{UNVERIFIED_CONVERSATION_EPOCH_SQL}}) OR
             public.message_search_coverage."unrecoverableEpochs" >
               cardinality(public.message_search_coverage."unrecoverableEpochIds")
           ))
// query: startMessageSearchBackfill.result
SELECT "backfillCompletedAt", "backfillCursorCreatedAt",
            "backfillCursorMessageId", "backfillThroughSequence"
       FROM public.message_search_coverage
      WHERE "conversationId" = $1
// query: listRunnableMessageSearchBackfills.result
SELECT "conversationId", "backfillCursorMessageId"
       FROM public.message_search_coverage
      WHERE "backfillStartedAt" IS NOT NULL
        AND "backfillCompletedAt" IS NULL
        AND "backfillThroughSequence" IS NOT NULL
      ORDER BY "updatedAt" ASC
      LIMIT $1
// query: readNextMessageSearchBackfillBatch.coverage
SELECT "backfillCompletedAt", "backfillCursorCreatedAt",
            "backfillCursorMessageId", "backfillThroughSequence"
       FROM public.message_search_coverage
      WHERE "conversationId" = $1
        AND "backfillStartedAt" IS NOT NULL
// query: readNextMessageSearchBackfillBatch.messages
WITH candidates AS (
       SELECT id, "ciphertext", "createdAt", "deletedAt", "iv",
              "keyEpoch", "ratchetIndex", revision, "senderId",
              octet_length("ciphertext") AS "ciphertextBytes"
         FROM public.messages
        WHERE "conversationId" = $1
          AND "creationSequence" <= $2
          AND ($3::timestamp IS NULL OR ("createdAt", id) > ($3::timestamp, $4::text))
        ORDER BY "createdAt" ASC, id ASC
        LIMIT $5
     ), sized AS (
       SELECT *, SUM("ciphertextBytes") OVER (
         ORDER BY "createdAt" ASC, id ASC
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS "batchBytes"
         FROM candidates
     )
     SELECT id, "ciphertext", "createdAt", "deletedAt", "iv", "keyEpoch",
            "ratchetIndex", revision, "senderId"
       FROM sized
      WHERE "batchBytes" <= $6
      ORDER BY "createdAt" ASC, id ASC
// query: commitMessageSearchBackfillBatch.claimed
UPDATE public.message_search_coverage
          SET "backfillCursorCreatedAt" = $3,
              "backfillCursorMessageId" = $4,
              "backfillCompletedAt" = CASE WHEN $5 THEN now() ELSE NULL END,
              "updatedAt" = now()
        WHERE "conversationId" = $1
          AND "backfillThroughSequence" = $2
          AND "backfillCompletedAt" IS NULL
          AND "backfillCursorCreatedAt" IS NOT DISTINCT FROM $6::timestamp
          AND "backfillCursorMessageId" IS NOT DISTINCT FROM $7::text
        RETURNING "conversationId"
// query: commitMessageSearchBackfillBatch.deleteSearchGaps
DELETE FROM public.message_search_gaps AS gap
          USING unnest($2::text[], $3::int[]) AS resolved("messageId", revision)
          WHERE gap."conversationId" = $1
            AND gap."messageId" = resolved."messageId"
            AND gap.revision <= resolved.revision
// query: commitMessageSearchBackfillBatch.deleteSearchReferences
DELETE FROM public.message_search_references
            WHERE "conversationId" = $1 AND "messageId" = ANY($2::text[])
// query: commitMessageSearchBackfillBatch.documentTuplesFragment
(${{parameter1}}::text, ${{parameter2}}::text, ${{parameter3}}::int4, ${{parameter4}}::timestamp, ${{parameter5}}::int4[])
// query: commitMessageSearchBackfillBatch.epochTuplesFragment
(${{parameter1}}::text, ${{parameter2}}::int4, ${{parameter3}}::int4)
// query: commitMessageSearchBackfillBatch.gapTuplesFragment
(${{parameter1}}::text, ${{parameter2}}::text, ${{parameter3}}::int4, ${{parameter4}}::int4, ${{parameter5}}::bool)
// query: commitMessageSearchBackfillBatch.insertSearchDocuments
INSERT INTO public.message_search_documents
           ("messageId", "conversationId", revision, "createdAt", "termIds")
         VALUES {{documentTuples}}
         ON CONFLICT ("messageId") DO UPDATE
           SET "conversationId" = EXCLUDED."conversationId",
               revision = EXCLUDED.revision,
               "createdAt" = EXCLUDED."createdAt",
               "termIds" = EXCLUDED."termIds"
         WHERE public.message_search_documents.revision <= EXCLUDED.revision
// query: commitMessageSearchBackfillBatch.insertSearchGaps
INSERT INTO public.message_search_gaps
           ("conversationId", "messageId", revision, "keyEpoch", "unrecoverableEpoch")
         VALUES {{gapTuples}}
         ON CONFLICT ("conversationId", "messageId") DO UPDATE
           SET revision = EXCLUDED.revision,
               "keyEpoch" = EXCLUDED."keyEpoch",
               "unrecoverableEpoch" = EXCLUDED."unrecoverableEpoch"
         WHERE public.message_search_gaps.revision <= EXCLUDED.revision
// query: commitMessageSearchBackfillBatch.insertSearchReferences
INSERT INTO public.message_search_references
             ("messageId", "conversationId", kind, ordinal, "createdAt", revision, "mediaKind", "requiredId")
           VALUES {{referenceTuples}}
           ON CONFLICT ("messageId", kind, ordinal) DO UPDATE
             SET "conversationId" = EXCLUDED."conversationId",
                 "createdAt" = EXCLUDED."createdAt",
                 revision = EXCLUDED.revision,
                 "mediaKind" = EXCLUDED."mediaKind",
                 "requiredId" = EXCLUDED."requiredId"
           WHERE public.message_search_references.revision <= EXCLUDED.revision
// query: commitMessageSearchBackfillBatch.insertSearchTerms
INSERT INTO public.message_search_terms
           ("conversationId", normalized, "gramKeys")
         VALUES {{tuples}}
         ON CONFLICT ("conversationId", normalized) DO NOTHING
// query: commitMessageSearchBackfillBatch.referenceTuplesFragment
(${{parameter1}}, ${{parameter2}}, ${{parameter3}}, ${{parameter4}}, ${{parameter5}}, ${{parameter6}}, ${{parameter7}}, ${{parameter8}})
// query: commitMessageSearchBackfillBatch.sourceRows
SELECT id, revision, "deletedAt"
             FROM public.messages
            WHERE "conversationId" = $1 AND id = ANY($2::text[])
            FOR SHARE
// query: commitMessageSearchBackfillBatch.termRows
SELECT id, normalized
           FROM public.message_search_terms
          WHERE "conversationId" = $1 AND normalized = ANY($2::text[])
// query: commitMessageSearchBackfillBatch.tuplesFragment
(${{parameter1}}, ${{parameter2}}, ${{parameter3}}::text[])
// query: commitMessageSearchBackfillBatch.updateMessages
UPDATE public.messages AS message
            SET "keyEpoch" = candidate."keyEpoch"
           FROM (VALUES {{epochTuples}}) AS candidate(id, "keyEpoch", revision)
          WHERE message.id = candidate.id
            AND message."conversationId" = ${{conversationParameterIndex}}
            AND message.revision = candidate.revision
            AND message."keyEpoch" IS NULL
// query: commitMessageSearchBackfillBatch.updateSearchCoverage
UPDATE public.message_search_coverage
          SET "rowsTraversed" = "rowsTraversed" + $2,
              "artifactsCommitted" = "artifactsCommitted" + $3,
              "completedChangeSeq" = CASE WHEN $4
                THEN GREATEST(
                  "completedChangeSeq",
                  LEAST("backfillThroughSequence", COALESCE((
                    SELECT MIN("changeSequence") - 1
                      FROM public.message_search_outbox
                     WHERE "conversationId" = $1 AND "completedAt" IS NULL
                  ), "backfillThroughSequence"))
                )
                ELSE "completedChangeSeq"
              END,
              "updatedAt" = now()
        WHERE "conversationId" = $1
