import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  closeMessageSearchPool,
  commitMessageIdentityBackupRefresh,
  fromPrismaDateTime,
  countMessageSearchCandidates,
  hydrateSearchMessageCandidates,
  keys,
  listRunnableMessageSearchOutbox,
  listMessageSearchReferences,
  persistSearchDocument,
  prisma,
  recordMessageSearchOutboxFailure,
  readMessageSearchViewerEpochCoverage,
  searchMessageCandidates,
  toPrismaDateTime,
} from "@asm/db";
import {
  KDF_ITERATIONS,
  deriveMasterKey,
  encryptMessage,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateAccountSecret,
  generateIdentityKeyPair,
  generateRootKey,
  hashAccountSecret,
  publicKeyJwkToBase64,
  wrapRootKey,
  wrapRootKeyForMembers,
} from "@asm/messages/crypto";
import { messageSearchGramKeys } from "@asm/messages/normalization";

import {
  clearMessageSearchKeyCache,
  processMessageSearchBackfill,
  processMessageSearchOutbox,
} from "./message-search-index";

const runId = crypto.randomUUID();
const conversationId = crypto.randomUUID();
const messageId = crypto.randomUUID();
const outboxId = crypto.randomUUID();
const ownerId = `epoch-owner-${runId}`;
const peerId = `epoch-peer-${runId}`;
const content = "Résumé 東京 https://example.test/needle";
const fragments = [{ grams: messageSearchGramKeys("needle"), text: "needle" }];
const membershipWindows = [{ after: null, before: null }];
const logger = { warn: () => {} };

async function makeIdentity(userId: string) {
  const pair = await generateIdentityKeyPair();
  const masterKeyHash = await hashAccountSecret(generateAccountSecret());
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const backup = await encryptWithMasterKey(
    await deriveMasterKey(masterKeyHash, salt, KDF_ITERATIONS),
    JSON.stringify(await exportPrivateKeyJwk(pair.privateKey))
  );
  return {
    identity: {
      encryptedPrivateKey: `${backup.iv}.${backup.ciphertext}`,
      kdfIterations: KDF_ITERATIONS,
      masterKeyHash,
      publicKey: publicKeyJwkToBase64(await exportPublicKeyJwk(pair.publicKey)),
      salt: Buffer.from(salt).toString("base64"),
      userId,
    },
    pair,
  };
}

let rootKey: Uint8Array;
let owner: Awaited<ReturnType<typeof makeIdentity>>;
let peer: Awaited<ReturnType<typeof makeIdentity>>;
let originalOwnerWrap: { id: string; encryptedKey: string; iv: string };

async function searchInput(userId: string) {
  const conversation = await prisma.orm.public.MessageConversations.where({
    id: conversationId,
  }).first();
  return {
    conversationId,
    fragments,
    limit: 20,
    membershipWindows,
    snapshotSequence: conversation?.changeSeq ?? 0,
    userId,
  };
}

async function searchIds(userId: string) {
  const candidates = await searchMessageCandidates(await searchInput(userId));
  return candidates.map((row) => row.id);
}

async function settleBackfill(): Promise<void> {
  // oxlint-disable no-await-in-loop -- This tiny fixture deliberately traverses the resumable worker protocol.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await processMessageSearchBackfill(conversationId, logger);
    if (result.finished) {
      return;
    }
  }
  // oxlint-enable no-await-in-loop
  throw new Error("Fixture backfill did not settle");
}

beforeAll(async () => {
  const database = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(database.hostname) ||
    database.port !== "5433" ||
    database.pathname !== "/asocialmedia"
  ) {
    throw new Error(
      "Epoch integration fixtures require the local test database"
    );
  }
  [owner, peer] = await Promise.all([
    makeIdentity(ownerId),
    makeIdentity(peerId),
  ]);
  rootKey = generateRootKey();
  const fanout = await wrapRootKeyForMembers(
    owner.pair.privateKey,
    [owner, peer].map((member) => ({
      publicKeyBase64: member.identity.publicKey,
      userId: member.identity.userId,
    })),
    conversationId,
    rootKey
  );
  expect(fanout.skipped).toEqual([]);
  const encrypted = await encryptMessage(rootKey, peerId, 1, conversationId, {
    content,
    type: "text",
  });
  await prisma.transaction(async (tx) => {
    await tx.orm.public.Users.createAll(
      [ownerId, peerId].map((id) => ({
        displayName: id,
        email: `${id}@example.test`,
        id,
        username: id,
      }))
    );
    await tx.orm.public.MessageIdentities.createAll([
      owner.identity,
      peer.identity,
    ]);
    await tx.orm.public.MessageConversations.create({
      changeSeq: 1,
      id: conversationId,
      pairKey: [ownerId, peerId].toSorted().join(":"),
    });
    await tx.orm.public.MessageConversationMembers.createAll(
      [ownerId, peerId].map((userId) => ({ conversationId, userId }))
    );
    await tx.orm.public.MessageConversationKeys.createAll(
      fanout.wrapped.map((wrap) => ({
        conversationId,
        encryptedKey: wrap.encryptedKey.ciphertext,
        iv: wrap.encryptedKey.iv,
        ownerUserId: wrap.userId,
        version: 1,
        wrapperPublicKey: owner.identity.publicKey,
        wrapperUserId: ownerId,
      }))
    );
    await tx.orm.public.Messages.create({
      conversationId,
      creationSequence: 1,
      id: messageId,
      keyEpoch: 1,
      senderId: peerId,
      ...encrypted,
    });
    await tx.orm.public.MessageSearchOutbox.create({
      changeSequence: 1,
      conversationId,
      id: outboxId,
      kind: "upsert",
      messageId,
      revision: 1,
    });
  });
  const wrap = await prisma.orm.public.MessageConversationKeys.where({
    conversationId,
    ownerUserId: ownerId,
    version: 1,
  }).first();
  if (!wrap) {
    throw new Error("Owner fixture wrap missing");
  }
  originalOwnerWrap = wrap;
});

afterAll(async () => {
  clearMessageSearchKeyCache();
  await prisma.orm.public.MessageSearchReferences.where({
    conversationId,
  }).deleteAndCount();
  await prisma.orm.public.MessageSearchDocuments.where({
    conversationId,
  }).deleteAndCount();
  await prisma.orm.public.MessageSearchTerms.where({
    conversationId,
  }).deleteAndCount();
  await prisma.orm.public.MessageSearchOutbox.where({
    conversationId,
  }).deleteAndCount();
  await prisma.orm.public.MessageSearchCoverage.where({
    conversationId,
  }).deleteAndCount();
  await prisma.orm.public.MessageConversationChanges.where({
    conversationId,
  }).deleteAndCount();
  await prisma.orm.public.MessageConversations.where({
    id: conversationId,
  }).deleteAndCount();
  await prisma.orm.public.MessageSearchAccountState.where((account) =>
    account.userId.in([ownerId, peerId])
  ).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in([ownerId, peerId])
  ).deleteAndCount();
  await closeMessageSearchPool();
});

describe("authenticated viewer epoch indexing", () => {
  test("recovers stored identities, authenticates ciphertext and admits only verified viewers", async () => {
    expect(await searchIds(ownerId)).toEqual([]);
    await processMessageSearchOutbox(outboxId, logger);
    expect(await searchIds(ownerId)).toEqual([messageId]);
    expect(await searchIds(peerId)).toEqual([messageId]);
    expect(await countMessageSearchCandidates(await searchInput(ownerId))).toBe(
      1
    );
    const proofs = await prisma.orm.public.MessageSearchEpochReadability.where({
      conversationId,
    }).all();
    expect(proofs).toHaveLength(2);
    expect(proofs.every((proof) => proof.readable)).toBe(true);
    expect(JSON.stringify(proofs)).not.toContain(content);
    await processMessageSearchOutbox(outboxId, logger);
    expect(await searchIds(ownerId)).toEqual([messageId]);
    await settleBackfill();
  });

  test("immediately excludes a corrupted own wrap from hits, counts, references and hydration", async () => {
    await prisma.orm.public.MessageConversationKeys.where({
      id: originalOwnerWrap.id,
    }).update({ encryptedKey: "corrupt-wrap" });
    try {
      expect(await searchIds(ownerId)).toEqual([]);
      expect(
        await countMessageSearchCandidates(await searchInput(ownerId))
      ).toBe(0);
      expect(
        await hydrateSearchMessageCandidates({
          conversationId,
          membershipWindows,
          messages: [{ id: messageId, revision: 1 }],
          userId: ownerId,
        })
      ).toEqual([]);
      expect(
        await listMessageSearchReferences({
          ...(await searchInput(ownerId)),
          kind: "link",
        })
      ).toEqual([]);
      expect(await searchIds(peerId)).toEqual([messageId]);
      const pendingCoverage = await readMessageSearchViewerEpochCoverage(
        conversationId,
        ownerId
      );
      expect(pendingCoverage.pending).toBe(1);
      await settleBackfill();
      expect(
        await readMessageSearchViewerEpochCoverage(conversationId, ownerId)
      ).toEqual({ pending: 0, unavailable: 1 });
    } finally {
      await prisma.orm.public.MessageConversationKeys.where({
        id: originalOwnerWrap.id,
      }).update({
        encryptedKey: originalOwnerWrap.encryptedKey,
        iv: originalOwnerWrap.iv,
      });
      await settleBackfill();
    }
    expect(await searchIds(ownerId)).toEqual([messageId]);
  });

  test("rejects a valid authenticated wrap containing a different root key", async () => {
    const wrongWrap = await wrapRootKey(
      owner.pair.privateKey,
      owner.pair.publicKey,
      conversationId,
      generateRootKey()
    );
    await prisma.orm.public.MessageConversationKeys.where({
      id: originalOwnerWrap.id,
    }).update({ encryptedKey: wrongWrap.ciphertext, iv: wrongWrap.iv });
    try {
      await settleBackfill();
      expect(await searchIds(ownerId)).toEqual([]);
      expect(await searchIds(peerId)).toEqual([messageId]);
      expect(
        await readMessageSearchViewerEpochCoverage(conversationId, ownerId)
      ).toEqual({ pending: 0, unavailable: 1 });
    } finally {
      await prisma.orm.public.MessageConversationKeys.where({
        id: originalOwnerWrap.id,
      }).update({
        encryptedKey: originalOwnerWrap.encryptedKey,
        iv: originalOwnerWrap.iv,
      });
      await settleBackfill();
    }
  });

  test("fences recovery generations and refuses a stale proof after revalidation", async () => {
    const oldProof =
      await prisma.orm.public.MessageSearchEpochReadability.where({
        wrapId: originalOwnerWrap.id,
      }).first();
    if (!oldProof) {
      throw new Error("Expected an authenticated epoch proof");
    }
    await prisma.orm.public.MessageSearchAccountState.create({
      recoveryGeneration: 1,
      userId: ownerId,
    });
    expect(await searchIds(ownerId)).toEqual([]);
    expect(await searchIds(peerId)).toEqual([messageId]);
    await settleBackfill();
    await persistSearchDocument({
      conversationId,
      epochProofs: [{ ...oldProof, readable: false }],
      keyEpoch: 1,
      messageId,
      outboxId,
      references: [],
      revision: 1,
      terms: [
        { gramKeys: messageSearchGramKeys("needle"), normalized: "needle" },
      ],
    });
    const current = await prisma.orm.public.MessageSearchEpochReadability.where(
      { wrapId: originalOwnerWrap.id }
    ).first();
    expect(current?.recoveryGeneration).toBe(1);
    expect(current?.readable).toBe(true);
    expect(await searchIds(ownerId)).toEqual([messageId]);
  });

  test("does not trust a recoverable backup paired with a different stored public key", async () => {
    await prisma.orm.public.MessageIdentities.where({ userId: ownerId }).update(
      { publicKey: peer.identity.publicKey }
    );
    try {
      await settleBackfill();
      expect(await searchIds(ownerId)).toEqual([]);
      expect(await searchIds(peerId)).toEqual([messageId]);
    } finally {
      await prisma.orm.public.MessageIdentities.where({
        userId: ownerId,
      }).update({ publicKey: owner.identity.publicKey });
      await settleBackfill();
    }
  });

  test("verifies legacy DM wraps without wrapper metadata using the peer public key", async () => {
    const legacyWrap = await wrapRootKey(
      owner.pair.privateKey,
      peer.pair.publicKey,
      conversationId,
      rootKey
    );
    await prisma.orm.public.MessageConversationKeys.where({
      id: originalOwnerWrap.id,
    }).update({
      encryptedKey: legacyWrap.ciphertext,
      iv: legacyWrap.iv,
      wrapperPublicKey: null,
      wrapperUserId: null,
    });
    try {
      await settleBackfill();
      expect(await searchIds(ownerId)).toEqual([messageId]);
      expect(
        await readMessageSearchViewerEpochCoverage(conversationId, ownerId)
      ).toEqual({ pending: 0, unavailable: 0 });
    } finally {
      await prisma.orm.public.MessageConversationKeys.where({
        id: originalOwnerWrap.id,
      }).update({
        encryptedKey: originalOwnerWrap.encryptedKey,
        iv: originalOwnerWrap.iv,
        wrapperPublicKey: owner.identity.publicKey,
        wrapperUserId: ownerId,
      });
      await settleBackfill();
    }
  });

  test("refreshes a viewer backup even when a peer already completed shared indexing", async () => {
    await prisma.orm.public.MessageIdentities.where({ userId: ownerId }).update(
      { masterKeyHash: "f".repeat(64) }
    );
    await settleBackfill();
    expect(await searchIds(ownerId)).toEqual([]);
    expect(await searchIds(peerId)).toEqual([messageId]);
    const identity = await prisma.orm.public.MessageIdentities.where({
      userId: ownerId,
    }).first();
    if (!identity) {
      throw new Error("Missing identity for legacy refresh fixture");
    }
    const refreshed = await commitMessageIdentityBackupRefresh({
      ...owner.identity,
      expectedUpdatedAt: fromPrismaDateTime(identity.updatedAt),
      nextUpdatedAt: new Date(Date.now() + 1),
    });
    expect(refreshed.status).toBe("updated");
    if (refreshed.status === "updated") {
      expect(refreshed.repairConversationIds).toContain(conversationId);
    }
    await settleBackfill();
    expect(await searchIds(ownerId)).toEqual([messageId]);
    expect(await searchIds(peerId)).toEqual([messageId]);
  });

  test("settles unused epochs and deletes their derived proofs with their wraps", async () => {
    const fanout = await wrapRootKeyForMembers(
      owner.pair.privateKey,
      [owner, peer].map((member) => ({
        publicKeyBase64: member.identity.publicKey,
        userId: member.identity.userId,
      })),
      conversationId,
      generateRootKey()
    );
    await prisma.orm.public.MessageConversationKeys.createAll(
      fanout.wrapped.map((wrap) => ({
        conversationId,
        encryptedKey: wrap.encryptedKey.ciphertext,
        iv: wrap.encryptedKey.iv,
        ownerUserId: wrap.userId,
        version: 2,
        wrapperPublicKey: owner.identity.publicKey,
        wrapperUserId: ownerId,
      }))
    );
    await settleBackfill();
    expect(
      await readMessageSearchViewerEpochCoverage(conversationId, ownerId)
    ).toEqual({ pending: 0, unavailable: 0 });
    await prisma.orm.public.MessageConversationKeys.where({
      conversationId,
      version: 2,
    }).deleteAndCount();
    expect(
      await prisma.orm.public.MessageSearchEpochReadability.where({
        conversationId,
        keyEpoch: 2,
      }).all()
    ).toEqual([]);
  });

  test("rolls back proofs, documents and references when an artifact write fails", async () => {
    const proof = await prisma.orm.public.MessageSearchEpochReadability.where({
      wrapId: originalOwnerWrap.id,
    }).first();
    if (!proof) {
      throw new Error("Expected a verified proof before the fault");
    }
    const failedOutboxId = crypto.randomUUID();
    await prisma.orm.public.MessageSearchOutbox.create({
      changeSequence: 1,
      conversationId,
      id: failedOutboxId,
      kind: "upsert",
      messageId,
      revision: 1,
    });
    await expect(
      persistSearchDocument({
        conversationId,
        epochProofs: [{ ...proof, readable: false }],
        keyEpoch: 1,
        messageId,
        outboxId: failedOutboxId,
        references: [
          { kind: "link", ordinal: 0 },
          { kind: "link", ordinal: 0 },
        ],
        revision: 1,
        terms: [
          {
            gramKeys: messageSearchGramKeys("rollback-only"),
            normalized: "rollback-only",
          },
        ],
      })
    ).rejects.toThrow();
    const restoredProof =
      await prisma.orm.public.MessageSearchEpochReadability.where({
        wrapId: originalOwnerWrap.id,
      }).first();
    expect(restoredProof?.readable).toBe(true);
    const failedOutbox = await prisma.orm.public.MessageSearchOutbox.where({
      id: failedOutboxId,
    }).first();
    expect(failedOutbox?.completedAt).toBeNull();
    expect(
      await prisma.orm.public.MessageSearchTerms.where({
        conversationId,
        normalized: "rollback-only",
      }).all()
    ).toEqual([]);
    expect(await searchIds(ownerId)).toEqual([messageId]);
  });

  test("caps failing outbox retries and keeps later work runnable", async () => {
    const repairIds = Array.from({ length: 100 }, () => crypto.randomUUID());
    await prisma.orm.public.MessageSearchOutbox.createAll(
      repairIds.map((id, index) => ({
        attempts: 8,
        changeSequence: 1,
        conversationId,
        createdAt: toPrismaDateTime(
          new Date(Date.UTC(2020, 0, 1, 0, 0, index))
        ),
        id,
        kind: "upsert",
        messageId,
        revision: 1,
      }))
    );
    const runnableId = crypto.randomUUID();
    await prisma.orm.public.MessageSearchOutbox.create({
      changeSequence: 1,
      conversationId,
      createdAt: toPrismaDateTime(new Date("2026-10-10T00:00:00.000Z")),
      id: runnableId,
      kind: "upsert",
      messageId,
      revision: 1,
    });

    const runnable = await listRunnableMessageSearchOutbox({
      includeBackfill: true,
      limit: 100,
      maxAttempts: 8,
    });
    expect(runnable.map((row) => row.id)).toContain(runnableId);
    expect(runnable.map((row) => row.id)).not.toContain(repairIds[0]);

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        recordMessageSearchOutboxFailure(runnableId, 8)
      )
    );
    expect(
      attempts.toSorted((left, right) => (left ?? 0) - (right ?? 0))
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await recordMessageSearchOutboxFailure(runnableId, 8)).toBeNull();
    expect(
      await prisma.orm.public.MessageSearchOutbox.where({ id: runnableId })
        .select("attempts", "completedAt")
        .first()
    ).toEqual({ attempts: 8, completedAt: null });
  });

  test("removing the resetting member's wraps leaves the peer's old epoch searchable", async () => {
    await prisma.orm.public.MessageConversationKeys.where({
      conversationId,
      ownerUserId: ownerId,
    }).deleteAndCount();
    await prisma.orm.public.MessageIdentities.where({
      userId: ownerId,
    }).deleteAndCount();
    expect(await searchIds(ownerId)).toEqual([]);
    expect(await searchIds(peerId)).toEqual([messageId]);
    expect(
      await prisma.orm.public.MessageSearchEpochReadability.where({
        conversationId,
        userId: ownerId,
      }).all()
    ).toEqual([]);
  });
});
