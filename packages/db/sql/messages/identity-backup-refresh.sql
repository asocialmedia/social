// query: commitMessageIdentityBackupRefresh.accountState
SELECT "recoveryGeneration"
           FROM public.message_search_account_state
          WHERE "userId" = $1
// query: commitMessageIdentityBackupRefresh.affected
SELECT conversation.id AS "conversationId", conversation."changeSeq"
         FROM public.message_conversation_members AS member
         JOIN public.message_conversations AS conversation
           ON conversation.id = member."conversationId"
         JOIN public.message_search_coverage AS coverage
           ON coverage."conversationId" = conversation.id
        WHERE member."userId" = $1
          AND (
            EXISTS (SELECT 1 FROM public.message_conversation_keys AS own_wrap
                     WHERE own_wrap."conversationId" = conversation.id AND own_wrap."ownerUserId" = $1) OR
            coverage."unrecoverableEpochs" > 0 OR
            coverage."hasUnreadableMessages" OR
            (coverage."backfillStartedAt" IS NOT NULL AND
             coverage."backfillCompletedAt" IS NULL)
          )
        ORDER BY conversation.id
        FOR UPDATE OF conversation
// query: commitMessageIdentityBackupRefresh.bumpedConversation
UPDATE public.message_conversations
            SET "changeSeq" = "changeSeq" + 1
          WHERE id = $1
          RETURNING "changeSeq"
// query: commitMessageIdentityBackupRefresh.coverageState
SELECT "backfillCompletedAt", "backfillStartedAt", "unrecoverableEpochs"
           FROM public.message_search_coverage
          WHERE "conversationId" = $1
// query: commitMessageIdentityBackupRefresh.identity
UPDATE public.message_identities
          SET "encryptedPrivateKey" = $4,
              "masterKeyHash" = $5,
              salt = $6,
              "kdfIterations" = $7,
              "updatedAt" = $8
        WHERE "userId" = $1
          AND "publicKey" = $2
          AND "updatedAt" = $3::timestamp
        RETURNING "userId"
// query: commitMessageIdentityBackupRefresh.insertConversationChanges
INSERT INTO public.message_conversation_changes
           (id, "conversationId", sequence, "messageId", revision, kind, "audienceUserIds")
         VALUES ($1, $2, $3, NULL, NULL, 'recovery.changed', ARRAY[$4::text])
// query: commitMessageIdentityBackupRefresh.insertSearchAccountState
INSERT INTO public.message_search_account_state ("userId", "recoveryGeneration")
       VALUES ($1, 0)
       ON CONFLICT ("userId") DO NOTHING
// query: commitMessageIdentityBackupRefresh.lockedAccountState
SELECT "recoveryGeneration"
         FROM public.message_search_account_state
        WHERE "userId" = $1
        FOR UPDATE
// query: commitMessageIdentityBackupRefresh.resetCoverage
UPDATE public.message_search_coverage
            SET "backfillThroughSequence" = $2,
                "backfillCursorCreatedAt" = NULL,
                "backfillCursorMessageId" = NULL,
                "backfillStartedAt" = now(),
                "backfillCompletedAt" = NULL,
                "updatedAt" = now()
          WHERE "conversationId" = $1
// query: commitMessageIdentityBackupRefresh.selectSearchCoverage
SELECT "conversationId"
         FROM public.message_search_coverage
        WHERE "conversationId" = ANY($1::text[])
        ORDER BY "conversationId"
        FOR UPDATE
// query: commitMessageIdentityBackupRefresh.updatedState
UPDATE public.message_search_account_state
            SET "recoveryGeneration" = $2,
                "updatedAt" = now()
          WHERE "userId" = $1
          RETURNING "recoveryGeneration"
