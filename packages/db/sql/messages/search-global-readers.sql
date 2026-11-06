// query: searchGlobalMessageScope.result
SELECT conversation.id AS "conversationId",
       conversation."type" AS "conversationType",
       conversation.name AS "conversationName",
       conversation."avatarMediaId" AS "conversationAvatarMediaId",
       conversation."changeSeq" AS "snapshotSequence",
       conversation."membershipSeq" AS "membershipSequence",
       member."createdAt" AS "memberCreatedAt",
       member."leftAt" AS "memberLeftAt",
       member."clearedAt" AS "clearedAt",
       member."clearedThroughSequence" AS "clearedThroughSequence",
       peer."displayName" AS "peerName",
       peer.username AS "peerUsername",
       peer."avatarUrl" AS "peerAvatarUrl",
       COALESCE(
         coverage."backfillCompletedAt" IS NOT NULL
         AND coverage."completedChangeSeq" >= conversation."changeSeq"
         AND coverage."unrecoverableEpochs" = 0
         AND NOT coverage."hasUnreadableMessages"
         AND NOT EXISTS (
           SELECT 1
             FROM public.message_conversation_keys AS required_key
            WHERE required_key."conversationId" = conversation.id
              AND required_key."ownerUserId" = $2
              AND required_key.version NOT IN ({{readableEpochs}})
         ),
         false
       ) AS "coverageComplete"
  FROM public.message_conversation_members AS member
  JOIN public.message_conversations AS conversation
    ON conversation.id = member."conversationId"
  LEFT JOIN LATERAL (
    SELECT user_row."displayName", user_row.username, user_row."avatarUrl"
      FROM public.message_conversation_members AS peer_member
      JOIN public.users AS user_row ON user_row.id = peer_member."userId"
     WHERE peer_member."conversationId" = conversation.id
       AND peer_member."userId" <> $2
     ORDER BY peer_member."userId"
     LIMIT 1
  ) AS peer ON conversation."type" = 'DM'
  LEFT JOIN public.message_search_coverage AS coverage
    ON coverage."conversationId" = conversation.id
 WHERE member."userId" = $2
   AND ($1::text = 'ALL' OR conversation."type"::text = $1::text)
   AND (member."inboxHiddenAt" IS NULL OR member."inboxHiddenAt" < conversation."updatedAt")
   AND NOT (
     conversation."type" = 'DM'
     AND EXISTS (
       SELECT 1
         FROM public.message_conversation_members AS peer_member
         JOIN public.blocks AS block
           ON ((block."blockerId" = $2 AND block."blockedId" = peer_member."userId") OR
               (block."blockedId" = $2 AND block."blockerId" = peer_member."userId"))
        WHERE peer_member."conversationId" = conversation.id
          AND peer_member."userId" <> $2
     )
   )
 ORDER BY conversation.id
 LIMIT $3

// query: searchGlobalMessageCandidates.timeout
SET LOCAL statement_timeout = '8s'
// query: searchGlobalMessageCandidates.result
WITH search_scope AS MATERIALIZED (
       SELECT message."conversationId", message."snapshotSequence", message."membershipSequence",
              message.windows, ARRAY({{readableMessageKeyEpochs}}) AS readable_epochs
         FROM jsonb_to_recordset($1::jsonb) AS message(
           "conversationId" text, "snapshotSequence" integer, "membershipSequence" integer, windows jsonb
         )
         JOIN public.message_conversation_members AS current_member
           ON current_member."conversationId" = message."conversationId" AND current_member."userId" = $2
         JOIN public.message_conversations AS current_conversation
           ON current_conversation.id = message."conversationId"
          AND current_conversation."membershipSeq" = message."membershipSequence"
        WHERE (current_member."inboxHiddenAt" IS NULL OR current_member."inboxHiddenAt" < current_conversation."updatedAt")
          AND NOT EXISTS (
            SELECT 1 FROM public.message_conversation_members AS peer
            JOIN public.blocks AS block
              ON ((block."blockerId" = $2 AND block."blockedId" = peer."userId") OR
                  (block."blockedId" = $2 AND block."blockerId" = peer."userId"))
            WHERE peer."conversationId" = message."conversationId" AND peer."userId" <> $2
              AND current_conversation."type" = 'DM'
          )
     ),
     query_fragments AS MATERIALIZED (
       SELECT value, ordinality AS fragment_ordinal
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS fragment(value, ordinality)
     ),
     matching_terms AS MATERIALIZED (
       SELECT scope."conversationId",
              query.fragment_ordinal,
              ARRAY_AGG(term.id) AS term_ids,
              SUM(term."documentFrequency") AS estimated_documents
         FROM search_scope AS scope
         JOIN public.message_search_terms AS term
           ON term."conversationId" = scope."conversationId"
         JOIN query_fragments AS query
           ON term."gramKeys" @> ARRAY(
             SELECT jsonb_array_elements_text(query.value->'grams')
           )
          AND strpos(term.normalized, query.value->>'text') > 0
        WHERE cardinality(scope.readable_epochs) > 0
        GROUP BY scope."conversationId", query.fragment_ordinal
     ),
     seed_terms AS MATERIALIZED (
       SELECT DISTINCT ON ("conversationId") "conversationId", term_ids
         FROM matching_terms
        ORDER BY "conversationId", estimated_documents, fragment_ordinal
     ),
     candidate_documents AS MATERIALIZED (
       SELECT candidate.*
         FROM search_scope AS scope
         JOIN seed_terms AS seed ON seed."conversationId" = scope."conversationId"
         CROSS JOIN LATERAL (
           SELECT document."conversationId", document."messageId", document.revision,
                  document."createdAt", scope."snapshotSequence", scope."membershipSequence", scope.windows
             FROM (
               SELECT indexed_document.*
                 FROM public.message_search_documents AS indexed_document
                WHERE indexed_document."conversationId" = scope."conversationId"
                  AND cardinality(scope.readable_epochs) > 0
                  AND indexed_document."termIds" && seed.term_ids
                  AND (SELECT COUNT(*) FROM matching_terms AS matched
                        WHERE matched."conversationId" = scope."conversationId") =
                      (SELECT COUNT(*) FROM query_fragments)
                  AND NOT EXISTS (
                    SELECT 1 FROM matching_terms AS matched
                     WHERE matched."conversationId" = scope."conversationId"
                       AND NOT indexed_document."termIds" && matched.term_ids
                  )
                  AND ($4::timestamp IS NULL OR
                       (indexed_document."createdAt", indexed_document."messageId", indexed_document."conversationId") <
                       ($4::timestamp, $5::text, $6::text))
                ORDER BY indexed_document."createdAt" DESC, indexed_document."messageId" DESC
                OFFSET 0
             ) AS document
             CROSS JOIN LATERAL (
               SELECT message.id
                 FROM public.messages AS message
                 JOIN public.message_conversation_members AS member
                   ON member."conversationId" = message."conversationId" AND member."userId" = $2
                 JOIN public.message_conversations AS conversation ON conversation.id = message."conversationId"
                  WHERE message.id = document."messageId"
                    AND message."conversationId" = document."conversationId"
                    AND message.revision = document.revision
                    AND message."deletedAt" IS NULL
                    AND (message."expiresAt" IS NULL OR message."expiresAt" > clock_timestamp())
                    AND (member."inboxHiddenAt" IS NULL OR member."inboxHiddenAt" < conversation."updatedAt")
                    AND (message."creationSequence" > member."clearedThroughSequence" OR
                         (message."creationSequence" = 0 AND
                          (member."clearedAt" IS NULL OR message."createdAt" > member."clearedAt")))
                    AND message."keyEpoch" IS NOT NULL
                    AND message."creationSequence" <= scope."snapshotSequence"
                    AND conversation."membershipSeq" = scope."membershipSequence"
                    AND (scope."snapshotSequence" >= conversation."changeSeq" OR NOT EXISTS (
                          SELECT 1
                            FROM public.message_search_outbox AS newer_revision
                           WHERE newer_revision."messageId" = message.id
                             AND newer_revision."changeSequence" > scope."snapshotSequence"
                        ))
                    AND message."keyEpoch" = ANY(scope.readable_epochs)
                    AND NOT EXISTS (
                          SELECT 1
                            FROM public.message_hidden AS hidden
                           WHERE hidden."messageId" = message.id
                             AND hidden."userId" = $2
                        )
                    AND EXISTS (
                          SELECT 1
                            FROM jsonb_array_elements(scope.windows) AS membership_window
                           WHERE (membership_window.value->>'after' IS NULL OR
                                  message."createdAt" >= (membership_window.value->>'after')::timestamp)
                             AND (membership_window.value->>'before' IS NULL OR
                                  message."createdAt" <= (membership_window.value->>'before')::timestamp)
                        )
                    AND NOT EXISTS (
                          SELECT 1
                            FROM public.message_conversation_members AS peer
                            JOIN public.blocks AS block
                              ON ((block."blockerId" = $2 AND block."blockedId" = peer."userId") OR
                                  (block."blockedId" = $2 AND block."blockerId" = peer."userId"))
                           WHERE peer."conversationId" = document."conversationId"
                             AND peer."userId" <> $2
                        AND conversation."type" = 'DM'
                        )
                OFFSET 0
             ) AS eligible_message
            ORDER BY document."createdAt" DESC, document."messageId" DESC
            LIMIT $7
         ) AS candidate
        ORDER BY candidate."createdAt" DESC, candidate."messageId" DESC, candidate."conversationId" DESC
        LIMIT $7
     )
     SELECT message.id,
            message."conversationId",
            message."ciphertext",
            message."expiresAt",
            message.iv,
            message."keyEpoch",
            message."ratchetIndex",
            message.revision,
           message."senderId",
           message."createdAt",
           sender."displayName" AS "senderName",
           sender.username AS "senderUsername",
           own_key."encryptedKey" AS "rootKeyCiphertext",
           own_key.iv AS "rootKeyIv",
           COALESCE(
             own_key."wrapperPublicKey",
             wrapper_identity."publicKey",
             dm_peer_identity."publicKey"
           ) AS "rootKeyWrapperPublicKey",
           conversation."type" AS "conversationType",
            conversation.name AS "conversationName",
            conversation."avatarMediaId" AS "conversationAvatarMediaId",
            peer."displayName" AS "peerName",
            peer.username AS "peerUsername",
            peer."avatarUrl" AS "peerAvatarUrl"
       FROM candidate_documents AS document
       JOIN public.messages AS message
         ON message.id = document."messageId"
        AND message."conversationId" = document."conversationId"
        AND message.revision = document.revision
       JOIN public.message_conversation_members AS member
         ON member."conversationId" = document."conversationId"
        AND member."userId" = $2
       JOIN public.message_conversations AS conversation
         ON conversation.id = document."conversationId"
       JOIN public.users AS sender
         ON sender.id = message."senderId"
       LEFT JOIN public.message_conversation_keys AS own_key
         ON own_key."conversationId" = message."conversationId"
        AND own_key."ownerUserId" = $2
        AND own_key.version = message."keyEpoch"
       LEFT JOIN public.message_identities AS wrapper_identity
         ON wrapper_identity."userId" = own_key."wrapperUserId"
       LEFT JOIN LATERAL (
         SELECT identity."publicKey"
           FROM public.message_conversation_members AS peer_member
           JOIN public.message_identities AS identity
             ON identity."userId" = peer_member."userId"
          WHERE peer_member."conversationId" = message."conversationId"
            AND peer_member."userId" <> $2
           AND conversation."type" = 'DM'
          ORDER BY peer_member."userId"
          LIMIT 1
       ) AS dm_peer_identity ON true
       LEFT JOIN LATERAL (
         SELECT user_row."displayName", user_row.username, user_row."avatarUrl"
           FROM public.message_conversation_members AS peer_member
           JOIN public.users AS user_row ON user_row.id = peer_member."userId"
          WHERE peer_member."conversationId" = conversation.id
            AND peer_member."userId" <> $2
          ORDER BY peer_member."userId"
          LIMIT 1
       ) AS peer ON conversation."type" = 'DM'
      WHERE message."deletedAt" IS NULL
        AND (message."expiresAt" IS NULL OR message."expiresAt" > clock_timestamp())
        AND (member."inboxHiddenAt" IS NULL OR member."inboxHiddenAt" < conversation."updatedAt")
        AND (message."creationSequence" > member."clearedThroughSequence" OR
             (message."creationSequence" = 0 AND
              (member."clearedAt" IS NULL OR message."createdAt" > member."clearedAt")))
        AND message."keyEpoch" IS NOT NULL
        AND message."creationSequence" <= document."snapshotSequence"
        AND conversation."membershipSeq" = document."membershipSequence"
        AND NOT EXISTS (
              SELECT 1
                FROM public.message_search_outbox AS newer_revision
               WHERE newer_revision."messageId" = message.id
                 AND newer_revision."changeSequence" > document."snapshotSequence"
            )
        AND message."keyEpoch" IN ({{readableMessageKeyEpochs}})
        AND NOT EXISTS (
              SELECT 1
                FROM public.message_hidden AS hidden
               WHERE hidden."messageId" = message.id
                 AND hidden."userId" = $2
            )
        AND EXISTS (
              SELECT 1
                FROM jsonb_array_elements(document.windows) AS membership_window
               WHERE (membership_window.value->>'after' IS NULL OR
                      message."createdAt" >= (membership_window.value->>'after')::timestamp)
                 AND (membership_window.value->>'before' IS NULL OR
                      message."createdAt" <= (membership_window.value->>'before')::timestamp)
            )
        AND NOT EXISTS (
              SELECT 1
                FROM public.message_conversation_members AS peer
                JOIN public.blocks AS block
                  ON ((block."blockerId" = $2 AND block."blockedId" = peer."userId") OR
                      (block."blockedId" = $2 AND block."blockerId" = peer."userId"))
               WHERE peer."conversationId" = document."conversationId"
                 AND peer."userId" <> $2
            AND conversation."type" = 'DM'
            )
      ORDER BY document."createdAt" DESC, document."messageId" DESC, document."conversationId" DESC
      LIMIT $7

// query: ensureGlobalMessageSearchBackfills.result
INSERT INTO public.message_search_coverage
       ("conversationId", "backfillThroughSequence", "backfillStartedAt", "updatedAt")
     SELECT conversation.id, conversation."changeSeq", now(), now()
       FROM public.message_conversations AS conversation
       JOIN jsonb_array_elements_text($1::jsonb) AS requested(id)
         ON requested.id = conversation.id
      WHERE NOT EXISTS (
        SELECT 1
          FROM public.message_search_coverage AS coverage
         WHERE coverage."conversationId" = conversation.id
      )
     ON CONFLICT ("conversationId") DO NOTHING
     RETURNING "conversationId"
