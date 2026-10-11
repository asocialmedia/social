import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  and,
  closeMessageSearchPool,
  commitMessageConversationRead,
  commitMessageHides,
  commitMessageSearchMutation,
  keys,
  listRunnableMessageUnreadCounters,
  prisma,
  reconcileMessageUnreadCounter,
  toPrismaDateTime,
} from "@asm/db";
import { Pool } from "pg";

const RUN_ID = crypto.randomUUID();
const OWNER_ID = `unread-counter-owner-${RUN_ID}`;
const PEER_ID = `unread-counter-peer-${RUN_ID}`;
const CONVERSATION_ID = crypto.randomUUID();
const MUTATION_CONVERSATION_ID = crypto.randomUUID();
const DEN_CONVERSATION_ID = crypto.randomUUID();
const INCOMING_ID = crypto.randomUUID();
const OWN_ID = crypto.randomUUID();
const DELETED_ID = crypto.randomUUID();
const HIDDEN_ID = crypto.randomUUID();
const MUTATED_ID = crypto.randomUUID();
const AFTER_READ_ID = crypto.randomUUID();
const DEN_OLD_ID = crypto.randomUUID();
const DEN_GAP_ID = crypto.randomUUID();
const DEN_CURRENT_ID = crypto.randomUUID();
const databasePool = new Pool({ connectionString: keys.DATABASE_URL, max: 1 });

function assertLocalTestDatabase(): void {
  const databaseUrl = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5433" ||
    databaseUrl.pathname.replace(/^\//, "") !== "asocialmedia"
  ) {
    throw new Error(
      "Refusing to run unread counter integration tests outside the local test database"
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
    await tx.orm.public.MessageConversations.createAll([
      {
        id: CONVERSATION_ID,
        pairKey: [OWNER_ID, PEER_ID].toSorted().join(":"),
      },
      {
        id: MUTATION_CONVERSATION_ID,
        pairKey: `${[OWNER_ID, PEER_ID].toSorted().join(":")}:mutation`,
      },
      {
        _type: "DEN",
        createdById: OWNER_ID,
        id: DEN_CONVERSATION_ID,
        name: `Unread counter den ${RUN_ID}`,
        ownerId: OWNER_ID,
      },
    ]);
    await tx.orm.public.MessageConversationMembers.createAll([
      {
        conversationId: CONVERSATION_ID,
        lastReadAt: toPrismaDateTime(new Date(0)),
        unreadCount: null,
        userId: OWNER_ID,
      },
      {
        conversationId: CONVERSATION_ID,
        lastReadAt: toPrismaDateTime(new Date(0)),
        unreadCount: 0,
        userId: PEER_ID,
      },
      {
        conversationId: MUTATION_CONVERSATION_ID,
        lastReadAt: toPrismaDateTime(new Date(0)),
        unreadCount: 1,
        userId: OWNER_ID,
      },
      {
        conversationId: MUTATION_CONVERSATION_ID,
        lastReadAt: toPrismaDateTime(new Date(0)),
        unreadCount: 0,
        userId: PEER_ID,
      },
      {
        conversationId: DEN_CONVERSATION_ID,
        createdAt: toPrismaDateTime(new Date("2026-01-01T00:00:00Z")),
        lastReadAt: toPrismaDateTime(new Date(0)),
        unreadCount: null,
        userId: OWNER_ID,
      },
      {
        conversationId: DEN_CONVERSATION_ID,
        unreadCount: 0,
        userId: PEER_ID,
      },
    ]);
    const createdAt = toPrismaDateTime(new Date());
    await tx.orm.public.Messages.createAll([
      {
        ciphertext: "ciphertext-incoming",
        conversationId: CONVERSATION_ID,
        createdAt,
        id: INCOMING_ID,
        iv: "iv-incoming",
        ratchetIndex: 0,
        senderId: PEER_ID,
      },
      {
        ciphertext: "ciphertext-own",
        conversationId: CONVERSATION_ID,
        createdAt,
        id: OWN_ID,
        iv: "iv-own",
        ratchetIndex: 1,
        senderId: OWNER_ID,
      },
      {
        ciphertext: "ciphertext-deleted",
        conversationId: CONVERSATION_ID,
        createdAt,
        deletedAt: createdAt,
        id: DELETED_ID,
        iv: "iv-deleted",
        ratchetIndex: 2,
        senderId: PEER_ID,
      },
      {
        ciphertext: "ciphertext-hidden",
        conversationId: CONVERSATION_ID,
        createdAt,
        id: HIDDEN_ID,
        iv: "iv-hidden",
        ratchetIndex: 3,
        senderId: PEER_ID,
      },
      {
        ciphertext: "ciphertext-mutation",
        conversationId: MUTATION_CONVERSATION_ID,
        createdAt,
        id: MUTATED_ID,
        iv: "iv-mutation",
        ratchetIndex: 0,
        senderId: PEER_ID,
      },
    ]);
    await tx.orm.public.MessageHiddens.create({
      messageId: HIDDEN_ID,
      userId: OWNER_ID,
    });
    await tx.orm.public.MessageConversationMembershipEvents.createAll([
      {
        action: "JOINED",
        actorId: OWNER_ID,
        actorName: OWNER_ID,
        conversationId: DEN_CONVERSATION_ID,
        createdAt: toPrismaDateTime(new Date("2026-01-01T00:00:00Z")),
        targetName: OWNER_ID,
        targetUserId: OWNER_ID,
      },
      {
        action: "LEFT",
        actorId: OWNER_ID,
        actorName: OWNER_ID,
        conversationId: DEN_CONVERSATION_ID,
        createdAt: toPrismaDateTime(new Date("2026-01-02T00:00:00Z")),
        targetName: OWNER_ID,
        targetUserId: OWNER_ID,
      },
      {
        action: "JOINED",
        actorId: OWNER_ID,
        actorName: OWNER_ID,
        conversationId: DEN_CONVERSATION_ID,
        createdAt: toPrismaDateTime(new Date("2026-01-03T00:00:00Z")),
        targetName: OWNER_ID,
        targetUserId: OWNER_ID,
      },
    ]);
    await tx.orm.public.Messages.createAll([
      {
        ciphertext: "den-before-leave",
        conversationId: DEN_CONVERSATION_ID,
        createdAt: toPrismaDateTime(new Date("2026-01-01T12:00:00Z")),
        id: DEN_OLD_ID,
        iv: "den-old-iv",
        ratchetIndex: 0,
        senderId: PEER_ID,
      },
      {
        ciphertext: "den-during-gap",
        conversationId: DEN_CONVERSATION_ID,
        createdAt: toPrismaDateTime(new Date("2026-01-02T12:00:00Z")),
        id: DEN_GAP_ID,
        iv: "den-gap-iv",
        ratchetIndex: 1,
        senderId: PEER_ID,
      },
      {
        ciphertext: "den-after-rejoin",
        conversationId: DEN_CONVERSATION_ID,
        createdAt: toPrismaDateTime(new Date("2026-01-03T12:00:00Z")),
        id: DEN_CURRENT_ID,
        iv: "den-current-iv",
        ratchetIndex: 2,
        senderId: PEER_ID,
      },
    ]);
  });
});

afterAll(async () => {
  await prisma.orm.public.MessageSearchOutbox.where((row) =>
    row.conversationId.in([
      CONVERSATION_ID,
      MUTATION_CONVERSATION_ID,
      DEN_CONVERSATION_ID,
    ])
  ).deleteAndCount();
  await prisma.orm.public.MessageConversationChanges.where((row) =>
    row.conversationId.in([
      CONVERSATION_ID,
      MUTATION_CONVERSATION_ID,
      DEN_CONVERSATION_ID,
    ])
  ).deleteAndCount();
  await prisma.orm.public.MessageConversations.where((conversation) =>
    conversation.id.in([
      CONVERSATION_ID,
      MUTATION_CONVERSATION_ID,
      DEN_CONVERSATION_ID,
    ])
  ).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in([OWNER_ID, PEER_ID])
  ).deleteAndCount();
  await databasePool.end();
  await closeMessageSearchPool();
});

describe("transactional unread message counters", () => {
  test("reconciles null counters from visible message state and ignores own, deleted, and hidden rows", async () => {
    const pending = await listRunnableMessageUnreadCounters(10);
    expect(pending).toContainEqual({
      conversationId: CONVERSATION_ID,
      userId: OWNER_ID,
    });

    await expect(
      reconcileMessageUnreadCounter({
        conversationId: CONVERSATION_ID,
        userId: OWNER_ID,
      })
    ).resolves.toBe(1);

    const member = await prisma.orm.public.MessageConversationMembers.select(
      "unreadCount"
    )
      .where((row) =>
        and(row.conversationId.eq(CONVERSATION_ID), row.userId.eq(OWNER_ID))
      )
      .first();
    expect(member?.unreadCount).toBe(1);
  });

  test("a stale reconciliation job cannot replace the read transaction's zero", async () => {
    await prisma.orm.public.Messages.create({
      ciphertext: "ciphertext-after-reconcile",
      conversationId: CONVERSATION_ID,
      id: crypto.randomUUID(),
      iv: "iv-after-reconcile",
      ratchetIndex: 4,
      senderId: PEER_ID,
    });
    const result = await commitMessageConversationRead({
      conversationId: CONVERSATION_ID,
      membershipWindows: [{ after: null, before: null }],
      userId: OWNER_ID,
    });
    expect(result).toMatchObject({ status: "read", unreadCount: 2 });

    await expect(
      reconcileMessageUnreadCounter({
        conversationId: CONVERSATION_ID,
        userId: OWNER_ID,
      })
    ).resolves.toBe(0);

    const member = await prisma.orm.public.MessageConversationMembers.select(
      "unreadCount"
    )
      .where((row) =>
        and(row.conversationId.eq(CONVERSATION_ID), row.userId.eq(OWNER_ID))
      )
      .first();
    expect(member?.unreadCount).toBe(0);
  });

  test("global deletion invalidates initialized counters and reconciliation repairs them", async () => {
    const mutation = await commitMessageSearchMutation({
      conversationId: MUTATION_CONVERSATION_ID,
      deletedAt: new Date(),
      expectedRevision: 1,
      kind: "delete",
      messageId: MUTATED_ID,
      senderId: PEER_ID,
    });
    expect(mutation.status).toBe("updated");

    const invalidated =
      await prisma.orm.public.MessageConversationMembers.select("unreadCount")
        .where((row) =>
          and(
            row.conversationId.eq(MUTATION_CONVERSATION_ID),
            row.userId.eq(OWNER_ID)
          )
        )
        .first();
    expect(invalidated?.unreadCount).toBeNull();

    await expect(
      reconcileMessageUnreadCounter({
        conversationId: MUTATION_CONVERSATION_ID,
        userId: OWNER_ID,
      })
    ).resolves.toBe(0);
  });

  test("den reconciliation counts only the current membership stint", async () => {
    await expect(
      reconcileMessageUnreadCounter({
        conversationId: DEN_CONVERSATION_ID,
        userId: OWNER_ID,
      })
    ).resolves.toBe(1);

    const member = await prisma.orm.public.MessageConversationMembers.select(
      "unreadCount"
    )
      .where((row) =>
        and(row.conversationId.eq(DEN_CONVERSATION_ID), row.userId.eq(OWNER_ID))
      )
      .first();
    expect(member?.unreadCount).toBe(1);
  });

  test("private hides invalidate only the viewer's counter and can be replayed safely", async () => {
    await prisma.orm.public.Messages.create({
      ciphertext: "ciphertext-after-read",
      conversationId: CONVERSATION_ID,
      createdAt: toPrismaDateTime(new Date(Date.now() + 5000)),
      id: AFTER_READ_ID,
      iv: "iv-after-read",
      ratchetIndex: 5,
      senderId: PEER_ID,
    });
    const hidden = await commitMessageHides({
      conversationId: CONVERSATION_ID,
      membershipWindows: [{ after: null, before: null }],
      messageIds: [AFTER_READ_ID],
      userId: OWNER_ID,
    });
    expect(hidden).toMatchObject({ status: "committed", unreadDecrement: 1 });
    await expect(
      reconcileMessageUnreadCounter({
        conversationId: CONVERSATION_ID,
        userId: OWNER_ID,
      })
    ).resolves.toBe(0);
    await expect(
      reconcileMessageUnreadCounter({
        conversationId: CONVERSATION_ID,
        userId: OWNER_ID,
      })
    ).resolves.toBe(0);

    const peer = await prisma.orm.public.MessageConversationMembers.select(
      "unreadCount"
    )
      .where((row) =>
        and(row.conversationId.eq(CONVERSATION_ID), row.userId.eq(PEER_ID))
      )
      .first();
    expect(peer?.unreadCount).toBe(0);
  });
});
