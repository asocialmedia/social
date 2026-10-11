// query: searchMessageCandidates.isolation
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY
// query: searchMessageCandidates.query
WITH query_fragments AS MATERIALIZED (
       SELECT value, ordinality AS fragment_ordinal
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS fragment(value, ordinality)
     ),
     matching_terms AS MATERIALIZED (
       SELECT query.fragment_ordinal,
              ARRAY_AGG(term.id) AS term_ids
         FROM query_fragments AS query
         JOIN public.message_search_terms AS term
           ON term."conversationId" = $1
          AND term."gramKeys" @> ARRAY(
            SELECT jsonb_array_elements_text(query.value->'grams')
          )
          AND strpos(term.normalized, query.value->>'text') > 0
        GROUP BY query.fragment_ordinal
     )
     SELECT m.id,
            m."ciphertext",
            m.iv,
            m."ratchetIndex",
            m."senderId",
            m."createdAt",
            m.revision,
            m."keyEpoch"
       FROM public.message_search_documents AS d
       JOIN public.messages AS m
         ON m.id = d."messageId"
        AND m."conversationId" = d."conversationId"
        AND m.revision = d.revision
       JOIN public.message_conversation_members AS member
         ON member."conversationId" = d."conversationId"
        AND member."userId" = $2
      WHERE d."conversationId" = $1
        AND m."deletedAt" IS NULL
        AND m."keyEpoch" IS NOT NULL
        AND m."creationSequence" <= $4
        AND (
          $4 >= (SELECT "changeSeq" FROM public.message_conversations WHERE id = $1)
          OR NOT EXISTS (
            SELECT 1
              FROM public.message_search_outbox AS newer_revision
             WHERE newer_revision."messageId" = m.id
               AND newer_revision."changeSequence" > $4
          )
        )
        AND m."keyEpoch" IN ({{readableEpochs}})
        AND NOT EXISTS (
          SELECT 1
            FROM public.message_hidden AS hidden
           WHERE hidden."messageId" = m.id AND hidden."userId" = $2
        )
        AND (SELECT COUNT(*) FROM matching_terms) =
            (SELECT COUNT(*) FROM query_fragments)
        AND NOT EXISTS (
          SELECT 1
            FROM matching_terms AS matched_term
           WHERE NOT d."termIds" && matched_term.term_ids
        )
        AND (
          $7::jsonb IS NULL OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements($7::jsonb) AS membership_window
             WHERE (membership_window.value->>'after' IS NULL OR m."createdAt" >= (membership_window.value->>'after')::timestamp)
               AND (membership_window.value->>'before' IS NULL OR m."createdAt" <= (membership_window.value->>'before')::timestamp)
          )
        )
        AND (
          $5::timestamp IS NULL OR
          (d."createdAt", d."messageId") {{cursorComparison}} ($5::timestamp, $6::text)
        )
      ORDER BY d."createdAt" {{sortDirection}}, d."messageId" {{sortDirection}}
      LIMIT $8
// query: searchMessageCandidatesSelective.query
WITH query_fragments AS MATERIALIZED (
       SELECT value, ordinality AS fragment_ordinal
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS fragment(value, ordinality)
     ),
     matching_terms AS MATERIALIZED (
       SELECT query.fragment_ordinal,
              ARRAY_AGG(term.id) AS term_ids
         FROM query_fragments AS query
         JOIN public.message_search_terms AS term
           ON term."conversationId" = $1
          AND term."gramKeys" @> ARRAY(
            SELECT jsonb_array_elements_text(query.value->'grams')
          )
          AND strpos(term.normalized, query.value->>'text') > 0
        GROUP BY query.fragment_ordinal
     ),
     candidate_documents AS MATERIALIZED (
       SELECT d."conversationId",
              d."messageId",
              d.revision,
              d."createdAt"
         FROM public.message_search_documents AS d
        WHERE d."conversationId" = $1
          AND d."termIds" && $9::int[]
          AND (
            $4 >= (SELECT "changeSeq" FROM public.message_conversations WHERE id = $1)
            OR NOT EXISTS (
              SELECT 1
                FROM public.message_search_outbox AS newer_revision
               WHERE newer_revision."messageId" = d."messageId"
                 AND newer_revision."changeSequence" > $4
            )
          )
          AND (SELECT COUNT(*) FROM matching_terms) =
              (SELECT COUNT(*) FROM query_fragments)
          AND NOT EXISTS (
            SELECT 1
              FROM matching_terms AS matched_term
             WHERE NOT d."termIds" && matched_term.term_ids
          )
          AND (
            $5::timestamp IS NULL OR
            (d."createdAt", d."messageId") {{cursorComparison}} ($5::timestamp, $6::text)
          )
     )
     SELECT m.id,
            m."ciphertext",
            m.iv,
            m."ratchetIndex",
            m."senderId",
            m."createdAt",
            m.revision,
            m."keyEpoch"
       FROM candidate_documents AS d
       JOIN public.messages AS m
         ON m.id = d."messageId"
        AND m."conversationId" = d."conversationId"
        AND m.revision = d.revision
       JOIN public.message_conversation_members AS member
         ON member."conversationId" = d."conversationId"
        AND member."userId" = $2
      WHERE m."deletedAt" IS NULL
        AND m."keyEpoch" IS NOT NULL
        AND m."creationSequence" <= $4
        AND m."keyEpoch" IN ({{readableEpochs}})
        AND NOT EXISTS (
          SELECT 1
            FROM public.message_hidden AS hidden
           WHERE hidden."messageId" = m.id AND hidden."userId" = $2
        )
        AND (
          $7::jsonb IS NULL OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements($7::jsonb) AS membership_window
             WHERE (membership_window.value->>'after' IS NULL OR m."createdAt" >= (membership_window.value->>'after')::timestamp)
               AND (membership_window.value->>'before' IS NULL OR m."createdAt" <= (membership_window.value->>'before')::timestamp)
          )
        )
      ORDER BY d."createdAt" {{sortDirection}}, d."messageId" {{sortDirection}}
      LIMIT $8
// query: searchMessageCount.query
WITH query_fragments AS MATERIALIZED (
       SELECT value, ordinality AS fragment_ordinal
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS fragment(value, ordinality)
     ),
     matching_terms AS MATERIALIZED (
       SELECT query.fragment_ordinal,
              ARRAY_AGG(term.id) AS term_ids
         FROM query_fragments AS query
         JOIN public.message_search_terms AS term
           ON term."conversationId" = $1
          AND term."gramKeys" @> ARRAY(
            SELECT jsonb_array_elements_text(query.value->'grams')
          )
          AND strpos(term.normalized, query.value->>'text') > 0
        GROUP BY query.fragment_ordinal
     )
     SELECT COUNT(*)::text AS count
       FROM public.message_search_documents AS d
       JOIN public.messages AS m
         ON m.id = d."messageId"
        AND m."conversationId" = d."conversationId"
        AND m.revision = d.revision
       JOIN public.message_conversation_members AS member
         ON member."conversationId" = d."conversationId"
        AND member."userId" = $2
      WHERE d."conversationId" = $1
        AND d."termIds" && $6::int[]
        AND (SELECT COUNT(*) FROM matching_terms) =
            (SELECT COUNT(*) FROM query_fragments)
        AND NOT EXISTS (
          SELECT 1
            FROM matching_terms AS matched_term
           WHERE NOT d."termIds" && matched_term.term_ids
        )
        AND m."deletedAt" IS NULL
        AND m."keyEpoch" IS NOT NULL
        AND m."creationSequence" <= $4
        AND (
          $4 >= (SELECT "changeSeq" FROM public.message_conversations WHERE id = $1)
          OR NOT EXISTS (
            SELECT 1
              FROM public.message_search_outbox AS newer_revision
             WHERE newer_revision."messageId" = m.id
               AND newer_revision."changeSequence" > $4
          )
        )
        AND m."keyEpoch" IN ({{readableEpochs}})
        AND NOT EXISTS (
          SELECT 1
            FROM public.message_hidden AS hidden
           WHERE hidden."messageId" = m.id AND hidden."userId" = $2
        )
        AND (
          $5::jsonb IS NULL OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements($5::jsonb) AS membership_window
             WHERE (membership_window.value->>'after' IS NULL OR m."createdAt" >= (membership_window.value->>'after')::timestamp)
               AND (membership_window.value->>'before' IS NULL OR m."createdAt" <= (membership_window.value->>'before')::timestamp)
          )
        )
// query: searchOrderedCandidateHits.query
WITH query_fragments AS MATERIALIZED (
       SELECT value, ordinality AS fragment_ordinal
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS fragment(value, ordinality)
     ),
     matching_terms AS MATERIALIZED (
       SELECT query.fragment_ordinal,
              ARRAY_AGG(term.id) AS term_ids
         FROM query_fragments AS query
         JOIN public.message_search_terms AS term
           ON term."conversationId" = $1
          AND term."gramKeys" @> ARRAY(
            SELECT jsonb_array_elements_text(query.value->'grams')
          )
          AND strpos(term.normalized, query.value->>'text') > 0
        GROUP BY query.fragment_ordinal
     ),
     candidate_documents AS MATERIALIZED (
       SELECT d."conversationId",
              d."messageId",
              d.revision,
              d."createdAt"
         FROM public.message_search_documents AS d
        WHERE d."conversationId" = $1
          AND d."messageId" = ANY($9::text[])
          AND (
            $4 >= (SELECT "changeSeq" FROM public.message_conversations WHERE id = $1)
            OR NOT EXISTS (
              SELECT 1
                FROM public.message_search_outbox AS newer_revision
               WHERE newer_revision."messageId" = d."messageId"
                 AND newer_revision."changeSequence" > $4
            )
          )
          AND (SELECT COUNT(*) FROM matching_terms) =
              (SELECT COUNT(*) FROM query_fragments)
          AND NOT EXISTS (
            SELECT 1
              FROM matching_terms AS matched_term
             WHERE NOT d."termIds" && matched_term.term_ids
          )
          AND (
            $5::timestamp IS NULL OR
            (d."createdAt", d."messageId") {{cursorComparison}} ($5::timestamp, $6::text)
          )
     )
     SELECT m.id,
            m."ciphertext",
            m.iv,
            m."ratchetIndex",
            m."senderId",
            m."createdAt",
            m.revision,
            m."keyEpoch"
       FROM candidate_documents AS d
       JOIN public.messages AS m
         ON m.id = d."messageId"
        AND m."conversationId" = d."conversationId"
        AND m.revision = d.revision
       JOIN public.message_conversation_members AS member
         ON member."conversationId" = d."conversationId"
        AND member."userId" = $2
      WHERE m."deletedAt" IS NULL
        AND m."keyEpoch" IS NOT NULL
        AND m."creationSequence" <= $4
        AND m."keyEpoch" IN ({{readableEpochs}})
        AND NOT EXISTS (
          SELECT 1
            FROM public.message_hidden AS hidden
           WHERE hidden."messageId" = m.id AND hidden."userId" = $2
        )
        AND (
          $7::jsonb IS NULL OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements($7::jsonb) AS membership_window
             WHERE (membership_window.value->>'after' IS NULL OR m."createdAt" >= (membership_window.value->>'after')::timestamp)
               AND (membership_window.value->>'before' IS NULL OR m."createdAt" <= (membership_window.value->>'before')::timestamp)
          )
        )
      ORDER BY d."createdAt" {{sortDirection}}, d."messageId" {{sortDirection}}
      LIMIT $8
// query: searchOrderedDocumentPage.query
WITH ordered_documents AS MATERIALIZED (
       SELECT d."conversationId",
              d."createdAt",
              d."messageId",
              d.revision
         FROM public.message_search_documents AS d
        WHERE d."conversationId" = $1
          AND (
            $2::timestamp IS NULL OR
            (d."createdAt", d."messageId") {{cursorComparison}} ($2::timestamp, $3::text)
          )
        ORDER BY d."createdAt" {{sortDirection}}, d."messageId" {{sortDirection}}
        LIMIT $4
     ),
     scan_state AS (
       SELECT COUNT(*)::int AS "scannedCount",
              (ARRAY_AGG("createdAt" ORDER BY "createdAt" {{sortDirectionNext}}, "messageId" {{sortDirectionNext}}))[1] AS "scannedThroughCreatedAt",
              (ARRAY_AGG("messageId" ORDER BY "createdAt" {{sortDirectionNext}}, "messageId" {{sortDirectionNext}}))[1] AS "scannedThroughMessageId"
         FROM ordered_documents
     ),
     authorized_documents AS (
       SELECT d."createdAt",
              d."messageId"
         FROM ordered_documents AS d
         JOIN public.messages AS m
           ON m.id = d."messageId"
          AND m."conversationId" = d."conversationId"
          AND m.revision = d.revision
         JOIN public.message_conversation_members AS member
           ON member."conversationId" = d."conversationId"
          AND member."userId" = $5
        WHERE m."deletedAt" IS NULL
          AND m."keyEpoch" IS NOT NULL
          AND m."creationSequence" <= $6
          AND (
            $6 >= (SELECT "changeSeq" FROM public.message_conversations WHERE id = $1)
            OR NOT EXISTS (
              SELECT 1
                FROM public.message_search_outbox AS newer_revision
               WHERE newer_revision."messageId" = m.id
                 AND newer_revision."changeSequence" > $6
            )
          )
          AND m."keyEpoch" IN ({{readableEpochs}})
          AND NOT EXISTS (
            SELECT 1
              FROM public.message_hidden AS hidden
             WHERE hidden."messageId" = m.id AND hidden."userId" = $5
          )
          AND (
            $7::jsonb IS NULL OR EXISTS (
              SELECT 1
                FROM jsonb_array_elements($7::jsonb) AS membership_window
               WHERE (membership_window.value->>'after' IS NULL OR m."createdAt" >= (membership_window.value->>'after')::timestamp)
                 AND (membership_window.value->>'before' IS NULL OR m."createdAt" <= (membership_window.value->>'before')::timestamp)
            )
          )
     )
     SELECT authorized."createdAt",
            authorized."messageId",
            scan_state."scannedCount",
            scan_state."scannedThroughCreatedAt",
            scan_state."scannedThroughMessageId"
       FROM scan_state
       LEFT JOIN authorized_documents AS authorized ON true
      WHERE scan_state."scannedCount" > 0
      ORDER BY authorized."createdAt" {{sortDirection}}, authorized."messageId" {{sortDirection}}
// query: countMessageSearchCandidates.isolation
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY
// query: countMessageSearchCandidates.timeout
SET LOCAL statement_timeout = '120s'
// query: hydrateSearchMessageCandidates.result
WITH requested AS (
       SELECT value->>'id' AS id,
              (value->>'revision')::integer AS revision,
              ordinal
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS request(value, ordinal)
     )
     SELECT m.id,
            m."ciphertext",
            m."createdAt",
            m.iv,
            m."keyEpoch",
            m."ratchetIndex",
            m.revision,
            m."senderId"
       FROM requested AS request
       JOIN public.messages AS m
         ON m.id = request.id
        AND m.revision = request.revision
        AND m."conversationId" = $1
       JOIN public.message_conversation_members AS member
         ON member."conversationId" = m."conversationId"
        AND member."userId" = $2
      WHERE m."deletedAt" IS NULL
        AND m."keyEpoch" IS NOT NULL
        AND m."keyEpoch" IN ({{readableEpochs}})
        AND NOT EXISTS (
          SELECT 1
            FROM public.message_hidden AS hidden
           WHERE hidden."messageId" = m.id AND hidden."userId" = $2
        )
        AND (
          $4::jsonb IS NULL OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements($4::jsonb) AS membership_window
             WHERE (membership_window.value->>'after' IS NULL OR m."createdAt" >= (membership_window.value->>'after')::timestamp)
               AND (membership_window.value->>'before' IS NULL OR m."createdAt" <= (membership_window.value->>'before')::timestamp)
          )
        )
      ORDER BY request.ordinal
// query: listMessageSearchReferences.cursorConditionFragment
(
          (reference."createdAt", reference."messageId") > ($5::timestamp, $6::text) OR
          (reference."createdAt", reference."messageId") = ($5::timestamp, $6::text)
            AND reference.ordinal < $7
        )
// query: listMessageSearchReferences.cursorConditionFragment2
(
          (reference."createdAt", reference."messageId") < ($5::timestamp, $6::text) OR
          (reference."createdAt", reference."messageId") = ($5::timestamp, $6::text)
            AND reference.ordinal > $7
        )
// query: listMessageSearchReferences.orderingFragment
reference."createdAt" ASC, reference."messageId" ASC, reference.ordinal DESC
// query: listMessageSearchReferences.orderingFragment2
reference."createdAt" DESC, reference."messageId" DESC, reference.ordinal ASC
// query: listMessageSearchReferences.result
SELECT reference."createdAt",
            reference."messageId",
            reference.ordinal,
            reference.revision,
            reference."mediaKind",
            reference."requiredId",
            message."keyEpoch",
            message."ratchetIndex",
            message."senderId"
       FROM public.message_search_references AS reference
       JOIN public.messages AS message
         ON message.id = reference."messageId"
        AND message."conversationId" = reference."conversationId"
        AND message.revision = reference.revision
       JOIN public.message_search_documents AS document
         ON document."messageId" = message.id
        AND document."conversationId" = message."conversationId"
        AND document.revision = message.revision
       JOIN public.message_conversation_members AS member
         ON member."conversationId" = message."conversationId"
        AND member."userId" = $2
      WHERE reference."conversationId" = $1
        AND reference.kind = $3
        AND message."deletedAt" IS NULL
        AND message."keyEpoch" IS NOT NULL
        AND message."creationSequence" <= $4
        AND (
          $4 >= (SELECT "changeSeq" FROM public.message_conversations WHERE id = $1)
          OR NOT EXISTS (
            SELECT 1
              FROM public.message_search_outbox AS newer_revision
             WHERE newer_revision."messageId" = message.id
               AND newer_revision."changeSequence" > $4
          )
        )
        AND message."keyEpoch" IN ({{readableEpochs}})
        AND NOT EXISTS (
          SELECT 1
            FROM public.message_hidden AS hidden
           WHERE hidden."messageId" = message.id AND hidden."userId" = $2
        )
        AND (
          $8::jsonb IS NULL OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements($8::jsonb) AS membership_window
             WHERE (membership_window.value->>'after' IS NULL OR message."createdAt" >= (membership_window.value->>'after')::timestamp)
               AND (membership_window.value->>'before' IS NULL OR message."createdAt" <= (membership_window.value->>'before')::timestamp)
          )
        )
        AND ($5::timestamp IS NULL OR {{cursorCondition}})
      ORDER BY {{ordering}}
      LIMIT $9
// query: explainSearchMessageCandidatesForDiagnostics.result
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {{sql}}
// query: fragmentFrequency.query
WITH query_fragments AS MATERIALIZED (
       SELECT value, ordinality AS fragment_ordinal
         FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS fragment(value, ordinality)
     ),
     fragment_terms AS (
       SELECT query.fragment_ordinal,
              term.id,
              term."documentFrequency"
         FROM query_fragments AS query
         LEFT JOIN public.message_search_terms AS term
           ON term."conversationId" = $1
          AND term."gramKeys" @> ARRAY(
            SELECT jsonb_array_elements_text(query.value->'grams')
          )
          AND strpos(term.normalized, query.value->>'text') > 0
     )
     SELECT query.fragment_ordinal::int AS "fragmentOrdinal",
            COALESCE(SUM(fragment_terms."documentFrequency"), 0)::text AS "candidateCount",
            to_jsonb(COALESCE(
              ARRAY_AGG(fragment_terms.id) FILTER (WHERE fragment_terms.id IS NOT NULL),
              ARRAY[]::int[]
            )) AS "termIds"
       FROM query_fragments AS query
       LEFT JOIN fragment_terms
         ON fragment_terms.fragment_ordinal = query.fragment_ordinal
      GROUP BY query.fragment_ordinal
      ORDER BY COALESCE(SUM(fragment_terms."documentFrequency"), 0) ASC,
               query.fragment_ordinal ASC
      LIMIT 1
