import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  DEN_LIMITS,
  createDen,
  createDenMessageNotifications,
  fromPrismaDateTime,
  getNotificationDataQuery,
  groupNotifications,
  mapNotificationData,
  prisma,
  toPrismaDateTime,
  unreadMessageWhere,
  visibleToUser,
} from "@asm/db";
import { and } from "@prisma/orm-postgres/orm-client";
import { Client } from "pg";

// The den message fan-out, against a live database.
//
// The rules pinned here are the ones a UI cannot enforce: who hears about a
// message, who is excluded, what a busy den collapses into, and what the row is
// allowed to contain. A route test proves the route forwards; only this can
// prove the fan-out.
//
// Three of these tests drive a den at volume - a hundred messages into one den, a
// hundred-member den taking a fan-out, and the eleven-send fold - because the size
// is what they are about, so they carry their own budget rather than the 5s
// default. The rest of the file is deliberately left on the default. See
// `DEN_VOLUME_TIMEOUT_MS` below for the numbers and the reasoning.

const RUN_ID =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    .replaceAll("-", "_")
    .slice(0, 18);

const OWNER_ID = `dnot-owner-${RUN_ID}`;
const MEMBER_ID = `dnot-member-${RUN_ID}`;
const QUIET_ID = `dnot-quiet-${RUN_ID}`;
const FOURTH_ID = `dnot-fourth-${RUN_ID}`;
const BASE_USER_IDS = [OWNER_ID, MEMBER_ID, QUIET_ID, FOURTH_ID];

// Ciphertext that would be unmistakable in a leak. The server only ever holds
// this string, so its appearance in a notification is a leak by definition.
const CIPHERTEXT = `CIPHERTEXT-MARKER-${RUN_ID}-do-not-notify`;
const IV = `IV-MARKER-${RUN_ID}`;
// A wrap, standing in for any key material: it must never appear in a
// notification either.
const WRAPPED_KEY = `WRAPPED-KEY-MARKER-${RUN_ID}`;

// Every den this file makes, so afterAll can clear them even when a test failed
// part-way through. A den cascades to its messages, member rows, key rows and
// its notification rows.
const denIds: string[] = [];
// Every user this file makes, for the same reason. Pushed to as the bulk
// members below are generated.
const userIds = [...BASE_USER_IDS];

async function createUser(id: string): Promise<void> {
  await prisma.orm.public.Users.create({
    displayName: id,
    email: `${id}@example.test`,
    id,
    username: id,
  });
}

// The bulk form, for the full-ceiling roster the badge test below needs. One
// multi-row INSERT rather than a hundred round trips, for the same reason the
// hundred-message loop is not a hundred-user loop either: the size of the crowd
// is not what that test is measuring, so the time spent assembling it should not
// be charged to it.
//
// It also stops the file from being a load source in its own right. `bun test
// --parallel` runs one process per file with no cap, against a dev Postgres
// deliberately held at max_connections=50 (docker/docker-compose.dev.yml), and
// each process's own pool will happily ask for ten. A hundred concurrent
// single-row INSERTs is a hundred queued statements holding that pool wide open
// while they drain, and a process that cannot get a connection is refused
// outright with `sorry, too many clients already` - which lands on whichever test
// happens to be running, including the small ones this file also holds.
async function createUsers(ids: readonly string[]): Promise<void> {
  await prisma.orm.public.Users.createAll(
    ids.map((id) => ({
      displayName: id,
      email: `${id}@example.test`,
      id,
      username: id,
    }))
  );
}

// The budget for the three tests below that drive a den at volume, and the only
// timeout in this file that is not the default.
//
// Two of them are hundred-scale by construction and cannot be made smaller: a
// hundred messages is the whole subject of the fold test, because "one row, not a
// hundred" is only a claim worth making at a hundred, and a hundred members is
// the whole subject of the badge test, because a badge query that costs the
// reader more in a big den than in a small one is the bug it exists to catch.
// Against an idle database they measure between roughly 350ms and 750ms.
//
// The third is the eleven-send fold. It is small next to those two and its
// fixture is only eleven messages, but it is the test Bun's default has actually
// been observed to lose: eleven sends in a row, each a transaction that creates
// the message, stamps the conversation and folds the audience, so the runtime is
// eleven serialized transactions against a pool the rest of the suite is also
// competing for. Under that load a connection is not refused - it is waited on,
// and the pool's own connection timeout is 5000ms, the same number as Bun's
// per-test default, so the test dies at 5000ms having proved nothing. It measures
// about 70ms idle; the budget is for the queueing, not the work.
//
// Thirty seconds is far over all of those numbers on purpose. The budget here is
// not an SLO to tune, it is the point past which something is genuinely broken -
// a hang, or a send chain that stopped settling - and those should be waited out
// rather than confused with load. Sitting at roughly an order of magnitude over
// the worst loaded case means a slow suite cannot manufacture a failure out of a
// test that is working.
//
// The tests in these blocks that fire two or three sends are left on the default
// deliberately. They are fast, so a budget would only turn a real hang into a
// thirty-second wait.
//
// Options go last: this is the (label, fn, options) overload in the pinned
// bun-types.
const DEN_VOLUME_TIMEOUT_MS = 30_000;

async function makeDen(name: string, memberIds: string[]): Promise<string> {
  const den = await createDen({ creatorId: OWNER_ID, memberIds, name });
  denIds.push(den.id);
  return den.id;
}

// The send path's transaction, reduced to what the fan-out depends on: create
// the message, take the den's row lock, then fan out. Returns the rows it
// created, which is exactly what the route enqueues after the commit.
//
// Messages are stamped one second apart so the read-watermark assertions are
// about the watermark and not about two rows sharing a millisecond.
const FIRST_MESSAGE_AT = Date.parse("2026-01-01T00:00:00.000Z");
async function sendMessage(
  conversationId: string,
  senderId: string,
  options: { index?: number; failAfterMessage?: boolean } = {}
): Promise<{ id: string; recipientId: string }[]> {
  const index = options.index ?? 0;
  return await prisma.transaction(async (tx) => {
    await tx.orm.public.Messages.create({
      ciphertext: `${CIPHERTEXT}-${index}`,
      conversationId,
      createdAt: toPrismaDateTime(new Date(FIRST_MESSAGE_AT + index * 1000)),
      iv: IV,
      ratchetIndex: index,
      senderId,
    });
    // The conversation bump, which is what serializes two sends into one den.
    await tx.orm.public.MessageConversations.where({
      id: conversationId,
    }).update({ updatedAt: toPrismaDateTime(new Date()) });
    if (options.failAfterMessage) {
      // Stands in for anything that fails after the message is written: a
      // constraint, a serialization failure, a killed process. The transaction
      // rolls back and must take the notification rows with it.
      throw new Error("send failed after the message was written");
    }
    return await createDenMessageNotifications(tx, {
      conversationId,
      senderId,
    });
  });
}

interface NotificationRow {
  conversationId: string | null;
  count: number;
  createdAt: unknown;
  id: string;
  issuerId: string;
  read: boolean;
  recipientId: string;
}

async function notificationsFor(
  conversationId: string
): Promise<NotificationRow[]> {
  return await prisma.orm.public.Notifications.select(
    "conversationId",
    "count",
    "createdAt",
    "id",
    "issuerId",
    "read",
    "recipientId"
  )
    .where((notification) => notification.conversationId.eq(conversationId))
    .orderBy((notification) => notification.createdAt.asc())
    .all();
}

async function messagesIn(conversationId: string) {
  return await prisma.orm.public.Messages.select("createdAt", "id", "senderId")
    .where((message) => message.conversationId.eq(conversationId))
    .orderBy((message) => message.createdAt.asc())
    .all();
}

beforeAll(async () => {
  await Promise.all(BASE_USER_IDS.map((id) => createUser(id)));
});

afterAll(async () => {
  if (denIds.length > 0) {
    await prisma.orm.public.MessageConversations.where((conversation) =>
      conversation.id.in(denIds)
    ).deleteAndCount();
  }
  await prisma.orm.public.Users.where((user) =>
    user.id.in(userIds)
  ).deleteAndCount();
});

describe("fanning a den message out", () => {
  test("notifies every member except the sender", async () => {
    const denId = await makeDen(`Trio ${RUN_ID}`, [
      OWNER_ID,
      MEMBER_ID,
      QUIET_ID,
    ]);
    const created = await sendMessage(denId, OWNER_ID);

    // Three members, one sender, two recipients.
    expect(created).toHaveLength(2);
    expect(created.map((row) => row.recipientId).toSorted()).toEqual(
      [MEMBER_ID, QUIET_ID].toSorted()
    );
    const rows = await notificationsFor(denId);
    expect(rows).toHaveLength(2);
    // The sender is not in the audience, and every row names the sender as its
    // issuer so the copy can attribute it.
    expect(rows.some((row) => row.recipientId === OWNER_ID)).toBe(false);
    expect(rows.every((row) => row.issuerId === OWNER_ID)).toBe(true);
    expect(rows.every((row) => row.count === 1)).toBe(true);
    expect(rows.every((row) => row.read === false)).toBe(true);
    expect(rows.every((row) => row.conversationId === denId)).toBe(true);
  });

  test("a muted member gets no notification, and still gets the message", async () => {
    const denId = await makeDen(`Muted ${RUN_ID}`, [
      OWNER_ID,
      MEMBER_ID,
      QUIET_ID,
    ]);
    await prisma.orm.public.MessageConversationMembers.where((member) =>
      and(member.conversationId.eq(denId), member.userId.eq(QUIET_ID))
    ).updateAndCount({ mutedAt: toPrismaDateTime(new Date()) });

    const created = await sendMessage(denId, OWNER_ID);
    expect(created.map((row) => row.recipientId)).toEqual([MEMBER_ID]);
    const notified = await notificationsFor(denId);
    expect(notified.map((row) => row.recipientId)).toEqual([MEMBER_ID]);

    // The mute suppresses the badge and the push, not the conversation. The
    // member is still in the den and still sees the message in the thread, which
    // is exactly the rule the conversation list already applies when it forces a
    // muted member's per-conversation badge to 0.
    const membership =
      await prisma.orm.public.MessageConversationMembers.select(
        "mutedAt",
        "userId"
      )
        .where((member) => member.conversationId.eq(denId))
        .all();
    const muted = membership.find((member) => member.userId === QUIET_ID);
    expect(muted?.mutedAt ?? null).not.toBeNull();

    const visible = await prisma.orm.public.Messages.select("id")
      .where((message) =>
        and(message.conversationId.eq(denId), visibleToUser(QUIET_ID)(message))
      )
      .all();
    expect(visible).toHaveLength(1);
  });

  test("a send to a den where everyone else is muted notifies nobody", async () => {
    const denId = await makeDen(`All muted ${RUN_ID}`, [
      OWNER_ID,
      MEMBER_ID,
      QUIET_ID,
    ]);
    for (const userId of [MEMBER_ID, QUIET_ID]) {
      // oxlint-disable-next-line no-await-in-loop -- two independent rows on one conversation
      await prisma.orm.public.MessageConversationMembers.where((member) =>
        and(member.conversationId.eq(denId), member.userId.eq(userId))
      ).updateAndCount({ mutedAt: toPrismaDateTime(new Date()) });
    }
    expect(await sendMessage(denId, OWNER_ID)).toEqual([]);
    expect(await notificationsFor(denId)).toEqual([]);
  });

  test("a rolled back send notifies nobody", async () => {
    const denId = await makeDen(`Rollback ${RUN_ID}`, [
      OWNER_ID,
      MEMBER_ID,
      QUIET_ID,
    ]);
    await expect(
      sendMessage(denId, OWNER_ID, { failAfterMessage: true })
    ).rejects.toThrow("send failed after the message was written");

    // The message rolled back, so there is nothing to be told about, and no
    // orphaned notification row is left behind for the worker to find.
    expect(await notificationsFor(denId)).toEqual([]);
    expect(await messagesIn(denId)).toEqual([]);
  });
});

describe("a busy den", () => {
  // Eleven sends in a row, each a transaction that creates the message, stamps the
  // conversation and folds the audience. The runtime is a serialized send chain
  // rather than anything the loop can be shortened out of, so this carries a budget
  // of its own - see `DEN_VOLUME_TIMEOUT_MS`.
  test(
    "folds every later message into the one unread row",
    async () => {
      const denId = await makeDen(`Busy ${RUN_ID}`, [
        OWNER_ID,
        MEMBER_ID,
        QUIET_ID,
      ]);
      // One sender throughout, so the audience is the same two people on every
      // message and each of them has a row to fold into from the first one on.
      const first = await sendMessage(denId, OWNER_ID, { index: 0 });
      expect(first).toHaveLength(2);

      for (let index = 1; index < 11; index += 1) {
        // oxlint-disable-next-line no-await-in-loop -- one den send at a time, each must settle before the next
        const created = await sendMessage(denId, OWNER_ID, { index });
        // Nothing new to enqueue: the row already exists, so the notification
        // badge does not move for a message that only grew the existing row.
        expect(created).toEqual([]);
      }

      const rows = await notificationsFor(denId);
      // One row per recipient, carrying the count.
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.count).toBe(11);
        expect(row.read).toBe(false);
      }
    },
    { timeout: DEN_VOLUME_TIMEOUT_MS }
  );

  test("a read row is left alone and the next message starts a fresh one", async () => {
    const denId = await makeDen(`Read then written ${RUN_ID}`, [
      OWNER_ID,
      MEMBER_ID,
      QUIET_ID,
    ]);
    await sendMessage(denId, OWNER_ID, { index: 0 });
    // One member opens the den, so their row is read. The other has not.
    await prisma.orm.public.Notifications.where((notification) =>
      and(
        notification.recipientId.eq(MEMBER_ID),
        notification.conversationId.eq(denId)
      )
    ).updateAndCount({ read: true });

    const created = await sendMessage(denId, OWNER_ID, { index: 1 });
    // Only the member with a read row has a fresh row to enqueue.
    expect(created.map((row) => row.recipientId)).toEqual([MEMBER_ID]);

    const rows = await notificationsFor(denId);
    expect(rows).toHaveLength(3);
    const memberRows = rows.filter((row) => row.recipientId === MEMBER_ID);
    expect(memberRows).toHaveLength(2);
    // The row they read is untouched, and the new one starts at one message.
    expect(memberRows.filter((row) => row.read)).toHaveLength(1);
    expect(memberRows.every((row) => row.count === 1)).toBe(true);
    // The member who has not read anything is still folded.
    const quietRow = rows.find((row) => row.recipientId === QUIET_ID);
    expect(quietRow?.read).toBe(false);
    expect(quietRow?.count).toBe(2);
  });

  test("a folded row is attributed to whoever wrote last", async () => {
    const denId = await makeDen(`Attributed ${RUN_ID}`, [
      OWNER_ID,
      MEMBER_ID,
      QUIET_ID,
    ]);
    await sendMessage(denId, OWNER_ID, { index: 0 });
    await sendMessage(denId, MEMBER_ID, { index: 1 });
    const rows = await notificationsFor(denId);
    // The inbox line names the newest sender, not the one who started the
    // conversation, and the row is re-stamped so it moves to the top of the
    // feed. QUIET read neither, so their row folded and changed hands.
    const quietRow = rows.find((row) => row.recipientId === QUIET_ID);
    expect(quietRow?.issuerId).toBe(MEMBER_ID);
    expect(quietRow?.count).toBe(2);
  });

  // A hundred sends in a row, each a transaction that creates the message,
  // stamps the conversation and folds the audience. The runtime is a hundred
  // serialized transactions, which is the shape of a busy den, so it carries a
  // budget of its own - see `DEN_VOLUME_TIMEOUT_MS`.
  test(
    "what a member sees after a hundred messages in a minute",
    async () => {
      const denId = await makeDen(`Hundred ${RUN_ID}`, [OWNER_ID, MEMBER_ID]);
      // Driven off the constant so the shape of the assertion does not depend on
      // which number happens to be the ceiling.
      for (let index = 0; index < DEN_LIMITS.membersMax; index += 1) {
        // oxlint-disable-next-line no-await-in-loop -- one den send at a time, each must settle before the next
        await sendMessage(denId, OWNER_ID, { index });
      }

      // One row, not a hundred: the reader dismisses one line, and its copy reads
      // "Alice in <den>: 100 new messages".
      const rows = await notificationsFor(denId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.count).toBe(DEN_LIMITS.membersMax);

      // What the inbox actually renders: the very query /api/notifications runs,
      // through the same mapper and the same grouping the feed page uses.
      const feed = await getNotificationDataQuery(prisma.orm)
        .where((notification) =>
          and(
            notification.recipientId.eq(MEMBER_ID),
            notification.conversationId.eq(denId)
          )
        )
        .orderBy((notification) => notification.createdAt.desc())
        .all()
        .then((page) => page.map(mapNotificationData));
      const grouped = groupNotifications(feed);
      expect(grouped).toHaveLength(1);
      expect(grouped[0]?.count).toBe(DEN_LIMITS.membersMax);
      expect(grouped[0]?.conversation?.name).toBe(`Hundred ${RUN_ID}`);
      expect(grouped[0]?.allNotificationIds).toHaveLength(1);
    },
    { timeout: DEN_VOLUME_TIMEOUT_MS }
  );
});

describe("the notification a den message produces", () => {
  test("carries no ciphertext, no key material and no member list", async () => {
    const denId = await makeDen(`Quiet ${RUN_ID}`, [
      OWNER_ID,
      MEMBER_ID,
      QUIET_ID,
      FOURTH_ID,
    ]);
    // A wrap, so there is real key material in the database for the assertion
    // below to be about rather than about nothing.
    await prisma.orm.public.MessageConversationKeys.create({
      conversationId: denId,
      encryptedKey: WRAPPED_KEY,
      iv: IV,
      ownerUserId: OWNER_ID,
    });
    const created = await sendMessage(denId, OWNER_ID);
    const recipient = created.find((row) => row.recipientId === MEMBER_ID);
    expect(recipient).toBeDefined();

    // Read the row as the database stored it, every column, rather than through
    // a select list this test also wrote. A column nobody thought to check
    // cannot hide here.
    const client = new Client({
      connectionString:
        process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:5433/asocialmedia?schema=public",
    });
    await client.connect();
    try {
      const stored = await client.query<{ row: Record<string, unknown> }>(
        "SELECT to_jsonb(notifications) AS row FROM notifications WHERE id = $1",
        [recipient?.id]
      );
      const row = stored.rows[0]?.row ?? {};
      const serialized = JSON.stringify(row);

      // The whole column list, so a new column carrying message content would
      // fail here rather than pass unnoticed.
      expect(Object.keys(row).toSorted()).toEqual([
        "commentId",
        "communityId",
        "conversationId",
        "count",
        "createdAt",
        "id",
        "issuerId",
        "postId",
        "read",
        "recipientId",
        "type",
      ]);
      expect(row.type).toBe("DEN_MESSAGE");

      // No plaintext, because the server never had any to put here.
      expect(serialized).not.toContain(CIPHERTEXT);
      expect(serialized).not.toContain(IV);
      // No key material of any kind.
      expect(serialized).not.toContain(WRAPPED_KEY);
      expect(serialized.toLowerCase()).not.toContain("ciphertext");
      expect(serialized.toLowerCase()).not.toContain("encrypted");
      expect(serialized.toLowerCase()).not.toContain("privatekey");
      // No message to follow: there is no message id on the row at all, so
      // nothing here can be joined back to a message.
      expect(Object.keys(row)).not.toContain("messageId");

      // No roster. The row names exactly two people: the member it is for, and
      // the member who wrote. Nobody else's id is anywhere in it, so a stolen
      // inbox row says nothing about who else is in the den.
      expect(row.recipientId).toBe(MEMBER_ID);
      expect(row.issuerId).toBe(OWNER_ID);
      expect(serialized).not.toContain(QUIET_ID);
      expect(serialized).not.toContain(FOURTH_ID);
    } finally {
      await client.end();
    }
  });

  test("the den's own members are not reachable through the notification's includes", async () => {
    // The inbox query and the worker's push query both select the conversation
    // for its name. The select list is the boundary: a den's roster is not in
    // it, so no client or push can describe the membership.
    const denId = await makeDen(`Select ${RUN_ID}`, [
      OWNER_ID,
      MEMBER_ID,
      QUIET_ID,
    ]);
    await sendMessage(denId, OWNER_ID);
    const rows = await prisma.orm.public.Notifications.where((notification) =>
      notification.conversationId.eq(denId)
    )
      .include("conversation", (conversation) =>
        conversation.select("_type", "id", "name")
      )
      .all();
    const conversation = rows[0]?.conversation ?? null;
    expect(Object.keys(conversation ?? {}).toSorted()).toEqual([
      "_type",
      "id",
      "name",
    ]);
    expect(conversation?.name).toBe(`Select ${RUN_ID}`);
  });
});

describe("the den badge at the member ceiling", () => {
  // A hundred-member den taking a ten-message fan-out, which is a hundred
  // membership rows and close to a thousand notification rows written across ten
  // transactions. The room size is the property, so the budget is explicit -
  // see `DEN_VOLUME_TIMEOUT_MS`.
  test(
    "the existing per-conversation unread query counts a full den correctly",
    async () => {
      // The badge query has no idea how many members a den has, and that is the
      // point: it is bounded by the reader's own watermark, so a 100-member room
      // costs the reader no more than a two-person one. Proven against a real
      // 100-member den rather than asserted.
      const bulk = Array.from(
        { length: DEN_LIMITS.membersMax - BASE_USER_IDS.length },
        (_unused, index) =>
          `dnot-bulk-${RUN_ID}-${String(index).padStart(3, "0")}`
      );
      userIds.push(...bulk);
      await createUsers(bulk);
      const denId = await makeDen(`Everyone ${RUN_ID}`, [
        ...BASE_USER_IDS,
        ...bulk,
      ]);
      const members = await prisma.orm.public.MessageConversationMembers.where(
        (member) => member.conversationId.eq(denId)
      ).aggregate((aggregate) => ({ count: aggregate.count() }));
      expect(members.count).toBe(DEN_LIMITS.membersMax);

      // Ten messages from the owner, none from the readers.
      for (let index = 0; index < 10; index += 1) {
        // oxlint-disable-next-line no-await-in-loop -- one den send at a time, each must settle before the next
        await sendMessage(denId, OWNER_ID, { index });
      }

      // Every member is notified except the sender: a 99-row fan-out.
      expect(await notificationsFor(denId)).toHaveLength(
        DEN_LIMITS.membersMax - 1
      );

      // The exact query the badge route seeds from, unchanged.
      const badge = async (userId: string, lastReadAt: Date | null) => {
        const counted = await prisma.orm.public.Messages.where(
          unreadMessageWhere({ conversationId: denId, lastReadAt, userId })
        ).aggregate((aggregate) => ({ count: aggregate.count() }));
        return counted.count;
      };

      // A member who has read nothing sees all ten, in a room of a hundred.
      expect(await badge(MEMBER_ID, null)).toBe(10);
      // A member who read up to the sixth message sees the four after it.
      const sent = await messagesIn(denId);
      const watermark = fromPrismaDateTime(sent[5]?.createdAt ?? new Date(0));
      expect(await badge(QUIET_ID, watermark)).toBe(4);
      // A member who has read everything sees nothing.
      const last = fromPrismaDateTime(sent.at(-1)?.createdAt ?? new Date(0));
      expect(await badge(FOURTH_ID, last)).toBe(0);
      // The sender never accrues unread on their own messages, in a room of a
      // hundred, just as in a DM.
      expect(await badge(OWNER_ID, null)).toBe(0);
    },
    { timeout: DEN_VOLUME_TIMEOUT_MS }
  );
});
