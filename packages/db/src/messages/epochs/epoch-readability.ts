import { createHash } from "node:crypto";

import type { PrismaTransaction } from "../../prisma";
import { rawExecute } from "../infrastructure/raw-sql";
import { renderSql } from "../infrastructure/sql-template";
import { messageSearchSql } from "../search/queries";

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
const RESOLVED_WRAPPER_SQL = messageSearchSql.resolvedWrapper.query;

const EPOCH_FINGERPRINT_SQL = renderSql(
  messageSearchSql.epochFingerprint.query,
  { RESOLVED_WRAPPER_SQL }
);

const CURRENT_EPOCH_PROOF_SQL = renderSql(
  messageSearchSql.currentEpochProof.query,
  { EPOCH_FINGERPRINT_SQL }
);

export function readableMessageKeyEpochsSql(
  userParameter: "$2" | "$5"
): string {
  // The uncorrelated subquery computes proof eligibility once per query, rather than once per message.
  return renderSql(
    messageSearchSql.readableMessageKeyEpochsSql.selectConversationKeys,
    {
      CURRENT_EPOCH_PROOF_SQL,
      userParameter,
    }
  );
}

export const UNVERIFIED_CONVERSATION_EPOCH_SQL = renderSql(
  messageSearchSql.unverifiedConversationEpoch.query,
  { CURRENT_EPOCH_PROOF_SQL }
);

export const MESSAGE_VIEWER_EPOCH_COVERAGE_SQL = renderSql(
  messageSearchSql.messageViewerEpochCoverage.query,
  { CURRENT_EPOCH_PROOF_SQL }
);

export async function persistMessageSearchEpochProofs(
  transaction: Pick<PrismaTransaction, "execute">,
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
    await rawExecute(
      renderSql(
        messageSearchSql.persistMessageSearchEpochProofs.withJsonbToRecordset,
        { EPOCH_FINGERPRINT_SQL }
      ),
      [
        conversationId,
        JSON.stringify(uniqueProofs.slice(offset, offset + 100)),
      ],
      transaction
    );
  }
}
