import { createHash } from "node:crypto";

export interface MessageSearchEpochProof {
  readable: boolean;
  recoveryGeneration: number;
  sourceFingerprint: string;
  wrapId: string;
}

export function messageSearchEpochFingerprint(input: {
  identity: {
    encryptedPrivateKey: string;
    kdfIterations: number;
    masterKeyHash: string | null;
    publicKey: string;
    salt: string;
  };
  resolvedWrapperPublicKey: string | null;
  wrap: {
    encryptedKey: string;
    iv: string;
    wrapperPublicKey: string | null;
    wrapperUserId: string | null;
  };
}): string {
  const { identity, wrap } = input;
  return createHash("sha256")
    .update(
      JSON.stringify([
        wrap.encryptedKey,
        wrap.iv,
        wrap.wrapperPublicKey,
        wrap.wrapperUserId,
        identity.publicKey,
        identity.encryptedPrivateKey,
        identity.salt,
        identity.masterKeyHash,
        String(identity.kdfIterations),
        input.resolvedWrapperPublicKey,
      ])
    )
    .digest("hex");
}

// These aliases are fixed internal SQL identifiers, never request data.
const RESOLVED_WRAPPER_SQL = `COALESCE(epoch_key."wrapperPublicKey", (
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
))`;

const EPOCH_FINGERPRINT_SQL = `encode(sha256(convert_to(array_to_json(ARRAY[
  epoch_key."encryptedKey", epoch_key.iv, epoch_key."wrapperPublicKey", epoch_key."wrapperUserId",
  epoch_identity."publicKey", epoch_identity."encryptedPrivateKey", epoch_identity.salt,
  epoch_identity."masterKeyHash", epoch_identity."kdfIterations"::text, ${RESOLVED_WRAPPER_SQL}
])::text, 'UTF8')), 'hex')`;

const CURRENT_EPOCH_PROOF_SQL = `proof."recoveryGeneration" = COALESCE(epoch_account."recoveryGeneration", 0)
  AND proof."conversationId" = epoch_key."conversationId"
  AND proof."userId" = epoch_key."ownerUserId"
  AND proof."keyEpoch" = epoch_key.version
  AND proof."sourceFingerprint" = ${EPOCH_FINGERPRINT_SQL}`;

export function readableMessageKeyEpochsSql(
  userParameter: "$2" | "$5"
): string {
  // The uncorrelated subquery computes proof eligibility once per query, rather than once per message.
  return `SELECT epoch_key.version
    FROM public.message_conversation_keys AS epoch_key
    JOIN public.message_identities AS epoch_identity ON epoch_identity."userId" = epoch_key."ownerUserId"
    LEFT JOIN public.message_search_account_state AS epoch_account ON epoch_account."userId" = epoch_key."ownerUserId"
    JOIN public.message_search_epoch_readability AS proof ON proof."wrapId" = epoch_key.id
   WHERE epoch_key."conversationId" = $1 AND epoch_key."ownerUserId" = ${userParameter}
     AND proof.readable AND ${CURRENT_EPOCH_PROOF_SQL}`;
}

export const UNVERIFIED_CONVERSATION_EPOCH_SQL = `SELECT 1
  FROM public.message_conversation_keys AS epoch_key
  JOIN public.message_identities AS epoch_identity ON epoch_identity."userId" = epoch_key."ownerUserId"
  LEFT JOIN public.message_search_account_state AS epoch_account ON epoch_account."userId" = epoch_key."ownerUserId"
  LEFT JOIN public.message_search_epoch_readability AS proof ON proof."wrapId" = epoch_key.id
 WHERE epoch_key."conversationId" = $1
   AND (proof."wrapId" IS NULL OR NOT (${CURRENT_EPOCH_PROOF_SQL}))`;

export const MESSAGE_VIEWER_EPOCH_COVERAGE_SQL = `SELECT
  COUNT(*) FILTER (WHERE proof."wrapId" IS NULL OR NOT (${CURRENT_EPOCH_PROOF_SQL}))::int AS pending,
  COUNT(*) FILTER (WHERE (${CURRENT_EPOCH_PROOF_SQL}) AND NOT proof.readable)::int AS unavailable
  FROM public.message_conversation_keys AS epoch_key
  JOIN public.message_identities AS epoch_identity ON epoch_identity."userId" = epoch_key."ownerUserId"
  LEFT JOIN public.message_search_account_state AS epoch_account ON epoch_account."userId" = epoch_key."ownerUserId"
  LEFT JOIN public.message_search_epoch_readability AS proof ON proof."wrapId" = epoch_key.id
 WHERE epoch_key."conversationId" = $1 AND epoch_key."ownerUserId" = $2`;

export async function persistMessageSearchEpochProofs(
  client: { query: (statement: string, values: string[]) => Promise<unknown> },
  conversationId: string,
  proofs: readonly MessageSearchEpochProof[]
): Promise<void> {
  const uniqueProofs = [
    ...new Map(proofs.map((proof) => [proof.wrapId, proof])).values(),
  ];
  if (uniqueProofs.length === 0) {
    return;
  }
  for (const proof of uniqueProofs) {
    if (
      !/^[a-f0-9]{64}$/.test(proof.sourceFingerprint) ||
      !Number.isSafeInteger(proof.recoveryGeneration) ||
      proof.recoveryGeneration < 0
    ) {
      throw new TypeError("Invalid message key epoch proof");
    }
  }
  for (let offset = 0; offset < uniqueProofs.length; offset += 100) {
    // oxlint-disable-next-line no-await-in-loop -- Bounded proof writes share the caller's artifact transaction.
    await client.query(
      `WITH supplied AS (
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
       AND supplied."sourceFingerprint" = ${EPOCH_FINGERPRINT_SQL}
     FOR SHARE OF epoch_key, epoch_identity
    ON CONFLICT ("wrapId") DO UPDATE
      SET "conversationId" = EXCLUDED."conversationId", "userId" = EXCLUDED."userId", "keyEpoch" = EXCLUDED."keyEpoch",
          "sourceFingerprint" = EXCLUDED."sourceFingerprint", "recoveryGeneration" = EXCLUDED."recoveryGeneration",
          readable = EXCLUDED.readable, "verifiedAt" = EXCLUDED."verifiedAt"
    WHERE public.message_search_epoch_readability."recoveryGeneration" <= EXCLUDED."recoveryGeneration"`,
      [conversationId, JSON.stringify(uniqueProofs.slice(offset, offset + 100))]
    );
  }
}
