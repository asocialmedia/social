import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  closeMessageSearchPool,
  commitMessageHides,
  keys,
  listMessageConversationChanges,
  prisma,
  toPrismaDateTime,
} from "@asm/db";

const RUN_ID = crypto.randomUUID();
const CONVERSATION_ID = crypto.randomUUID();
const OWNER_ID = `change-log-owner-${RUN_ID}`;
const PEER_ID = `change-log-peer-${RUN_ID}`;
const PEER_MESSAGE_ID = crypto.randomUUID();
const OWNER_MESSAGE_ID = crypto.randomUUID();
const DELETED_MESSAGE_ID = crypto.randomUUID();
const RACE_MESSAGE_ID = crypto.randomUUID();

function assertLocalTestDatabase(): void {
  const databaseUrl = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5433" ||
    databaseUrl.pathname.replace(/^\//, "") !== "asocialmedia"
  ) {
    throw new Error(
      "Refusing to run DM change-log integration tests outside the local test database"
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
    await tx.orm.public.MessageConversationMembers.createAll([
      {
        conversationId: CONVERSATION_ID,
        lastReadAt: toPrismaDateTime(new Date(0)),
        userId: OWNER_ID,
      },
      { conversationId: CONVERSATION_ID, userId: PEER_ID },
    ]);
    await tx.orm.public.Messages.createAll([
      {
        ciphertext: "peer-ciphertext",
        conversationId: CONVERSATION_ID,
        id: PEER_MESSAGE_ID,
        iv: "peer-iv",
        ratchetIndex: 0,
        senderId: PEER_ID,
      },
      {
        ciphertext: "owner-ciphertext",
        conversationId: CONVERSATION_ID,
        id: OWNER_MESSAGE_ID,
        iv: "owner-iv",
        ratchetIndex: 0,
        senderId: OWNER_ID,
      },
      {
        ciphertext: "deleted-ciphertext",
        conversationId: CONVERSATION_ID,
        deletedAt: toPrismaDateTime(new Date()),
        id: DELETED_MESSAGE_ID,
        iv: "deleted-iv",
        ratchetIndex: 1,
        senderId: PEER_ID,
      },
      {
        ciphertext: "race-ciphertext",
        conversationId: CONVERSATION_ID,
        id: RACE_MESSAGE_ID,
        iv: "race-iv",
        ratchetIndex: 2,
        senderId: PEER_ID,
      },
    ]);
  });
});

afterAll(async () => {
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

describe("durable message conversation changes", () => {
  test("commits private hides, sequence, unread decrement, and replay records atomically", async () => {
    const result = await commitMessageHides({
      conversationId: CONVERSATION_ID,
      messageIds: [
        OWNER_MESSAGE_ID,
        PEER_MESSAGE_ID,
        DELETED_MESSAGE_ID,
        "foreign-message",
      ],
      userId: OWNER_ID,
    });
    expect(result.status).toBe("committed");
    if (result.status !== "committed") {
      throw new Error("expected the current member hide to commit");
    }
    expect(result.hidden).toBe(3);
    expect(result.unreadDecrement).toBe(1);

    const duplicate = await commitMessageHides({
      conversationId: CONVERSATION_ID,
      messageIds: [PEER_MESSAGE_ID, OWNER_MESSAGE_ID, DELETED_MESSAGE_ID],
      userId: OWNER_ID,
    });
    expect(duplicate).toMatchObject({ hidden: 0, unreadDecrement: 0 });

    const storedConversation =
      await prisma.orm.public.MessageConversations.select("changeSeq")
        .where({ id: CONVERSATION_ID })
        .first();
    expect(storedConversation?.changeSeq).toBe(3);

    const replay = await listMessageConversationChanges({
      afterSequence: 0,
      conversationId: CONVERSATION_ID,
      limit: 10,
      membershipWindows: [{ after: null, before: null }],
      snapshotSequence: 3,
      userId: OWNER_ID,
    });
    const expectedMessageIds = [
      DELETED_MESSAGE_ID,
      OWNER_MESSAGE_ID,
      PEER_MESSAGE_ID,
    ].toSorted();
    expect(
      replay.map((change) => [change.kind, change.sequence, change.messageId])
    ).toEqual(
      expectedMessageIds.map((messageId, index) => [
        "message.hidden",
        index + 1,
        messageId,
      ])
    );
    expect(
      replay.every((change) => change.audienceUserIds.includes(OWNER_ID))
    ).toBe(true);
    expect(replay.every((change) => change.hiddenForViewer)).toBe(true);
    expect(replay.every((change) => change.sourceAvailable)).toBe(true);
    expect(replay.every((change) => change.sourceRevision === 1)).toBe(true);

    const peerReplay = await listMessageConversationChanges({
      afterSequence: 0,
      conversationId: CONVERSATION_ID,
      limit: 10,
      membershipWindows: [{ after: null, before: null }],
      snapshotSequence: 3,
      userId: PEER_ID,
    });
    expect(peerReplay).toEqual([]);

    const outsideWindow = await listMessageConversationChanges({
      afterSequence: 0,
      conversationId: CONVERSATION_ID,
      limit: 10,
      membershipWindows: [
        { after: new Date(Date.now() + 60_000), before: null },
      ],
      snapshotSequence: 3,
      userId: OWNER_ID,
    });
    expect(outsideWindow).toEqual([]);
  });

  test("serializes duplicate concurrent hides into one durable event", async () => {
    const outcomes = await Promise.all([
      commitMessageHides({
        conversationId: CONVERSATION_ID,
        messageIds: [RACE_MESSAGE_ID],
        userId: OWNER_ID,
      }),
      commitMessageHides({
        conversationId: CONVERSATION_ID,
        messageIds: [RACE_MESSAGE_ID],
        userId: OWNER_ID,
      }),
    ]);

    expect(
      outcomes.reduce(
        (sum, outcome) =>
          sum + (outcome.status === "committed" ? outcome.hidden : 0),
        0
      )
    ).toBe(1);
    const changes = await prisma.orm.public.MessageConversationChanges.where({
      conversationId: CONVERSATION_ID,
    }).all();
    expect(
      changes.filter((change) => change.messageId === RACE_MESSAGE_ID)
    ).toHaveLength(1);
  });

  test("refuses a hide after the member has left", async () => {
    await prisma.orm.public.MessageConversationMembers.where({
      conversationId: CONVERSATION_ID,
      userId: OWNER_ID,
    }).update({ leftAt: toPrismaDateTime(new Date()) });

    const result = await commitMessageHides({
      conversationId: CONVERSATION_ID,
      messageIds: [RACE_MESSAGE_ID],
      userId: OWNER_ID,
    });

    expect(result).toEqual({ status: "membership-ended" });
  });
});
