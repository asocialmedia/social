import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  and,
  closeMessageSearchPool,
  commitMessageConversationRead,
  fromPrismaDateTime,
  keys,
  prisma,
  toPrismaDateTime,
  unreadMessageWhere,
  unreadMessagesWhere,
} from "@asm/db";
import { Pool } from "pg";

const RUN_ID = crypto.randomUUID();
const OWNER_ID = `read-sequence-owner-${RUN_ID}`;
const PEER_ID = `read-sequence-peer-${RUN_ID}`;
const BASELINE_CONVERSATION_ID = crypto.randomUUID();
const RACE_CONVERSATION_ID = crypto.randomUUID();
const HIDDEN_MESSAGE_ID = crypto.randomUUID();
const BASELINE_MESSAGE_IDS = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
  HIDDEN_MESSAGE_ID,
];
const RACE_MESSAGE_ID = crypto.randomUUID();
const OPEN_MEMBERSHIP = [{ after: null, before: null }];
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
      "Refusing to run message read sequence integration tests outside the local test database"
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
        changeSeq: 12,
        id: BASELINE_CONVERSATION_ID,
        pairKey: [OWNER_ID, PEER_ID].toSorted().join(":"),
      },
      {
        id: RACE_CONVERSATION_ID,
        pairKey: `${[OWNER_ID, PEER_ID].toSorted().join(":")}:race`,
      },
    ]);
    await tx.orm.public.MessageConversationMembers.createAll(
      [BASELINE_CONVERSATION_ID, RACE_CONVERSATION_ID].flatMap(
        (conversationId) => [
          {
            conversationId,
            lastReadAt: toPrismaDateTime(new Date(0)),
            userId: OWNER_ID,
          },
          { conversationId, userId: PEER_ID },
        ]
      )
    );

    const createdAt = toPrismaDateTime(new Date());
    await tx.orm.public.Messages.createAll(
      BASELINE_MESSAGE_IDS.map((id, index) => ({
        ciphertext: `ciphertext-${index}`,
        conversationId: BASELINE_CONVERSATION_ID,
        createdAt,
        creationSequence: 0,
        deletedAt: index === 2 ? createdAt : null,
        id,
        iv: `iv-${index}`,
        ratchetIndex: index,
        senderId: index === 1 ? OWNER_ID : PEER_ID,
      }))
    );
    await tx.orm.public.MessageHiddens.create({
      messageId: HIDDEN_MESSAGE_ID,
      userId: OWNER_ID,
    });
  });
});

afterAll(async () => {
  await prisma.orm.public.MessageConversations.where((conversation) =>
    conversation.id.in([BASELINE_CONVERSATION_ID, RACE_CONVERSATION_ID])
  ).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in([OWNER_ID, PEER_ID])
  ).deleteAndCount();
  await databasePool.end();
  await closeMessageSearchPool();
});

describe("commitMessageConversationRead", () => {
  test("captures the conversation sequence and excludes own, deleted, and hidden rows", async () => {
    const result = await commitMessageConversationRead({
      conversationId: BASELINE_CONVERSATION_ID,
      membershipWindows: OPEN_MEMBERSHIP,
      userId: OWNER_ID,
    });

    expect(result).toMatchObject({
      readSequence: 12,
      status: "read",
      unreadCount: 1,
    });
    const member = await prisma.orm.public.MessageConversationMembers.select(
      "lastReadSequence",
      "unreadCount"
    )
      .where((row) =>
        and(
          row.conversationId.eq(BASELINE_CONVERSATION_ID),
          row.userId.eq(OWNER_ID)
        )
      )
      .first();
    expect(member?.lastReadSequence).toBe(12);
    expect(member?.unreadCount).toBe(0);
  });

  test("keeps empty and unbounded membership windows safe in shared unread queries", async () => {
    const noWatermarks = await prisma.orm.public.Messages.where(
      unreadMessagesWhere({ userId: OWNER_ID, watermarks: [] })
    ).aggregate((aggregate) => ({ count: aggregate.count() }));
    expect(noWatermarks.count).toBe(0);

    const unboundedWindow = await prisma.orm.public.Messages.where(
      unreadMessagesWhere({
        userId: OWNER_ID,
        watermarks: [
          {
            conversationId: BASELINE_CONVERSATION_ID,
            lastReadAt: new Date(0),
            windows: OPEN_MEMBERSHIP,
          },
        ],
      })
    ).aggregate((aggregate) => ({ count: aggregate.count() }));
    expect(unboundedWindow.count).toBe(1);
  });

  test("keeps a send unread when its transaction timestamp predates the read boundary", async () => {
    const sender = await databasePool.connect();
    try {
      await sender.query("BEGIN");
      await sender.query(
        `INSERT INTO public.messages
           (id, "conversationId", "senderId", ciphertext, iv, "ratchetIndex")
         VALUES ($1, $2, $3, 'race-ciphertext', 'race-iv', 0)`,
        [RACE_MESSAGE_ID, RACE_CONVERSATION_ID, PEER_ID]
      );

      const firstRead = await commitMessageConversationRead({
        conversationId: RACE_CONVERSATION_ID,
        membershipWindows: OPEN_MEMBERSHIP,
        userId: OWNER_ID,
      });
      expect(firstRead).toMatchObject({
        readSequence: 0,
        status: "read",
        unreadCount: 0,
      });

      const sequence = await sender.query<{ changeSeq: number }>(
        `UPDATE public.message_conversations
            SET "changeSeq" = "changeSeq" + 1
          WHERE id = $1
          RETURNING "changeSeq"`,
        [RACE_CONVERSATION_ID]
      );
      const creationSequence = sequence.rows[0]?.changeSeq;
      if (creationSequence === undefined) {
        throw new Error("Conversation sequence was not advanced");
      }
      await sender.query(
        `UPDATE public.messages
            SET "creationSequence" = $2
          WHERE id = $1`,
        [RACE_MESSAGE_ID, creationSequence]
      );
      await sender.query(
        `UPDATE public.message_conversation_members
            SET "unreadCount" = "unreadCount" + 1
          WHERE "conversationId" = $1
            AND "userId" = $2
            AND "leftAt" IS NULL
            AND "mutedAt" IS NULL
            AND "unreadCount" IS NOT NULL`,
        [RACE_CONVERSATION_ID, OWNER_ID]
      );
      await sender.query("COMMIT");

      const sentCounter =
        await prisma.orm.public.MessageConversationMembers.select("unreadCount")
          .where((member) =>
            and(
              member.conversationId.eq(RACE_CONVERSATION_ID),
              member.userId.eq(OWNER_ID)
            )
          )
          .first();
      expect(sentCounter?.unreadCount).toBe(1);

      const sentMessage = await prisma.orm.public.Messages.select(
        "createdAt",
        "creationSequence"
      )
        .where({ id: RACE_MESSAGE_ID })
        .first();
      expect(sentMessage?.creationSequence).toBe(creationSequence);
      if (firstRead.status !== "read" || !sentMessage) {
        throw new Error("Expected the sent message and read cursor to exist");
      }
      expect(
        fromPrismaDateTime(sentMessage.createdAt).getTime() <
          firstRead.readAt.getTime()
      ).toBe(true);

      const sequenceOnly = await prisma.orm.public.Messages.where((message) =>
        and(
          message.conversationId.eq(RACE_CONVERSATION_ID),
          message.creationSequence.gt(firstRead.readSequence),
          message.deletedAt.isNull(),
          message.senderId.notIn([OWNER_ID])
        )
      ).aggregate((aggregate) => ({ count: aggregate.count() }));
      expect(sequenceOnly.count).toBe(1);

      const unreadPredicate = await prisma.orm.public.Messages.where(
        unreadMessageWhere({
          conversationId: RACE_CONVERSATION_ID,
          lastReadAt: firstRead.status === "read" ? firstRead.readAt : null,
          lastReadSequence:
            firstRead.status === "read" ? firstRead.readSequence : null,
          userId: OWNER_ID,
        })
      ).aggregate((aggregate) => ({ count: aggregate.count() }));
      expect(unreadPredicate.count).toBe(1);

      const nextRead = await commitMessageConversationRead({
        conversationId: RACE_CONVERSATION_ID,
        membershipWindows: OPEN_MEMBERSHIP,
        userId: OWNER_ID,
      });
      expect(nextRead).toMatchObject({
        readSequence: 1,
        status: "read",
        unreadCount: 1,
      });
      const readCounter =
        await prisma.orm.public.MessageConversationMembers.select("unreadCount")
          .where((member) =>
            and(
              member.conversationId.eq(RACE_CONVERSATION_ID),
              member.userId.eq(OWNER_ID)
            )
          )
          .first();
      expect(readCounter?.unreadCount).toBe(0);
    } catch (error) {
      await sender.query("ROLLBACK").catch(() => null);
      throw error;
    } finally {
      sender.release();
    }
  });
});
