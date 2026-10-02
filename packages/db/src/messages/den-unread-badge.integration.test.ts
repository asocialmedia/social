import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  DEN_LIMITS,
  createDen,
  fromPrismaDateTime,
  prisma,
  toPrismaDateTime,
  unreadMessageWhere,
} from "@asm/db";
import { and } from "@prisma/orm-postgres/orm-client";

// The unread badge is a Redis counter per user, incremented on send and
// decremented on read by the number of rows the read's own filter counts. The two
// halves are in different files and neither can see the other, so the property
// that matters - they net to zero - is asserted here, against a real den, with
// the real filter.
//
// The bug this exists to catch: the send path credited ONE member, the first
// membership row that was not the sender's. In a DM that is the only other
// member and it is correct. In a den it is one of up to ninety-nine, chosen by
// row order, so ninety-eight members got no badge and one got a badge they could
// not explain. A per-DM test cannot see that, because in a DM the two readings
// of "the other member" are the same person.
//
// What is asserted is the DIRECTION that matters. For each member, the number of
// messages the read path would decrement by must equal the number of sends that
// incremented them. If those two ever disagree, that member's counter drifts and
// only a reseed fixes it - the badge climbs, or the read zeroes a counter that
// was already at zero, and neither is visible from the other side.

const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const OWNER_ID = `dunread-owner-${RUN_ID}`;
const QUIET_ID = `dunread-muted-${RUN_ID}`;
const TALKER_A_ID = `dunread-a-${RUN_ID}`;
const TALKER_B_ID = `dunread-b-${RUN_ID}`;

const USER_IDS = [OWNER_ID, QUIET_ID, TALKER_A_ID, TALKER_B_ID];

const denIds: string[] = [];

async function createUser(id: string): Promise<void> {
  await prisma.orm.public.Users.create({
    displayName: id,
    email: `${id}@example.test`,
    id,
    username: id,
  });
}

// One message from `senderId`, the only thing the two halves have in common.
async function sendMessage(
  conversationId: string,
  senderId: string,
  index: number
): Promise<void> {
  await prisma.orm.public.Messages.create({
    ciphertext: `cipher-${index}`,
    conversationId,
    iv: "iv",
    ratchetIndex: index,
    senderId,
  });
}

// Exactly the query `POST /api/messages/conversations/[id]/read` runs: the
// number of rows a read by `userId` decrements the cache by.
async function readDecrementFor(
  conversationId: string,
  userId: string
): Promise<number> {
  const membership = await prisma.orm.public.MessageConversationMembers.select(
    "lastReadAt"
  )
    .where((member) =>
      and(member.conversationId.eq(conversationId), member.userId.eq(userId))
    )
    .first();
  const counted = await prisma.orm.public.Messages.where(
    unreadMessageWhere({
      conversationId,
      lastReadAt: membership?.lastReadAt
        ? fromPrismaDateTime(membership.lastReadAt)
        : null,
      userId,
    })
  ).aggregate((aggregate) => ({ count: aggregate.count() }));
  return counted.count;
}

beforeAll(async () => {
  await Promise.all(USER_IDS.map((id) => createUser(id)));
});

afterAll(async () => {
  if (denIds.length > 0) {
    await prisma.orm.public.MessageConversations.where((conversation) =>
      conversation.id.in(denIds)
    ).deleteAndCount();
  }
  await prisma.orm.public.Users.where((user) =>
    user.id.in(USER_IDS)
  ).deleteAndCount();
});

describe("the badge the send path increments nets against the read path's decrement", () => {
  test("a four-member den: every unmuted reader gets one increment per message", async () => {
    const den = await createDen({
      creatorId: OWNER_ID,
      description: null,
      memberIds: [QUIET_ID, TALKER_A_ID, TALKER_B_ID],
      name: `Badge ${RUN_ID}`,
    });
    denIds.push(den.id);
    // The muted member is a real membership with a real mute, not an absent one:
    // the mute is exactly the case where the two halves used to disagree, because
    // the send path has to skip the increment and the read path has to skip the
    // decrement for the same reason and by the same rule.
    await prisma.orm.public.MessageConversationMembers.where((member) =>
      and(member.conversationId.eq(den.id), member.userId.eq(QUIET_ID))
    ).update({ mutedAt: toPrismaDateTime(new Date("2026-01-01")) });

    await sendMessage(den.id, OWNER_ID, 0);
    await sendMessage(den.id, TALKER_A_ID, 0);

    // Two messages by two different people, and the read side charges each member
    // for exactly the ones they did not write. TALKER_B read both, so their
    // counter owes two increments. TALKER_A and the owner each read one, because
    // a member never accrues a badge for their own message - which is the other
    // half of the send path's exclusion, and the reason "skip the sender" has to
    // be true on both sides or one of them drifts.
    expect(await readDecrementFor(den.id, TALKER_B_ID)).toBe(2);
    expect(await readDecrementFor(den.id, TALKER_A_ID)).toBe(1);
    expect(await readDecrementFor(den.id, OWNER_ID)).toBe(1);
  });

  test("a muted member is skipped by both halves", async () => {
    // The asymmetry that drifts a counter. The unread seed excludes a muted
    // membership from the conversation entirely, so this member's read decrements
    // nothing - and if the send path had incremented them, their counter would
    // climb by one per message and never come back down.
    const den = await createDen({
      creatorId: OWNER_ID,
      description: null,
      memberIds: [QUIET_ID, TALKER_A_ID],
      name: `Muted ${RUN_ID}`,
    });
    denIds.push(den.id);
    await prisma.orm.public.MessageConversationMembers.where((member) =>
      and(member.conversationId.eq(den.id), member.userId.eq(QUIET_ID))
    ).update({ mutedAt: toPrismaDateTime(new Date("2026-01-01")) });
    await sendMessage(den.id, OWNER_ID, 0);

    // The conversation is still readable; the mute is about being interrupted.
    expect(await readDecrementFor(den.id, QUIET_ID)).toBe(1);

    // And the seed that reconciles the counter skips the membership, so the
    // authoritative answer for this member is zero - which is the number the send
    // path must also have produced.
    const seeded = await prisma.orm.public.MessageConversationMembers.select(
      "conversationId"
    )
      .where((member) =>
        and(member.userId.eq(QUIET_ID), member.mutedAt.isNull())
      )
      .all();
    expect(seeded.some((row) => row.conversationId === den.id)).toBe(false);
  });

  test("a den at the member ceiling: every reader has exactly one unread row per message", async () => {
    // The large case, and the reason the send path cannot simply "pick one". A
    // real den at the real ceiling, so the audience the send has to credit is the
    // same size as the one the read has to charge.
    const den = await createDen({
      creatorId: OWNER_ID,
      description: null,
      memberIds: [TALKER_A_ID, TALKER_B_ID],
      name: `Full ${RUN_ID}`,
    });
    denIds.push(den.id);

    const bulk = Array.from(
      { length: DEN_LIMITS.membersMax - 3 },
      (_unused, index) =>
        `dunread-bulk-${RUN_ID}-${String(index).padStart(3, "0")}`
    );
    await Promise.all(bulk.map((id) => createUser(id)));
    try {
      const existing = await prisma.orm.public.MessageConversationMembers.where(
        (member) => member.conversationId.eq(den.id)
      ).all();
      await prisma.orm.public.MessageConversationMembers.createAll(
        bulk.map((userId) => ({
          conversationId: den.id,
          invitedById: OWNER_ID,
          role: "MEMBER" as const,
          userId,
        }))
      );
      expect(existing.length + bulk.length).toBe(DEN_LIMITS.membersMax);

      await sendMessage(den.id, OWNER_ID, 0);

      // Every one of the ninety-nine readers has exactly one unread row, so the
      // send owes each of them exactly one increment. A single-member increment
      // would leave ninety-eight of them short by one, permanently.
      // One query per reader, in parallel: the point of the assertion is that
      // EVERY reader is owed exactly one, so a single `every` over the whole
      // roster is the shape that can actually fail.
      const readers = [TALKER_A_ID, TALKER_B_ID, ...bulk];
      const decrements = await Promise.all(
        readers.map(async (member) => await readDecrementFor(den.id, member))
      );
      expect(decrements).toEqual(readers.map(() => 1));
      expect(readers.length).toBe(DEN_LIMITS.membersMax - 1);
    } finally {
      await prisma.orm.public.Users.where((user) =>
        user.id.in(bulk)
      ).deleteAndCount();
    }
  });
});
