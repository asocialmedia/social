// query: persistSearchDocument.coverage
SELECT MAX("changeSequence") AS "maxSequence",
                MIN("changeSequence") FILTER (WHERE "completedAt" IS NULL) AS "pendingSequence"
           FROM public.message_search_outbox
          WHERE "conversationId" = $1
// query: persistSearchDocument.deleteSearchDocuments
DELETE FROM public.message_search_documents
          WHERE "messageId" = $1 AND revision <= $2
// query: persistSearchDocument.deleteSearchGaps
DELETE FROM public.message_search_gaps
          WHERE "conversationId" = $1 AND "messageId" = $2 AND revision <= $3
// query: persistSearchDocument.deleteSearchGaps2
DELETE FROM public.message_search_gaps
            WHERE "conversationId" = $1 AND "messageId" = $2 AND revision <= $3
// query: persistSearchDocument.deleteSearchReferences
DELETE FROM public.message_search_references
          WHERE "messageId" = $1 AND revision <= $2
// query: persistSearchDocument.deleteSearchReferences2
DELETE FROM public.message_search_references
          WHERE "messageId" = $1 AND revision <= $2
// query: persistSearchDocument.deleteSearchTerms
DELETE FROM public.message_search_terms
            WHERE "conversationId" = $1 AND "documentFrequency" = 0
// query: persistSearchDocument.insertSearchDocuments
INSERT INTO public.message_search_documents
           ("messageId", "conversationId", revision, "createdAt", "termIds")
         VALUES ($1, $2, $3, $4, $5::int[])
         ON CONFLICT ("messageId") DO UPDATE
           SET "conversationId" = EXCLUDED."conversationId",
               revision = EXCLUDED.revision,
               "createdAt" = EXCLUDED."createdAt",
               "termIds" = EXCLUDED."termIds"
         WHERE public.message_search_documents.revision <= EXCLUDED.revision
// query: persistSearchDocument.insertSearchReferences
INSERT INTO public.message_search_references
             ("messageId", "conversationId", kind, ordinal, "createdAt", revision, "mediaKind", "requiredId")
           VALUES {{tuples}}
           ON CONFLICT ("messageId", kind, ordinal) DO UPDATE
             SET "conversationId" = EXCLUDED."conversationId",
                 "createdAt" = EXCLUDED."createdAt",
                 revision = EXCLUDED.revision,
                 "mediaKind" = EXCLUDED."mediaKind",
                 "requiredId" = EXCLUDED."requiredId"
           WHERE public.message_search_references.revision <= EXCLUDED.revision
// query: persistSearchDocument.insertSearchTerms
INSERT INTO public.message_search_terms
             ("conversationId", normalized, "gramKeys")
           VALUES {{tuples}}
           ON CONFLICT ("conversationId", normalized) DO NOTHING
// query: persistSearchDocument.outbox
UPDATE public.message_search_outbox
          SET "completedAt" = now()
        WHERE id = $1 AND revision = $2 AND "completedAt" IS NULL
        RETURNING "changeSequence", "conversationId"
// query: persistSearchDocument.source
SELECT "createdAt", "deletedAt", revision
         FROM public.messages
        WHERE id = $1 AND "conversationId" = $2
        FOR SHARE
// query: persistSearchDocument.termRows
SELECT id
               FROM public.message_search_terms
              WHERE "conversationId" = $1 AND normalized = ANY($2::text[])
// query: persistSearchDocument.tuplesFragment
(${{parameter1}}, ${{parameter2}}, ${{parameter3}}::text[])
// query: persistSearchDocument.tuplesFragment2
(${{parameter1}}, ${{parameter2}}, ${{parameter3}}, ${{parameter4}}, ${{parameter5}}, ${{parameter6}}, ${{parameter7}}, ${{parameter8}})
// query: persistSearchDocument.updateMessages
UPDATE public.messages
            SET "keyEpoch" = $2
          WHERE id = $1 AND revision = $3 AND "keyEpoch" IS NULL
// query: persistSearchDocument.updatedCoverage
UPDATE public.message_search_coverage
            SET "artifactsCommitted" = "artifactsCommitted" + $2,
                "completedChangeSeq" = GREATEST("completedChangeSeq", $3),
                "updatedAt" = now()
          WHERE "conversationId" = $1
