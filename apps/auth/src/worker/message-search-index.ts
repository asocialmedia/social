import {
  markSearchOutboxUnreadable,
  persistSearchDocument,
  prisma,
} from "@asm/db";
import type { SearchTermArtifact } from "@asm/db";
import {
  decryptMessage,
  decryptWithMasterKey,
  deriveMasterKey,
  importPrivateKeyJwk,
  importPublicKeyJwk,
  messageSearchGramKeys,
  messageSearchTerms,
  publicKeyBase64ToJwk,
  searchableTextFromPayload,
  unwrapRootKey,
} from "@asm/messages";

const PRIVATE_KEY_CACHE_CAPACITY = 128;
const PRIVATE_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedPrivateKey {
  expiresAt: number;
  identityVersion: string;
  key: CryptoKey;
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
    const key = await importPrivateKeyJwk(privateKeyJwk);
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
    return key;
  } catch {
    return null;
  }
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
      revision: outbox.revision,
      terms: [],
    });
    return;
  }

  const members = await prisma.orm.public.MessageConversationMembers.select(
    "userId"
  )
    .where({ conversationId: outbox.conversationId })
    .all();
  const memberIds = members.map((member) => member.userId);
  const [conversation, identities, wraps] = await Promise.all([
    prisma.orm.public.MessageConversations.select("_type")
      .where({ id: outbox.conversationId })
      .first(),
    prisma.orm.public.MessageIdentities.where((identity) =>
      identity.userId.in(memberIds)
    ).all(),
    prisma.orm.public.MessageConversationKeys.where({
      conversationId: outbox.conversationId,
    }).all(),
  ]);
  const identityByUserId = new Map(
    identities.map((identity) => [identity.userId, identity])
  );
  const epochCandidates = wraps.filter(
    (wrap) => message.keyEpoch === null || wrap.version === message.keyEpoch
  );

  // oxlint-disable no-await-in-loop -- each authenticated wrap attempt depends on the prior failure result
  for (const wrap of epochCandidates) {
    const identity = identityByUserId.get(wrap.ownerUserId);
    if (!identity) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- wrap decryption must stop at the first authenticated epoch
    const privateKey = await recoverPrivateKey(identity);
    if (!privateKey) {
      continue;
    }
    const legacyDmWrapperId =
      conversation?._type === "DM"
        ? memberIds.find((memberId) => memberId !== wrap.ownerUserId)
        : undefined;
    const wrapperPublicKey =
      wrap.wrapperPublicKey ??
      identityByUserId.get(wrap.wrapperUserId ?? legacyDmWrapperId ?? "")
        ?.publicKey;
    if (!wrapperPublicKey) {
      continue;
    }
    try {
      const rootKey = await unwrapRootKey(
        privateKey,
        await importPublicKeyJwk(publicKeyBase64ToJwk(wrapperPublicKey)),
        outbox.conversationId,
        { ciphertext: wrap.encryptedKey, iv: wrap.iv }
      );
      const payload = await decryptMessage(
        rootKey,
        message.senderId,
        outbox.conversationId,
        message
      );
      const text = searchableTextFromPayload(payload);
      const terms: SearchTermArtifact[] = messageSearchTerms(text).map(
        (normalized) => ({
          gramKeys: messageSearchGramKeys(normalized),
          normalized,
        })
      );
      await persistSearchDocument({
        conversationId: outbox.conversationId,
        keyEpoch: wrap.version,
        messageId: message.id,
        outboxId,
        revision: message.revision,
        terms,
      });
      return;
    } catch {
      // Another wrap may be the authenticated epoch for this message.
    }
  }
  // oxlint-enable no-await-in-loop

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

export function clearMessageSearchKeyCache(): void {
  privateKeyCache.clear();
}
