// query: requestMessageSearchCount.advisoryLock
SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
// query: requestMessageSearchCount.cancelOtherRequests
UPDATE public.message_search_count_requests
            SET state = 'cancelled', fragments = NULL, "membershipWindows" = NULL,
                "leaseUntil" = NULL, "completedAt" = now(), "updatedAt" = now()
          WHERE "userId" = $1 AND "conversationId" = $2
            AND id <> $3 AND state IN ('pending', 'running')
// query: requestMessageSearchCount.cancelRequests
UPDATE public.message_search_count_requests
          SET state = 'cancelled', fragments = NULL, "membershipWindows" = NULL,
              "leaseUntil" = NULL, "completedAt" = now(), "updatedAt" = now()
        WHERE "userId" = $1 AND "conversationId" = $2
          AND state IN ('pending', 'running')
// query: requestMessageSearchCount.existing
SELECT id, state, "exactCount", "expiresAt", "userId", "conversationId",
              "queryHash", "normalizationVersion", "snapshotSequence",
              "membershipSequence", "recoveryGeneration"
         FROM public.message_search_count_requests
        WHERE "requestKey" = $1
        FOR UPDATE
// query: requestMessageSearchCount.inserted
INSERT INTO public.message_search_count_requests
         (id, "requestKey", "userId", "conversationId", "queryHash",
          "normalizationVersion", "snapshotSequence", "membershipSequence",
          "recoveryGeneration", fragments, "membershipWindows", state,
          "expiresAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
               'pending', $12, now(), now())
       RETURNING id, state, "exactCount", "expiresAt", "userId", "conversationId",
                 "queryHash", "normalizationVersion", "snapshotSequence",
                 "membershipSequence", "recoveryGeneration"
// query: getMessageSearchCountRequestStatus.isolation
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ
// query: getMessageSearchCountRequestStatus.result
SELECT id, state, "exactCount", "expiresAt", "userId", "conversationId",
              "queryHash", "normalizationVersion", "snapshotSequence",
              "membershipSequence", "recoveryGeneration"
         FROM public.message_search_count_requests
        WHERE id = $1 AND "userId" = $2 AND "conversationId" = $3
        LIMIT 1
// query: getMessageSearchCountRequestStatus.updateSearchCountRequests
UPDATE public.message_search_count_requests AS request
          SET state = 'unavailable', "exactCount" = NULL, fragments = NULL,
              "membershipWindows" = NULL, "leaseUntil" = NULL,
              "completedAt" = now(), "updatedAt" = now()
        WHERE request.id = $1 AND request."userId" = $2
          AND request."conversationId" = $3
          AND request.state IN ('pending', 'running', 'exact')
          AND (
            request."expiresAt" <= now()
            OR NOT EXISTS (
              SELECT 1
                FROM public.message_conversations AS conversation
               WHERE conversation.id = request."conversationId"
                 AND conversation."changeSeq" = request."snapshotSequence"
                 AND conversation."membershipSeq" = request."membershipSequence"
            )
            OR COALESCE((
              SELECT account."recoveryGeneration"
                FROM public.message_search_account_state AS account
               WHERE account."userId" = request."userId"
            ), 0) <> request."recoveryGeneration"
            OR NOT EXISTS (
              SELECT 1
                FROM public.message_search_coverage AS coverage
               WHERE coverage."conversationId" = request."conversationId"
                 AND coverage."backfillCompletedAt" IS NOT NULL
                 AND coverage."completedChangeSeq" >= request."snapshotSequence"
                 AND coverage."unrecoverableEpochs" = 0
                 AND NOT coverage."hasUnreadableMessages"
            )
          )
// query: listRunnableMessageSearchCounts.result
SELECT request.id
       FROM public.message_search_count_requests AS request
       JOIN public.message_search_coverage AS coverage
         ON coverage."conversationId" = request."conversationId"
       JOIN public.message_conversations AS conversation
         ON conversation.id = request."conversationId"
       LEFT JOIN public.message_search_account_state AS account
         ON account."userId" = request."userId"
      WHERE request."expiresAt" > now()
        AND (request.state = 'pending'
          OR (request.state = 'running' AND request."leaseUntil" <= now()))
        AND coverage."backfillCompletedAt" IS NOT NULL
        AND coverage."completedChangeSeq" >= request."snapshotSequence"
        AND coverage."unrecoverableEpochs" = 0
        AND NOT coverage."hasUnreadableMessages"
        AND conversation."changeSeq" = request."snapshotSequence"
        AND conversation."membershipSeq" = request."membershipSequence"
        AND COALESCE(account."recoveryGeneration", 0) = request."recoveryGeneration"
      ORDER BY request."createdAt" ASC
      LIMIT $1
// query: expireStaleMessageSearchCounts.updateSearchCountRequests
UPDATE public.message_search_count_requests AS request
        SET state = 'unavailable', fragments = NULL, "membershipWindows" = NULL,
            "leaseUntil" = NULL, "completedAt" = now(), "updatedAt" = now()
      WHERE request.state IN ('pending', 'running')
        AND (request."expiresAt" <= now()
          OR NOT EXISTS (
            SELECT 1
              FROM public.message_search_coverage AS coverage
             WHERE coverage."conversationId" = request."conversationId"
               AND coverage."backfillCompletedAt" IS NOT NULL
               AND coverage."completedChangeSeq" >= request."snapshotSequence"
               AND coverage."unrecoverableEpochs" = 0
               AND NOT coverage."hasUnreadableMessages"
          )
          OR EXISTS (
            SELECT 1
              FROM public.message_conversations AS conversation
             WHERE conversation.id = request."conversationId"
               AND (conversation."changeSeq" <> request."snapshotSequence"
                 OR conversation."membershipSeq" <> request."membershipSequence")
          )
          OR COALESCE((
            SELECT account."recoveryGeneration"
              FROM public.message_search_account_state AS account
             WHERE account."userId" = request."userId"
          ), 0) <> request."recoveryGeneration")
// query: claimMessageSearchCountRequest.lease
UPDATE public.message_search_count_requests
          SET state = 'running', attempts = attempts + 1,
              "leaseUntil" = now() + interval '2 minutes', "updatedAt" = now()
        WHERE id = $1
// query: claimMessageSearchCountRequest.selected
SELECT request.id, request."userId", request."conversationId",
              request."queryHash", request."normalizationVersion",
              request."snapshotSequence", request."membershipSequence",
              request."recoveryGeneration", request.fragments,
              request."membershipWindows", request.attempts, request."createdAt",
              request."expiresAt"
         FROM public.message_search_count_requests AS request
         JOIN public.message_search_coverage AS coverage
           ON coverage."conversationId" = request."conversationId"
         JOIN public.message_conversations AS conversation
           ON conversation.id = request."conversationId"
         LEFT JOIN public.message_search_account_state AS account
           ON account."userId" = request."userId"
        WHERE request.id = $1
          AND request."expiresAt" > now()
          AND (request.state = 'pending'
            OR (request.state = 'running' AND request."leaseUntil" <= now()))
          AND coverage."backfillCompletedAt" IS NOT NULL
          AND coverage."completedChangeSeq" >= request."snapshotSequence"
          AND coverage."unrecoverableEpochs" = 0
          AND NOT coverage."hasUnreadableMessages"
          AND conversation."changeSeq" = request."snapshotSequence"
          AND conversation."membershipSeq" = request."membershipSequence"
          AND COALESCE(account."recoveryGeneration", 0) = request."recoveryGeneration"
        FOR UPDATE OF request SKIP LOCKED
// query: claimMessageSearchCountRequest.updateSearchCountRequests
UPDATE public.message_search_count_requests
            SET state = 'unavailable', fragments = NULL, "membershipWindows" = NULL,
                "leaseUntil" = NULL, "completedAt" = now(), "updatedAt" = now()
          WHERE id = $1
// query: claimMessageSearchCountRequest.updateSearchCountRequests2
UPDATE public.message_search_count_requests
            SET state = 'unavailable', fragments = NULL, "membershipWindows" = NULL,
                "leaseUntil" = NULL, "completedAt" = now(), "updatedAt" = now()
          WHERE id = $1
// query: completeMessageSearchCountRequest.withSearchCountRequests
WITH current_scope AS MATERIALIZED (
       SELECT request.id,
              request."expiresAt" > now()
                AND conversation.id IS NOT NULL
                AND conversation."changeSeq" = request."snapshotSequence"
                AND conversation."membershipSeq" = request."membershipSequence"
                AND COALESCE(account."recoveryGeneration", 0) = request."recoveryGeneration"
                AND coverage."backfillCompletedAt" IS NOT NULL
                AND coverage."completedChangeSeq" >= request."snapshotSequence"
                AND coverage."unrecoverableEpochs" = 0
                AND NOT coverage."hasUnreadableMessages" AS valid
         FROM public.message_search_count_requests AS request
         LEFT JOIN public.message_conversations AS conversation
           ON conversation.id = request."conversationId"
         LEFT JOIN public.message_search_account_state AS account
           ON account."userId" = request."userId"
         LEFT JOIN public.message_search_coverage AS coverage
           ON coverage."conversationId" = request."conversationId"
        WHERE request.id = $1 AND request.state = 'running'
     )
     UPDATE public.message_search_count_requests AS request
        SET state = CASE WHEN current_scope.valid THEN 'exact' ELSE 'unavailable' END,
            "exactCount" = CASE WHEN current_scope.valid THEN $2::int4 ELSE NULL END,
            fragments = NULL, "membershipWindows" = NULL,
            "leaseUntil" = NULL, "completedAt" = now(), "updatedAt" = now()
       FROM current_scope
      WHERE request.id = current_scope.id AND request.state = 'running'
// query: releaseMessageSearchCountRequest.updateSearchCountRequests
UPDATE public.message_search_count_requests
        SET state = CASE WHEN attempts >= 8 THEN 'unavailable' ELSE 'pending' END,
            fragments = CASE WHEN attempts >= 8 THEN NULL ELSE fragments END,
            "membershipWindows" = CASE WHEN attempts >= 8 THEN NULL ELSE "membershipWindows" END,
            "leaseUntil" = NULL,
            "completedAt" = CASE WHEN attempts >= 8 THEN now() ELSE NULL END,
            "updatedAt" = now()
      WHERE id = $1 AND state = 'running'
