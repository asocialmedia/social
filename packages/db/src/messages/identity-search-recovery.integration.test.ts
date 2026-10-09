import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  closeMessageSearchPool,
  commitMessageIdentityBackupRefresh,
  commitMessageSearchBackfillBatch,
  keys,
  listMessageConversationChanges,
  prisma,
  toPrismaDateTime,
} from "@asm/db";

const RUN_ID = crypto.randomUUID();
const OWNER_ID = `identity-search-owner-${RUN_ID}`;
const PEER_ID = `identity-search-peer-${RUN_ID}`;
const CONVERSATION_ID = crypto.randomUUID();
const EXPECTED_UPDATED_AT = new Date("2026-01-01T00:00:00.000Z");
const CURSOR_CREATED_AT = new Date("2026-01-02T00:00:00.000Z");
const NEXT_UPDATED_AT = new Date("2026-02-01T00:00:00.000Z");

function assertLocalTestDatabase(): void {
  const databaseUrl = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5433" ||
    databaseUrl.pathname.replace(/^\//, "") !== "asocialmedia"
  ) {
    throw new Error(
      "Refusing to run identity search recovery tests outside the local test database"
    );
  }
}

beforeAll(async () => {
  assertLocalTestDatabase();
  await prisma.transaction(async (tx) => {
    await tx.orm.public.Users.createAll([
      {
        displayName: OWNER_ID,
        email: `${OWNER_ID}@example.test`,
        id: OWNER_ID,
        username: OWNER_ID,
      },
      {
        displayName: PEER_ID,
        email: `${PEER_ID}@example.test`,
        id: PEER_ID,
        username: PEER_ID,
      },
    ]);
    await tx.orm.public.MessageConversations.create({
      changeSeq: 7,
      id: CONVERSATION_ID,
      pairKey: [OWNER_ID, PEER_ID].toSorted().join(":"),
    });
    await tx.orm.public.MessageConversationMembers.createAll([
      { conversationId: CONVERSATION_ID, userId: OWNER_ID },
      { conversationId: CONVERSATION_ID, userId: PEER_ID },
    ]);
    await tx.orm.public.MessageIdentities.create({
      encryptedPrivateKey: "old-iv.old-ciphertext",
      kdfIterations: 100_000,
      masterKeyHash: "old-master-key-hash",
      publicKey: "owner-public-key",
      salt: "old-salt",
      updatedAt: toPrismaDateTime(EXPECTED_UPDATED_AT),
      userId: OWNER_ID,
    });
    await tx.orm.public.MessageSearchAccountState.create({
      recoveryGeneration: 3,
      userId: OWNER_ID,
    });
    await tx.orm.public.MessageSearchCoverage.create({
      artifactsCommitted: 10,
      backfillCompletedAt: toPrismaDateTime(new Date("2026-01-03T00:00:00Z")),
      backfillCursorCreatedAt: toPrismaDateTime(CURSOR_CREATED_AT),
      backfillCursorMessageId: "previous-cursor-message",
      backfillStartedAt: toPrismaDateTime(new Date("2026-01-02T00:00:00Z")),
      backfillThroughSequence: 7,
      completedChangeSeq: 7,
      conversationId: CONVERSATION_ID,
      hasUnreadableMessages: true,
      rowsTraversed: 12,
      unrecoverableEpochIds: [1, 2],
      unrecoverableEpochs: 2,
    });
  });
});

afterAll(async () => {
  await prisma.orm.public.MessageSearchCoverage.where({
    conversationId: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageSearchAccountState.where({
    userId: OWNER_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageIdentities.where({
    userId: OWNER_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageConversationChanges.where({
    conversationId: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageConversations.where({
    id: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in([OWNER_ID, PEER_ID])
  ).deleteAndCount();
  await closeMessageSearchPool();
});

describe("commitMessageIdentityBackupRefresh", () => {
  test("restarts unreadable coverage and invalidates stale search scopes atomically", async () => {
    const result = await commitMessageIdentityBackupRefresh({
      encryptedPrivateKey: "new-iv.new-ciphertext",
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      kdfIterations: 600_000,
      masterKeyHash: "new-master-key-hash",
      nextUpdatedAt: NEXT_UPDATED_AT,
      publicKey: "owner-public-key",
      salt: "new-salt",
      userId: OWNER_ID,
    });

    expect(result).toEqual({
      recoveryGeneration: 4,
      repairConversationIds: [CONVERSATION_ID],
      status: "updated",
    });

    const [identity, conversation, coverage, state, changes] =
      await Promise.all([
        prisma.orm.public.MessageIdentities.where({ userId: OWNER_ID }).first(),
        prisma.orm.public.MessageConversations.where({
          id: CONVERSATION_ID,
        }).first(),
        prisma.orm.public.MessageSearchCoverage.where({
          conversationId: CONVERSATION_ID,
        }).first(),
        prisma.orm.public.MessageSearchAccountState.where({
          userId: OWNER_ID,
        }).first(),
        listMessageConversationChanges({
          afterSequence: 7,
          conversationId: CONVERSATION_ID,
          limit: 10,
          membershipWindows: [{ after: null, before: null }],
          snapshotSequence: 8,
          userId: OWNER_ID,
        }),
      ]);
    expect(identity).toMatchObject({
      encryptedPrivateKey: "new-iv.new-ciphertext",
      masterKeyHash: "new-master-key-hash",
      updatedAt: NEXT_UPDATED_AT,
    });
    expect(conversation?.changeSeq).toBe(8);
    expect(coverage).toMatchObject({
      artifactsCommitted: 10,
      backfillCompletedAt: null,
      backfillCursorCreatedAt: null,
      backfillCursorMessageId: null,
      backfillThroughSequence: 8,
      completedChangeSeq: 7,
      hasUnreadableMessages: true,
      rowsTraversed: 12,
      unrecoverableEpochIds: [1, 2],
      unrecoverableEpochs: 2,
    });
    expect(coverage?.backfillStartedAt).toBeTruthy();
    expect(state?.recoveryGeneration).toBe(4);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "recovery.changed",
      messageId: null,
      sequence: 8,
    });

    const staleBatch = await commitMessageSearchBackfillBatch({
      artifacts: [],
      conversationId: CONVERSATION_ID,
      expectedPosition: {
        createdAt: CURSOR_CREATED_AT,
        messageId: "previous-cursor-message",
      },
      finished: true,
      messageOutcomes: [],
      nextPosition: {
        createdAt: CURSOR_CREATED_AT,
        messageId: "previous-cursor-message",
      },
      rowsTraversed: 0,
      throughSequence: 7,
    });
    expect(staleBatch.committed).toBe(false);
  });

  test("does not mutate recovery state after an identity revision conflict", async () => {
    const result = await commitMessageIdentityBackupRefresh({
      encryptedPrivateKey: "stale-iv.stale-ciphertext",
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      kdfIterations: 100_000,
      masterKeyHash: "stale-master-key-hash",
      nextUpdatedAt: new Date("2026-03-01T00:00:00.000Z"),
      publicKey: "owner-public-key",
      salt: "stale-salt",
      userId: OWNER_ID,
    });

    expect(result).toEqual({ status: "conflict" });
    const [identity, conversation, coverage, state] = await Promise.all([
      prisma.orm.public.MessageIdentities.where({ userId: OWNER_ID }).first(),
      prisma.orm.public.MessageConversations.where({
        id: CONVERSATION_ID,
      }).first(),
      prisma.orm.public.MessageSearchCoverage.where({
        conversationId: CONVERSATION_ID,
      }).first(),
      prisma.orm.public.MessageSearchAccountState.where({
        userId: OWNER_ID,
      }).first(),
    ]);
    expect(identity?.masterKeyHash).toBe("new-master-key-hash");
    expect(conversation?.changeSeq).toBe(8);
    expect(coverage?.backfillThroughSequence).toBe(8);
    expect(state?.recoveryGeneration).toBe(4);
  });
});
