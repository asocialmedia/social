import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  closeMessageSearchPool,
  listMessageConversationChanges,
  commitMessageSearchMutation,
  keys,
  prisma,
} from "@asm/db";

const RUN_ID = crypto.randomUUID();
const CONVERSATION_ID = crypto.randomUUID();
const OWNER_ID = `search-mutation-owner-${RUN_ID}`;
const PEER_ID = `search-mutation-peer-${RUN_ID}`;
const MESSAGE_ID = crypto.randomUUID();
const OUTBOX_IDS: string[] = [];

function assertLocalTestDatabase(): void {
  const databaseUrl = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5433" ||
    databaseUrl.pathname.replace(/^\//, "") !== "asocialmedia"
  ) {
    throw new Error(
      "Refusing to run DM search mutation integration tests outside the local test database"
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
      id: CONVERSATION_ID,
      pairKey: [OWNER_ID, PEER_ID].toSorted().join(":"),
    });
    await tx.orm.public.MessageConversationMembers.createAll(
      [OWNER_ID, PEER_ID].map((userId) => ({
        conversationId: CONVERSATION_ID,
        userId,
      }))
    );
    await tx.orm.public.Messages.create({
      ciphertext: "test-ciphertext",
      conversationId: CONVERSATION_ID,
      id: MESSAGE_ID,
      iv: "test-iv",
      ratchetIndex: 0,
      senderId: OWNER_ID,
    });
  });
});

afterAll(async () => {
  if (OUTBOX_IDS.length > 0) {
    await prisma.orm.public.MessageSearchOutbox.where((outbox) =>
      outbox.id.in(OUTBOX_IDS)
    ).deleteAndCount();
  }
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

describe("commitMessageSearchMutation", () => {
  test("commits the revision, sequence, and outbox event as one mutation", async () => {
    const editRequests = await Promise.all(
      ["rewrite-a", "rewrite-b"].map((ciphertext) =>
        commitMessageSearchMutation({
          ciphertext,
          conversationId: CONVERSATION_ID,
          editWindowStart: new Date(Date.now() - 12 * 60 * 60 * 1000),
          editedAt: new Date(),
          expectedRevision: 1,
          iv: `${ciphertext}-iv`,
          kind: "upsert",
          messageId: MESSAGE_ID,
          senderId: OWNER_ID,
        })
      )
    );
    const edited = editRequests.find((result) => result.status === "updated");
    if (!edited || edited.status !== "updated") {
      throw new Error("expected one concurrent edit to commit");
    }
    expect(edited.status).toBe("updated");
    expect(
      editRequests.filter((result) => result.status === "revision-conflict")
    ).toHaveLength(1);
    OUTBOX_IDS.push(edited.outboxId);
    expect(edited.revision).toBe(2);
    expect(edited.changeSequence).toBe(1);

    const deleted = await commitMessageSearchMutation({
      conversationId: CONVERSATION_ID,
      deletedAt: new Date(),
      expectedRevision: 2,
      kind: "delete",
      messageId: MESSAGE_ID,
      senderId: OWNER_ID,
    });
    expect(deleted.status).toBe("updated");
    if (deleted.status !== "updated") {
      throw new Error("expected delete to commit");
    }
    OUTBOX_IDS.push(deleted.outboxId);
    expect(deleted.revision).toBe(3);
    expect(deleted.changeSequence).toBe(2);

    const duplicateDelete = await commitMessageSearchMutation({
      conversationId: CONVERSATION_ID,
      deletedAt: new Date(),
      expectedRevision: 3,
      kind: "delete",
      messageId: MESSAGE_ID,
      senderId: OWNER_ID,
    });
    expect(duplicateDelete).toEqual({ status: "already-deleted" });

    const storedMessage = await prisma.orm.public.Messages.select(
      "ciphertext",
      "deletedAt",
      "revision"
    )
      .where({ id: MESSAGE_ID })
      .first();
    const storedConversation =
      await prisma.orm.public.MessageConversations.select("changeSeq")
        .where({ id: CONVERSATION_ID })
        .first();
    const outbox = await prisma.orm.public.MessageSearchOutbox.select(
      "changeSequence",
      "kind",
      "revision"
    )
      .where((row) => row.id.in(OUTBOX_IDS))
      .all();
    const changes = await prisma.orm.public.MessageConversationChanges.select(
      "audienceUserIds",
      "kind",
      "messageId",
      "revision",
      "sequence"
    )
      .where({ conversationId: CONVERSATION_ID })
      .orderBy((change) => change.sequence.asc())
      .all();

    expect(storedMessage?.ciphertext).toMatch(/^rewrite-[ab]$/);
    expect(storedMessage?.deletedAt).not.toBeNull();
    expect(storedMessage?.revision).toBe(3);
    expect(storedConversation?.changeSeq).toBe(2);
    expect(outbox).toHaveLength(2);
    expect(
      outbox.map((row) => [row.kind, row.revision, row.changeSequence])
    ).toEqual([
      ["upsert", 2, 1],
      ["delete", 3, 2],
    ]);
    expect(
      changes.map((change) => [
        change.kind,
        change.messageId,
        change.revision,
        change.sequence,
      ])
    ).toEqual([
      ["message.edited", MESSAGE_ID, 2, 1],
      ["message.deleted", MESSAGE_ID, 3, 2],
    ]);
    expect(changes.every((change) => change.audienceUserIds.length === 2)).toBe(
      true
    );
    const replay = await listMessageConversationChanges({
      afterSequence: 0,
      conversationId: CONVERSATION_ID,
      limit: 10,
      membershipWindows: [{ after: null, before: null }],
      snapshotSequence: 2,
      userId: OWNER_ID,
    });
    expect(replay.map((change) => change.sourceRevision)).toEqual([3, 3]);
    expect(replay.map((change) => change.globallyDeleted)).toEqual([
      true,
      true,
    ]);
    expect(replay.every((change) => change.hiddenForViewer === false)).toBe(
      true
    );
  });
});
