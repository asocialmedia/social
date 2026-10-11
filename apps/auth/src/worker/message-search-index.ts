import { timingSafeEqual } from "node:crypto";

import {
  commitMessageSearchBackfillBatch,
  fromPrismaDateTime,
  markSearchOutboxUnreadable,
  messageSearchEpochFingerprint,
  persistSearchDocument,
  prisma,
  readNextMessageSearchBackfillBatch,
  startMessageSearchBackfill,
} from "@asm/db";
import type {
  MessageSearchBackfillArtifact,
  MessageSearchBackfillOutcome,
  MessageSearchEpochProof,
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
} from "@asm/messages/normalization";
import { searchableTextFromPayload } from "@asm/messages/search-contracts";

import { mapConcurrent } from "./map-concurrent";
import type { MessageSearchWorkerMetricSink } from "./message-search-metrics";
import { safelyRecordMessageSearchWorkerMetric } from "./message-search-metrics";

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
  return messageSearchEpochFingerprint({
    identity,
    resolvedWrapperPublicKey: null,
    wrap: {
      encryptedKey: "",
      iv: "",
      wrapperPublicKey: null,
      wrapperUserId: null,
    },
  });
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
      const publicKeyJwk = publicKeyBase64ToJwk(identity.publicKey);
      if (
        privateKeyJwk?.kty !== "EC" ||
        privateKeyJwk.crv !== "P-256" ||
        typeof privateKeyJwk.d !== "string" ||
        privateKeyJwk.x !== publicKeyJwk.x ||
        privateKeyJwk.y !== publicKeyJwk.y
      ) {
        return null;
      }
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
  const [conversation, identities, wraps, accountStates, epochProofs] =
    await Promise.all([
      prisma.orm.public.MessageConversations.select("_type")
        .where({ id: conversationId })
        .first(),
      prisma.orm.public.MessageIdentities.where((identity) =>
        identity.userId.in(memberIds)
      ).all(),
      prisma.orm.public.MessageConversationKeys.where({
        conversationId,
      }).all(),
      prisma.orm.public.MessageSearchAccountState.where((account) =>
        account.userId.in(memberIds)
      ).all(),
      prisma.orm.public.MessageSearchEpochReadability.where({
        conversationId,
      }).all(),
    ]);
  return {
    conversationType: conversation?._type,
    identityByUserId: new Map(
      identities.map((identity) => [identity.userId, identity])
    ),
    memberIds,
    proofPromises: new Map<number, Promise<MessageSearchEpochProof[]>>(),
    recoveryGenerationByUserId: new Map(
      accountStates.map((account) => [
        account.userId,
        account.recoveryGeneration,
      ])
    ),
    storedEpochProofs: new Map(
      epochProofs.map((proof) => [proof.wrapId, proof])
    ),
    wraps,
  };
}

type ConversationSearchContext = Awaited<
  ReturnType<typeof loadConversationSearchContext>
>;

type ConversationWrap = ConversationSearchContext["wraps"][number];
const wrappedRootKeyCache = new Map<
  string,
  { expiresAt: number; promise: Promise<Uint8Array | null> }
>();
const WRAPPED_ROOT_CACHE_CAPACITY = 256;

function resolvedWrapperPublicKey(
  wrap: ConversationWrap,
  context: ConversationSearchContext
): string | null {
  const legacyWrapperId =
    context.conversationType === "DM"
      ? context.memberIds
          .toSorted()
          .find((memberId) => memberId !== wrap.ownerUserId)
      : undefined;
  return (
    wrap.wrapperPublicKey ??
    context.identityByUserId.get(wrap.wrapperUserId ?? legacyWrapperId ?? "")
      ?.publicKey ??
    null
  );
}

function epochProofSource(
  wrap: ConversationWrap,
  context: ConversationSearchContext
): Omit<MessageSearchEpochProof, "readable"> | null {
  const identity = context.identityByUserId.get(wrap.ownerUserId);
  if (!identity) {
    return null;
  }
  return {
    recoveryGeneration:
      context.recoveryGenerationByUserId.get(wrap.ownerUserId) ?? 0,
    sourceFingerprint: messageSearchEpochFingerprint({
      identity,
      resolvedWrapperPublicKey: resolvedWrapperPublicKey(wrap, context),
      wrap,
    }),
    wrapId: wrap.id,
  };
}

function recoverWrappedRootKey(
  conversationId: string,
  wrap: ConversationWrap,
  context: ConversationSearchContext
): Promise<Uint8Array | null> {
  const source = epochProofSource(wrap, context);
  if (!source) {
    return Promise.resolve(null);
  }
  const cacheKey = `${conversationId}:${wrap.id}:${source.recoveryGeneration}:${source.sourceFingerprint}`;
  const cached = wrappedRootKeyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }
  wrappedRootKeyCache.delete(cacheKey);
  if (wrappedRootKeyCache.size >= WRAPPED_ROOT_CACHE_CAPACITY) {
    const oldest = wrappedRootKeyCache.keys().next().value;
    if (oldest) {
      wrappedRootKeyCache.delete(oldest);
    }
  }
  const promise = (async () => {
    const identity = context.identityByUserId.get(wrap.ownerUserId);
    const wrapperPublicKey = resolvedWrapperPublicKey(wrap, context);
    if (!identity || !wrapperPublicKey) {
      return null;
    }
    const privateKey = await recoverPrivateKey(identity);
    if (!privateKey) {
      return null;
    }
    try {
      const rootKey = await unwrapRootKey(
        privateKey,
        await importPublicKeyJwk(publicKeyBase64ToJwk(wrapperPublicKey)),
        conversationId,
        { ciphertext: wrap.encryptedKey, iv: wrap.iv }
      );
      return rootKey.byteLength === 32 ? rootKey : null;
    } catch {
      return null;
    }
  })();
  wrappedRootKeyCache.set(cacheKey, {
    expiresAt: Date.now() + PRIVATE_KEY_CACHE_TTL_MS,
    promise,
  });
  return promise;
}

function verifyViewerEpochs(
  conversationId: string,
  epoch: number,
  authenticatedRootKey: Uint8Array,
  context: ConversationSearchContext
): Promise<MessageSearchEpochProof[]> {
  let pending = context.proofPromises.get(epoch);
  if (!pending) {
    pending = (async () => {
      const proofs = await mapConcurrent(
        context.wraps.filter((wrap) => wrap.version === epoch),
        MESSAGE_SEARCH_DECRYPT_CONCURRENCY,
        async (wrap) => {
          const source = epochProofSource(wrap, context);
          if (!source) {
            return null;
          }
          const rootKey = await recoverWrappedRootKey(
            conversationId,
            wrap,
            context
          );
          return {
            ...source,
            readable:
              rootKey !== null &&
              rootKey.byteLength === authenticatedRootKey.byteLength &&
              timingSafeEqual(rootKey, authenticatedRootKey),
          };
        }
      );
      return proofs.filter(
        (proof): proof is MessageSearchEpochProof => proof !== null
      );
    })();
    context.proofPromises.set(epoch, pending);
  }
  return pending;
}

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
): Promise<
  | {
      status: "indexed";
      epochProofs: MessageSearchEpochProof[];
      keyEpoch: number;
      references: SearchReferenceArtifact[];
      terms: SearchTermArtifact[];
    }
  | {
      hasUnreadableMessage: true;
      status: "unreadable";
      unrecoverableEpoch: number | null;
    }
> {
  const epochCandidates = context.wraps.filter(
    (wrap) => message.keyEpoch === null || wrap.version === message.keyEpoch
  );
  let recoveredRootKey = false;

  // oxlint-disable no-await-in-loop -- authenticated wrap attempts stop at the first successful epoch
  for (const wrap of epochCandidates) {
    const rootKey = await recoverWrappedRootKey(conversationId, wrap, context);
    if (!rootKey) {
      continue;
    }
    recoveredRootKey = true;
    try {
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
      const epochProofs = await verifyViewerEpochs(
        conversationId,
        wrap.version,
        rootKey,
        context
      );
      return {
        epochProofs,
        keyEpoch: wrap.version,
        references,
        status: "indexed",
        terms,
      };
    } catch {
      // Another wrap may be the authenticated epoch for this message.
    }
  }
  // oxlint-enable no-await-in-loop
  return {
    hasUnreadableMessage: true,
    status: "unreadable",
    unrecoverableEpoch:
      recoveredRootKey || message.keyEpoch === null ? null : message.keyEpoch,
  };
}

export async function processMessageSearchOutbox(
  outboxId: string,
  logger: {
    warn: (fields: Record<string, unknown>, message: string) => void;
  },
  metrics?: MessageSearchWorkerMetricSink
): Promise<void> {
  const startedAt = performance.now();
  let outcome: "indexed" | "retry" | "skipped" | "superseded" | "unreadable" =
    "retry";
  let queueAgeMs: number | undefined;
  let rows = 0;
  try {
    const outbox = await prisma.orm.public.MessageSearchOutbox.where({
      id: outboxId,
    }).first();
    if (!outbox || outbox.completedAt) {
      outcome = "skipped";
      return;
    }
    queueAgeMs = Math.max(
      0,
      Date.now() - fromPrismaDateTime(outbox.createdAt).getTime()
    );
    const message = await prisma.orm.public.Messages.where({
      conversationId: outbox.conversationId,
      id: outbox.messageId,
    }).first();
    rows = message ? 1 : 0;
    if (!message || message.deletedAt || message.revision !== outbox.revision) {
      const persisted = await persistSearchDocument({
        conversationId: outbox.conversationId,
        keyEpoch: message?.keyEpoch ?? 0,
        messageId: outbox.messageId,
        outboxId,
        references: [],
        revision: outbox.revision,
        terms: [],
      });
      outcome = persisted.status === "indexed" ? "indexed" : "superseded";
      return;
    }
    const context = await loadConversationSearchContext(outbox.conversationId);
    const result = await decryptSearchableMessage(
      outbox.conversationId,
      message,
      context
    );
    if (result.status === "indexed") {
      const persisted = await persistSearchDocument({
        conversationId: outbox.conversationId,
        epochProofs: result.epochProofs,
        keyEpoch: result.keyEpoch,
        messageId: message.id,
        outboxId,
        references: result.references,
        revision: message.revision,
        terms: result.terms,
      });
      outcome = persisted.status === "indexed" ? "indexed" : "superseded";
      return;
    }
    await markSearchOutboxUnreadable({
      changeSequence: outbox.changeSequence,
      conversationId: outbox.conversationId,
      outboxId,
      revision: outbox.revision,
      unrecoverableEpoch: result.unrecoverableEpoch,
    });
    logger.warn(
      { outboxId },
      "DM search item is waiting for a readable message-key epoch"
    );
    outcome = "unreadable";
  } finally {
    safelyRecordMessageSearchWorkerMetric(metrics, {
      durationMs: performance.now() - startedAt,
      job: "live-index",
      outcome,
      rows,
      ...(queueAgeMs === undefined ? {} : { queueAgeMs }),
    });
  }
}

export async function processMessageSearchBackfill(
  conversationId: string,
  logger: {
    warn: (fields: Record<string, unknown>, message: string) => void;
  },
  metrics?: MessageSearchWorkerMetricSink
): Promise<{ finished: boolean; nextCursorMessageId: string | null }> {
  const startedAt = performance.now();
  let outcome: "completed" | "retry" | "skipped" | "superseded" | "unreadable" =
    "retry";
  let rows = 0;
  let unreadableRows = 0;
  try {
    const backfill = await startMessageSearchBackfill(conversationId);
    if (
      !backfill ||
      backfill.completedAt ||
      backfill.throughSequence === null
    ) {
      outcome = "skipped";
      return { finished: true, nextCursorMessageId: null };
    }
    const batch = await readNextMessageSearchBackfillBatch(conversationId);
    if (!batch) {
      outcome = "skipped";
      return { finished: true, nextCursorMessageId: null };
    }
    rows = batch.messages.length;
    if (batch.messages.length === 0) {
      const context = await loadConversationSearchContext(conversationId);
      const epochs = [
        ...new Set(
          context.wraps
            .filter((wrap) => {
              const source = epochProofSource(wrap, context);
              const stored = context.storedEpochProofs.get(wrap.id);
              return (
                source &&
                (stored?.sourceFingerprint !== source.sourceFingerprint ||
                  stored.recoveryGeneration !== source.recoveryGeneration)
              );
            })
            .map((wrap) => wrap.version)
        ),
      ];
      const epochProofBatches = await mapConcurrent(
        epochs,
        MESSAGE_SEARCH_DECRYPT_CONCURRENCY,
        async (epoch) => {
          const representative = await prisma.orm.public.Messages.where({
            conversationId,
            deletedAt: null,
            keyEpoch: epoch,
          }).first();
          if (representative) {
            const authenticated = await decryptSearchableMessage(
              conversationId,
              representative,
              context
            );
            if (authenticated.status === "indexed") {
              return authenticated.epochProofs;
            }
          }
          const proofs = await mapConcurrent(
            context.wraps.filter((wrap) => wrap.version === epoch),
            MESSAGE_SEARCH_DECRYPT_CONCURRENCY,
            async (wrap) => {
              const source = epochProofSource(wrap, context);
              if (!source) {
                return null;
              }
              // Existing history requires authenticated message decryption; only an empty epoch can settle by unwrapping alone.
              const rootKey = representative
                ? null
                : await recoverWrappedRootKey(conversationId, wrap, context);
              return { ...source, readable: rootKey !== null };
            }
          );
          return proofs.filter(
            (proof): proof is MessageSearchEpochProof => proof !== null
          );
        }
      );
      const epochProofs = epochProofBatches.flat();
      const committed = await commitMessageSearchBackfillBatch({
        artifacts: [],
        conversationId,
        epochProofs,
        expectedPosition: batch.expectedPosition,
        finished: true,
        messageOutcomes: [],
        nextPosition: batch.expectedPosition,
        rowsTraversed: 0,
        throughSequence: batch.throughSequence,
      });
      outcome = committed.committed ? "completed" : "superseded";
      return { finished: committed.committed, nextCursorMessageId: null };
    }

    const context = await loadConversationSearchContext(conversationId);
    const decryptOutcomes = await mapConcurrent(
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
        if (result.status === "unreadable") {
          return {
            messageId: message.id,
            status: "unreadable" as const,
            unrecoverableEpoch: result.unrecoverableEpoch,
          };
        }
        return {
          artifact: {
            createdAt: message.createdAt,
            epochProofs: result.epochProofs,
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
    const artifacts = decryptOutcomes.flatMap((decryptOutcome) =>
      decryptOutcome?.status === "indexed" ? [decryptOutcome.artifact] : []
    );
    const unreadableMessages = decryptOutcomes.filter(
      (decryptOutcome) => decryptOutcome?.status === "unreadable"
    );
    unreadableRows = unreadableMessages.length;
    const messageOutcomes = batch.messages.map<MessageSearchBackfillOutcome>(
      (message, index) => {
        const decryptOutcome = decryptOutcomes[index];
        if (message.deletedAt) {
          return {
            keyEpoch: message.keyEpoch,
            messageId: message.id,
            revision: message.revision,
            status: "deleted",
            unrecoverableEpoch: false,
          };
        }
        if (decryptOutcome?.status === "indexed") {
          return {
            keyEpoch: decryptOutcome.artifact.keyEpoch,
            messageId: message.id,
            revision: message.revision,
            status: "indexed",
            unrecoverableEpoch: false,
          };
        }
        if (decryptOutcome?.status === "unreadable") {
          return {
            keyEpoch: message.keyEpoch,
            messageId: message.id,
            revision: message.revision,
            status: "unreadable",
            unrecoverableEpoch: decryptOutcome.unrecoverableEpoch !== null,
          };
        }
        throw new Error("DM search backfill omitted a message outcome");
      }
    );
    for (const unreadableMessage of unreadableMessages) {
      logger.warn(
        { conversationId, messageId: unreadableMessage.messageId },
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
      messageOutcomes,
      nextPosition: {
        createdAt: lastMessage.createdAt,
        messageId: lastMessage.id,
      },
      rowsTraversed: batch.messages.length,
      throughSequence: batch.throughSequence,
    });
    if (!committed.committed) {
      outcome = "superseded";
    } else if (unreadableRows > 0) {
      outcome = "unreadable";
    } else {
      outcome = "completed";
    }
    return {
      finished: false,
      nextCursorMessageId: committed.committed ? lastMessage.id : null,
    };
  } finally {
    safelyRecordMessageSearchWorkerMetric(metrics, {
      durationMs: performance.now() - startedAt,
      job: "backfill",
      outcome,
      rows,
      unreadableRows,
    });
  }
}

export function clearMessageSearchKeyCache(): void {
  privateKeyCache.clear();
  pendingPrivateKeyCache.clear();
  wrappedRootKeyCache.clear();
}
