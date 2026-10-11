// query: resolvedWrapper.query
COALESCE(epoch_key."wrapperPublicKey", (
  SELECT wrapper_identity."publicKey"
    FROM public.message_identities AS wrapper_identity
   WHERE wrapper_identity."userId" = COALESCE(epoch_key."wrapperUserId", (
     SELECT peer."userId"
       FROM public.message_conversation_members AS peer
       JOIN public.message_conversations AS conversation ON conversation.id = peer."conversationId"
      WHERE peer."conversationId" = epoch_key."conversationId"
        AND conversation.type = 'DM'
        AND peer."userId" <> epoch_key."ownerUserId"
      ORDER BY peer."userId"
      LIMIT 1
   ))
))
// query: epochFingerprint.query
encode(sha256(convert_to(array_to_json(ARRAY[
  epoch_key."encryptedKey", epoch_key.iv, epoch_key."wrapperPublicKey", epoch_key."wrapperUserId",
  epoch_identity."publicKey", epoch_identity."encryptedPrivateKey", epoch_identity.salt,
  epoch_identity."masterKeyHash", epoch_identity."kdfIterations"::text, {{RESOLVED_WRAPPER_SQL}}
])::text, 'UTF8')), 'hex')
// query: currentEpochProof.query
proof."recoveryGeneration" = COALESCE(epoch_account."recoveryGeneration", 0)
  AND proof."conversationId" = epoch_key."conversationId"
  AND proof."userId" = epoch_key."ownerUserId"
  AND proof."keyEpoch" = epoch_key.version
  AND proof."sourceFingerprint" = {{EPOCH_FINGERPRINT_SQL}}
// query: unverifiedConversationEpoch.query
SELECT 1
  FROM public.message_conversation_keys AS epoch_key
  JOIN public.message_identities AS epoch_identity ON epoch_identity."userId" = epoch_key."ownerUserId"
  LEFT JOIN public.message_search_account_state AS epoch_account ON epoch_account."userId" = epoch_key."ownerUserId"
  LEFT JOIN public.message_search_epoch_readability AS proof ON proof."wrapId" = epoch_key.id
 WHERE epoch_key."conversationId" = $1
   AND (proof."wrapId" IS NULL OR NOT ({{CURRENT_EPOCH_PROOF_SQL}}))
// query: messageViewerEpochCoverage.query
SELECT
  COUNT(*) FILTER (WHERE proof."wrapId" IS NULL OR NOT ({{CURRENT_EPOCH_PROOF_SQL}}))::int AS pending,
  COUNT(*) FILTER (WHERE ({{CURRENT_EPOCH_PROOF_SQL}}) AND NOT proof.readable)::int AS unavailable
  FROM public.message_conversation_keys AS epoch_key
  JOIN public.message_identities AS epoch_identity ON epoch_identity."userId" = epoch_key."ownerUserId"
  LEFT JOIN public.message_search_account_state AS epoch_account ON epoch_account."userId" = epoch_key."ownerUserId"
  LEFT JOIN public.message_search_epoch_readability AS proof ON proof."wrapId" = epoch_key.id
 WHERE epoch_key."conversationId" = $1 AND epoch_key."ownerUserId" = $2
// query: persistMessageSearchEpochProofs.withJsonbToRecordset
WITH supplied AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS input("wrapId" text, "sourceFingerprint" text, "recoveryGeneration" int, readable boolean)
    )
    INSERT INTO public.message_search_epoch_readability
      ("wrapId", "conversationId", "userId", "keyEpoch", "sourceFingerprint", "recoveryGeneration", readable, "verifiedAt")
    SELECT epoch_key.id, epoch_key."conversationId", epoch_key."ownerUserId", epoch_key.version,
           supplied."sourceFingerprint", supplied."recoveryGeneration", supplied.readable, now()
      FROM supplied
      JOIN public.message_conversation_keys AS epoch_key ON epoch_key.id = supplied."wrapId"
      JOIN public.message_identities AS epoch_identity ON epoch_identity."userId" = epoch_key."ownerUserId"
      LEFT JOIN public.message_search_account_state AS epoch_account ON epoch_account."userId" = epoch_key."ownerUserId"
     WHERE epoch_key."conversationId" = $1
       AND supplied."recoveryGeneration" = COALESCE(epoch_account."recoveryGeneration", 0)
       AND supplied."sourceFingerprint" = {{EPOCH_FINGERPRINT_SQL}}
     FOR SHARE OF epoch_key, epoch_identity
    ON CONFLICT ("wrapId") DO UPDATE
      SET "conversationId" = EXCLUDED."conversationId", "userId" = EXCLUDED."userId", "keyEpoch" = EXCLUDED."keyEpoch",
          "sourceFingerprint" = EXCLUDED."sourceFingerprint", "recoveryGeneration" = EXCLUDED."recoveryGeneration",
          readable = EXCLUDED.readable, "verifiedAt" = EXCLUDED."verifiedAt"
    WHERE public.message_search_epoch_readability."recoveryGeneration" <= EXCLUDED."recoveryGeneration"
// query: readableMessageKeyEpochsSql.selectConversationKeys
SELECT epoch_key.version
    FROM public.message_conversation_keys AS epoch_key
    JOIN public.message_identities AS epoch_identity ON epoch_identity."userId" = epoch_key."ownerUserId"
    LEFT JOIN public.message_search_account_state AS epoch_account ON epoch_account."userId" = epoch_key."ownerUserId"
    JOIN public.message_search_epoch_readability AS proof ON proof."wrapId" = epoch_key.id
   WHERE epoch_key."conversationId" = $1 AND epoch_key."ownerUserId" = {{userParameter}}
     AND proof.readable AND {{CURRENT_EPOCH_PROOF_SQL}}
