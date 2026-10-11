// query: rawRuntime.selectBindings
SELECT $3::int AS count, $4::boolean AS enabled, $5::jsonb AS payload,
              $1::timestamp AS stamp, $2::timestamp AS "missingStamp",
              to_jsonb($6::int[]) AS ids, to_jsonb($7::text[]) AS labels, $3::int AS repeated
// query: rawRuntime.insertUser
INSERT INTO public.users (id, email, username, "displayName") VALUES ($1, $2, $1, $1)
// query: rawRuntime.updateUser
UPDATE public.users SET "displayName" = $2 WHERE id = $1
// query: rawRuntime.lockUser
SELECT "displayName" FROM public.users WHERE id = $1 FOR SHARE
// query: rawRuntime.setIsolation
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY
// query: rawRuntime.selectSettings
SELECT current_setting('transaction_isolation') AS isolation,
                current_setting('transaction_read_only') AS "readOnly"
// query: scaleSeedConversation.analyzeDocuments
ANALYZE public.message_search_documents
// query: scaleReadSearchIndexStorageSnapshot.indexBytes

      SELECT COALESCE(SUM(pg_indexes_size(table_rel.oid)), 0)::text AS "indexBytes"
      FROM pg_class AS table_rel
      JOIN pg_namespace AS namespace ON namespace.oid = table_rel.relnamespace
      WHERE namespace.nspname = 'public'
        AND table_rel.relkind = 'r'
        AND table_rel.relname = ANY($1::text[])

// query: scaleReadSearchIndexStorageSnapshot.walBytes

      SELECT wal_bytes::text AS "walBytes"
      FROM pg_stat_wal

// query: scaleReadFreshSearchIndexFootprint.createDmSearchScaleDocuments
CREATE TEMP TABLE dm_search_scale_documents ON COMMIT DROP AS
       SELECT "messageId", "conversationId", "createdAt", "termIds"
       FROM public.message_search_documents
       WHERE "conversationId" = ANY($1::text[])
// query: scaleReadFreshSearchIndexFootprint.createDmSearchScaleDocumentsPkey
CREATE UNIQUE INDEX dm_search_scale_documents_pkey
       ON dm_search_scale_documents ("messageId")
// query: scaleReadFreshSearchIndexFootprint.createDmSearchScaleDocumentsConversationCreatedIdx
CREATE INDEX dm_search_scale_documents_conversation_created_idx
       ON dm_search_scale_documents ("conversationId", "createdAt", "messageId")
// query: scaleReadFreshSearchIndexFootprint.createDmSearchScaleDocumentsTermIdsIdx
CREATE INDEX dm_search_scale_documents_term_ids_idx
       ON dm_search_scale_documents USING gin ("termIds")
// query: scaleReadFreshSearchIndexFootprint.createDmSearchScaleTerms
CREATE TEMP TABLE dm_search_scale_terms ON COMMIT DROP AS
       SELECT "id", "conversationId", "normalized", "gramKeys", "documentFrequency"
       FROM public.message_search_terms
       WHERE "conversationId" = ANY($1::text[])
// query: scaleReadFreshSearchIndexFootprint.createDmSearchScaleTermsPkey
CREATE UNIQUE INDEX dm_search_scale_terms_pkey
       ON dm_search_scale_terms ("id")
// query: scaleReadFreshSearchIndexFootprint.createDmSearchScaleTermsConversationNormalizedIdx
CREATE UNIQUE INDEX dm_search_scale_terms_conversation_normalized_idx
       ON dm_search_scale_terms ("conversationId", "normalized")
// query: scaleReadFreshSearchIndexFootprint.createDmSearchScaleTermsConversationIdIdx
CREATE INDEX dm_search_scale_terms_conversation_id_idx
       ON dm_search_scale_terms ("conversationId", "id")
// query: scaleReadFreshSearchIndexFootprint.createDmSearchScaleTermsOrphanedIdx
CREATE INDEX dm_search_scale_terms_orphaned_idx
       ON dm_search_scale_terms ("conversationId")
       WHERE "documentFrequency" = 0
// query: scaleReadFreshSearchIndexFootprint.createDmSearchScaleTermsGramKeysIdx
CREATE INDEX dm_search_scale_terms_gram_keys_idx
       ON dm_search_scale_terms USING gin ("gramKeys")
// query: scaleReadFreshSearchIndexFootprint.createDmSearchScaleReferences
CREATE TEMP TABLE dm_search_scale_references ON COMMIT DROP AS
       SELECT "messageId", "conversationId", "kind", "ordinal", "createdAt"
       FROM public.message_search_references
       WHERE "conversationId" = ANY($1::text[])
// query: scaleReadFreshSearchIndexFootprint.createDmSearchScaleReferencesPkey
CREATE UNIQUE INDEX dm_search_scale_references_pkey
       ON dm_search_scale_references ("messageId", "kind", "ordinal")
// query: scaleReadFreshSearchIndexFootprint.createDmSearchScaleReferencesConversationKindCreatedIdx
CREATE INDEX dm_search_scale_references_conversation_kind_created_idx
       ON dm_search_scale_references ("conversationId", "kind", "createdAt", "messageId", "ordinal")
// query: scaleReadFreshSearchIndexFootprint.indexSizes
SELECT
           pg_indexes_size('dm_search_scale_documents'::regclass)::text AS "documentIndexBytes",
           pg_indexes_size('dm_search_scale_terms'::regclass)::text AS "termIndexBytes",
           pg_indexes_size('dm_search_scale_references'::regclass)::text AS "referenceIndexBytes"
// query: scaleReadFreshSearchIndexFootprint.documentStats
SELECT
           COUNT(*)::text AS "documentCount",
           COALESCE(AVG(CARDINALITY("termIds")), 0)::text AS "meanTermsPerDocument"
         FROM dm_search_scale_documents
// query: notifications.selectWholeRow
SELECT to_jsonb(notifications) AS row FROM notifications WHERE id = $1
// query: readSequence.advanceSequence
UPDATE public.message_conversations
            SET "changeSeq" = "changeSeq" + 1
          WHERE id = $1
          RETURNING "changeSeq"
// query: readSequence.incrementUnread
UPDATE public.message_conversation_members
            SET "unreadCount" = "unreadCount" + 1
          WHERE "conversationId" = $1
            AND "userId" = $2
            AND "leftAt" IS NULL
            AND "mutedAt" IS NULL
            AND "unreadCount" IS NOT NULL
