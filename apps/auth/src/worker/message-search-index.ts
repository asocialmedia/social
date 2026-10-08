import {
  commitMessageSearchBackfillBatch,
  markSearchOutboxUnreadable,
  persistSearchDocument,
  prisma,
  readNextMessageSearchBackfillBatch,
  startMessageSearchBackfill,
} from "@asm/db";
import type {
  MessageSearchBackfillArtifact,
  SearchReferenceArtifact,
  SearchTermArtifact,
} from "@asm/db";
import {
  decryptMessage,
  decryptWithMasterKey,
  deriveMasterKey,
  extractMessageReferences,
  importPrivateKeyJwk,
  importPublicKeyJwk,
  publicKeyBase64ToJwk,
  unwrapRootKey,
} from "@asm/messages/crypto";
import {
  messageSearchGramKeys,
  messageSearchTerms,
  searchableTextFromPayload,
} from "@asm/messages/search";

import { mapConcurrent } from "./map-concurrent";

const PRIVATE_KEY_CACHE_CAPACITY = 128;
const PRIVATE_KEY_CACHE_TTL_MS = 5 * 60 * 1000;
const MESSAGE_SEARCH_DECRYPT_CONCURRENCY = 4;

interface CachedPrivateKey {
  expiresAt: number;
  identityVersion: string;
  key: CryptoKey;
}

interface PendingPrivateKey {
  identityVersion: string;
  promise: Promise<CryptoKey | null>;
}

interface MessageIdentityRow {
  encryptedPrivateKey: string;
  kdfIterations: number;
  masterKeyHash: string | null;
  publicKey: string;
  salt: string;
  updatedAt: unknown;
  userId: string;
}

const privateKeyCache = new Map<string, CachedPrivateKey>();
const pendingPrivateKeyCache = new Map<string, PendingPrivateKey>();

function identityVersion(identity: MessageIdentityRow): string {
  return `${identity.publicKey}:${String(identity.updatedAt)}`;
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

async function recoverPrivateKey(
  identity: MessageIdentityRow
): Promise<CryptoKey | null> {
  const cached = privateKeyCache.get(identity.userId);
  const version = identityVersion(identity);
  if (
    cached &&
    cached.expiresAt > Date.now() &&
    cached.identityVersion === version
  ) {
    return cached.key;
  }
  privateKeyCache.delete(identity.userId);
  const pending = pendingPrivateKeyCache.get(identity.userId);
  if (pending?.identityVersion === version) {
    return pending.promise;
  }
  const loadPrivateKey = async (): Promise<CryptoKey | null> => {
    if (
      !identity.masterKeyHash ||
      identity.masterKeyHash.length < 32 ||
      identity.kdfIterations < 100_000 ||
      identity.kdfIterations > 5_000_000
    ) {
      return null;
    }

    try {
      const salt = decodeBase64(identity.salt);
      if (salt.byteLength < 16) {
        return null;
      }
      const [iv, ciphertext] = identity.encryptedPrivateKey.split(".");
      if (!iv || !ciphertext) {
        return null;
      }
      const masterKey = await deriveMasterKey(
        identity.masterKeyHash,
        salt,
        identity.kdfIterations
      );
      const privateKeyJwk = JSON.parse(
        await decryptWithMasterKey(masterKey, { ciphertext, iv })
      );
      return await importPrivateKeyJwk(privateKeyJwk);
    } catch {
      return null;
    }
  };
  const promise = loadPrivateKey();
  const pendingEntry: PendingPrivateKey = {
    identityVersion: version,
    promise,
  };
  pendingPrivateKeyCache.set(identity.userId, pendingEntry);
  const key = await promise;
  if (pendingPrivateKeyCache.get(identity.userId) === pendingEntry) {
    pendingPrivateKeyCache.delete(identity.userId);
    if (key) {
      if (privateKeyCache.size >= PRIVATE_KEY_CACHE_CAPACITY) {
        const oldestUserId = privateKeyCache.keys().next().value;
        if (oldestUserId) {
          privateKeyCache.delete(oldestUserId);
        }
      }
      privateKeyCache.set(identity.userId, {
        expiresAt: Date.now() + PRIVATE_KEY_CACHE_TTL_MS,
        identityVersion: version,
        key,
      });
    }
  }
  return key;
}

async function loadConversationSearchContext(conversationId: string) {
  const members = await prisma.orm.public.MessageConversationMembers.select(
    "userId"
  )
    .where({ conversationId })
    .all();
  const memberIds = members.map((member) => member.userId);
  const [conversation, identities, wraps] = await Promise.all([
    prisma.orm.public.MessageConversations.select("_type")
      .where({ id: conversationId })
      .first(),
    prisma.orm.public.MessageIdentities.where((identity) =>
      identity.userId.in(memberIds)
    ).all(),
    prisma.orm.public.MessageConversationKeys.where({
      conversationId,
    }).all(),
  ]);
  return {
    conversationType: conversation?._type,
    identityByUserId: new Map(
      identities.map((identity) => [identity.userId, identity])
    ),
    memberIds,
    wraps,
  };
}

type ConversationSearchContext = Awaited<
  ReturnType<typeof loadConversationSearchContext>
>;

async function decryptSearchableMessage(
  conversationId: string,
  message: {
    ciphertext: string;
    id: string;
    iv: string;
    keyEpoch: number | null;
    ratchetIndex: number;
    senderId: string;
  },
  context: ConversationSearchContext
): Promise<{
  keyEpoch: number;
  references: SearchReferenceArtifact[];
  terms: SearchTermArtifact[];
} | null> {
  const epochCandidates = context.wraps.filter(
    (wrap) => message.keyEpoch === null || wrap.version === message.keyEpoch
  );

  // oxlint-disable no-await-in-loop -- authenticated wrap attempts stop at the first successful epoch
  for (const wrap of epochCandidates) {
    const identity = context.identityByUserId.get(wrap.ownerUserId);
    if (!identity) {
      continue;
    }
    const privateKey = await recoverPrivateKey(identity);
    if (!privateKey) {
      continue;
    }
    const legacyDmWrapperId =
      context.conversationType === "DM"
        ? context.memberIds.find((memberId) => memberId !== wrap.ownerUserId)
        : undefined;
    const wrapperPublicKey =
      wrap.wrapperPublicKey ??
      context.identityByUserId.get(
        wrap.wrapperUserId ?? legacyDmWrapperId ?? ""
      )?.publicKey;
    if (!wrapperPublicKey) {
      continue;
    }
    try {
      const rootKey = await unwrapRootKey(
        privateKey,
        await importPublicKeyJwk(publicKeyBase64ToJwk(wrapperPublicKey)),
        conversationId,
        { ciphertext: wrap.encryptedKey, iv: wrap.iv }
      );
      const payload = await decryptMessage(
        rootKey,
        message.senderId,
        conversationId,
        message
      );
      const terms = messageSearchTerms(searchableTextFromPayload(payload)).map(
        (normalized) => ({
          gramKeys: messageSearchGramKeys(normalized),
          normalized,
        })
      );
      const references = extractMessageReferences(payload).map(
        ({
          kind,
          mediaKind,
          ordinal,
          requiredId,
        }): SearchReferenceArtifact => ({
          kind,
          ordinal,
          ...(mediaKind ? { mediaKind } : {}),
          ...(requiredId ? { requiredId } : {}),
        })
      );
      return { keyEpoch: wrap.version, references, terms };
    } catch {
      // Another wrap may be the authenticated epoch for this message.
    }
  }
  // oxlint-enable no-await-in-loop
  return null;
}

export async function processMessageSearchOutbox(
  outboxId: string,
  logger: {
    warn: (fields: Record<string, unknown>, message: string) => void;
  }
): Promise<void> {
  const outbox = await prisma.orm.public.MessageSearchOutbox.where({
    id: outboxId,
  }).first();
  if (!outbox || outbox.completedAt) {
    return;
  }
  const message = await prisma.orm.public.Messages.where({
    conversationId: outbox.conversationId,
    id: outbox.messageId,
  }).first();
  if (!message || message.deletedAt || message.revision !== outbox.revision) {
    await persistSearchDocument({
      conversationId: outbox.conversationId,
      keyEpoch: message?.keyEpoch ?? 0,
      messageId: outbox.messageId,
      outboxId,
      references: [],
      revision: outbox.revision,
      terms: [],
    });
    return;
  }
  const context = await loadConversationSearchContext(outbox.conversationId);
  const result = await decryptSearchableMessage(
    outbox.conversationId,
    message,
    context
  );
  if (result) {
    await persistSearchDocument({
      conversationId: outbox.conversationId,
      keyEpoch: result.keyEpoch,
      messageId: message.id,
      outboxId,
      references: result.references,
      revision: message.revision,
      terms: result.terms,
    });
    return;
  }
  await markSearchOutboxUnreadable({
    changeSequence: outbox.changeSequence,
    conversationId: outbox.conversationId,
    outboxId,
    revision: outbox.revision,
  });
  logger.warn(
    { outboxId },
    "DM search item is waiting for a readable message-key epoch"
  );
}

export async function processMessageSearchBackfill(
  conversationId: string,
  logger: {
    warn: (fields: Record<string, unknown>, message: string) => void;
  }
): Promise<{ finished: boolean; nextCursorMessageId: string | null }> {
  const backfill = await startMessageSearchBackfill(conversationId);
  if (!backfill || backfill.completedAt || backfill.throughSequence === null) {
    return { finished: true, nextCursorMessageId: null };
  }
  const batch = await readNextMessageSearchBackfillBatch(conversationId);
  if (!batch) {
    return { finished: true, nextCursorMessageId: null };
  }
  if (batch.messages.length === 0) {
    const committed = await commitMessageSearchBackfillBatch({
      artifacts: [],
      conversationId,
      expectedPosition: batch.expectedPosition,
      finished: true,
      nextPosition: batch.expectedPosition,
      rowsTraversed: 0,
      throughSequence: batch.throughSequence,
      unrecoverableEpochs: 0,
    });
    return { finished: committed.committed, nextCursorMessageId: null };
  }

  const context = await loadConversationSearchContext(conversationId);
  const outcomes = await mapConcurrent(
    batch.messages,
    MESSAGE_SEARCH_DECRYPT_CONCURRENCY,
    async (message) => {
      if (message.deletedAt) {
        return null;
      }
      const result = await decryptSearchableMessage(
        conversationId,
        message,
        context
      );
      if (!result) {
        return { messageId: message.id, status: "unreadable" as const };
      }
      return {
        artifact: {
          createdAt: message.createdAt,
          keyEpoch: result.keyEpoch,
          messageId: message.id,
          references: result.references,
          revision: message.revision,
          terms: result.terms,
        } satisfies MessageSearchBackfillArtifact,
        status: "indexed" as const,
      };
    }
  );
  const artifacts = outcomes.flatMap((outcome) =>
    outcome?.status === "indexed" ? [outcome.artifact] : []
  );
  const unreadableMessages = outcomes.filter(
    (outcome) => outcome?.status === "unreadable"
  );
  const unrecoverableEpochs = unreadableMessages.length;
  for (const outcome of unreadableMessages) {
    logger.warn(
      { conversationId, messageId: outcome.messageId },
      "DM search history contains a message without a readable key epoch"
    );
  }
  const lastMessage = batch.messages.at(-1);
  if (!lastMessage) {
    return { finished: false, nextCursorMessageId: null };
  }
  const committed = await commitMessageSearchBackfillBatch({
    artifacts,
    conversationId,
    expectedPosition: batch.expectedPosition,
    finished: false,
    nextPosition: {
      createdAt: lastMessage.createdAt,
      messageId: lastMessage.id,
    },
    rowsTraversed: batch.messages.length,
    throughSequence: batch.throughSequence,
    unrecoverableEpochs,
  });
  return {
    finished: false,
    nextCursorMessageId: committed.committed ? lastMessage.id : null,
  };
}

export function clearMessageSearchKeyCache(): void {
  privateKeyCache.clear();
  pendingPrivateKeyCache.clear();
}
