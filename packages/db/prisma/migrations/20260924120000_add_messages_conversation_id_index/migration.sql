-- Composite index for message history reads: (conversationId, id).
--
-- Every thread read filters on `conversationId` and orders by `id`, because the
-- cursor is a message id and cuid2 ids are time-ordered. The pre-existing
-- (conversationId, createdAt) index cannot serve that: Postgres cannot use it
-- for an `id` range scan, so the planner fell back to walking the primary key
-- backwards and filtering on conversationId, discarding every row that belonged
-- to a different conversation. The cost scales with how diluted a conversation
-- is in the table, which is worst for the small DMs that dominate real usage.
--
-- Measured on a 2M-row table (one 200k-message DM, one 5k DM, 20k small DMs):
--
--   open a 5k DM, first page      44.0ms  ->  1.9ms
--   page a 5k DM, per page       178.4ms  ->  0.64ms
--   page that DM, all 50 pages     8.9s   ->  0.03s
--   page a 200k DM, per page       2.2ms  ->  1.04ms
--   page that DM, 2000 pages       4.4s   ->  2.08s
--
-- Also serves the anchored `?around=` jump that message search uses, so a
-- search result can load a window around any historical message without paging
-- from the newest row.
--
-- CONCURRENTLY so the build does not take a write lock on `messages`. A plain
-- CREATE INDEX would block writes for the duration of the build on a large
-- table. IF NOT EXISTS keeps the migration re-runnable on a partially applied
-- database.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_conversationId_id_idx"
  ON "messages" ("conversationId", "id");

-- Keep planner statistics fresh so the new index is actually chosen over the
-- primary-key scan. Without this the planner may keep preferring the old plan
-- until the next autovacuum/autoanalyze cycle.
ANALYZE "messages";
