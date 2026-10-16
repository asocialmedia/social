// query: prebuild.prebuildConversationKeysIndexSql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_conversation_keys_conversationId_ownerUserId_idx" ON "message_conversation_keys" ("conversationId", "ownerUserId")

// query: prebuild.prebuildConversationShortCodeIndexSql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "message_conversations_inviteShortCode_key" ON "message_conversations" ("inviteShortCode")

// query: prebuild.indexExistsSql
SELECT (to_regclass($1)) IS NOT NULL AS "result"

// query: prebuild.indexColumnsExistSql
SELECT COUNT(*)::int = jsonb_array_length($2::jsonb) AS "result"
  FROM pg_attribute
 WHERE attrelid = to_regclass($1)
   AND attnum > 0
   AND NOT attisdropped
   AND attname IN (SELECT jsonb_array_elements_text($2::jsonb))

// query: prebuild.invalidIndexesSql
SELECT c.relname AS "indexname"
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indexrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE NOT i.indisvalid
            AND n.nspname = 'public'

// query: prebuild.prebuildMessageHistoryIndexSql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_conversationId_id_idx" ON "messages" ("conversationId", "id")

// query: prebuild.prebuildSearchOrphanTermsIndexSql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_search_terms_orphaned_f61e9e26" ON "message_search_terms" ("conversationId") WHERE (("documentFrequency" = 0))

// query: prebuild.prebuildSearchOutboxIndexSql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_search_outbox_message_sequence_idx" ON "message_search_outbox" ("messageId", "changeSequence")
