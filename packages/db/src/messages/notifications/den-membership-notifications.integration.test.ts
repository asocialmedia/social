import { afterAll, describe, expect, test } from "bun:test";

import {
  addDenMembers,
  createDen,
  dissolveDen,
  leaveDen,
  prisma,
  removeDenMember,
  setDenMemberRole,
} from "@asm/db";
import { and } from "@prisma/orm-postgres/orm-client";

// The notice a member gets when their den membership ends without their consent.
//
// The realtime announcement covers the reader who happens to have the den open on
// a stream. Everybody else finds out from the conversation list, which drops the
// den on its next poll and says nothing about why. For a dissolve that is a
// silent, irreversible loss: the conversation row owns the messages, the key
// wraps and every member's read watermark, so a deleted den is not something the
// reader gets back by looking harder.
//
// These are driven against a live database because the whole question is what
// rows survive, and what cascades. A dissolved den's rows are the interesting
// case: the notification deliberately carries no conversation id, because a
// foreign key would take the notification away with the den it is about.
//
// Every test builds its own cast. Notices are addressed to a person rather than
// to a den, so a shared fixture would let one test's dissolve satisfy the next
// test's assertion and hide the very thing being checked.

// Unique per test invocation, so two runs against the same database cannot see
// each other's rows either.
let sequence = 0;
const createdUserIds: string[] = [];
const createdDenIds: string[] = [];

afterAll(async () => {
  if (createdDenIds.length > 0) {
    await prisma.orm.public.MessageConversations.where((conversation) =>
      conversation.id.in(createdDenIds)
    ).deleteAndCount();
  }
  if (createdUserIds.length > 0) {
    await prisma.orm.public.Users.where((user) =>
      user.id.in(createdUserIds)
    ).deleteAndCount();
  }
});

async function freshUser(label: string): Promise<string> {
  sequence += 1;
  const id = `dmemb-${label}-${Date.now().toString(36)}-${sequence}`;
  createdUserIds.push(id);
  await prisma.orm.public.Users.create({
    displayName: id,
    email: `${id}@example.test`,
    id,
    username: id,
  });
  return id;
}

// A den whose owner, admin and plain member are all brand new, so nothing about
// the assertion can be satisfied by a row an earlier test wrote.
async function freshDen(): Promise<{
  adminId: string;
  denId: string;
  memberId: string;
  ownerId: string;
}> {
  const ownerId = await freshUser("owner");
  const adminId = await freshUser("admin");
  const memberId = await freshUser("member");
  const den = await createDen({
    creatorId: ownerId,
    description: null,
    memberIds: [adminId, memberId],
    name: `Dens ${Date.now().toString(36)}-${sequence}`,
  });
  createdDenIds.push(den.id);
  await setDenMemberRole(den.id, ownerId, adminId, "ADMIN");
  return { adminId, denId: den.id, memberId, ownerId };
}

interface EndedNotice {
  conversationId: string | null;
  count: number;
  issuerId: string;
  type: string;
}

// The `_type` column arrives as `type` on the row, the same rename every route
// destructures away. Selected by its authored name and read by its result name,
// so the two cannot be confused.
async function endedNoticesFor(recipientId: string): Promise<EndedNotice[]> {
  const rows = await prisma.orm.public.Notifications.select(
    "conversationId",
    "count",
    "issuerId",
    "_type"
  )
    .where((notification) =>
      and(
        notification.recipientId.eq(recipientId),
        notification._type.eq("DEN_MEMBERSHIP_ENDED")
      )
    )
    .all();
  return rows.map((row) => ({
    conversationId: row.conversationId,
    count: row.count,
    issuerId: row.issuerId,
    type: row._type,
  }));
}

describe("a removed member is told", () => {
  test("exactly the removed member, from the actor, naming the den", async () => {
    const { adminId, denId, memberId, ownerId } = await freshDen();
    await removeDenMember(denId, ownerId, memberId);

    const notices = await endedNoticesFor(memberId);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.issuerId).toBe(ownerId);
    // A removal leaves the den standing, so the row can point at it and the copy
    // can name it. That is the whole difference between this row and a
    // dissolve's, and it is carried by the foreign key rather than by a flag.
    expect(notices[0]?.conversationId).toBe(denId);
    // `count` is a message count everywhere else in the system, and here it is
    // simply one. See the module note in den-membership-notifications.ts.
    expect(notices[0]?.count).toBe(1);

    // Nobody else is told. The members who stayed know what happened because they
    // were there, and a second notice to each of them would be noise about
    // something they did.
    expect(await endedNoticesFor(ownerId)).toEqual([]);
    expect(await endedNoticesFor(adminId)).toEqual([]);
  });

  test("an admin can remove, and the notice names them as the actor", async () => {
    const { adminId, denId, ownerId } = await freshDen();
    const outsiderId = await freshUser("outsider");
    await addDenMembers(denId, adminId, [outsiderId]);
    await removeDenMember(denId, adminId, outsiderId);
    const notices = await endedNoticesFor(outsiderId);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.issuerId).toBe(adminId);
    expect(await endedNoticesFor(ownerId)).toEqual([]);
  });

  test("a refused removal writes no notice", async () => {
    // The rows are written inside the same transaction as the mutation, so a
    // refusal cannot leave a notification claiming a removal that did not happen.
    const { adminId, denId, memberId } = await freshDen();
    await expect(
      removeDenMember(denId, memberId, adminId)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await endedNoticesFor(adminId)).toEqual([]);
    expect(await endedNoticesFor(memberId)).toEqual([]);
  });
});

describe("a dissolved den is told", () => {
  test("every other member, from the owner, carrying no den at all", async () => {
    const { adminId, denId, memberId, ownerId } = await freshDen();
    await dissolveDen(denId, ownerId);

    // One assertion per recipient rather than a loop, so a failure names the
    // member whose notice is wrong instead of a position in a list.
    const adminNotices = await endedNoticesFor(adminId);
    const memberNotices = await endedNoticesFor(memberId);
    for (const notices of [adminNotices, memberNotices]) {
      expect(notices).toHaveLength(1);
      expect(notices[0]?.issuerId).toBe(ownerId);
      // No conversation id, and that is load-bearing rather than an omission: the
      // den row is gone, the foreign key cascades, and a row that pointed at it
      // would be deleted along with the thing it was announcing. The copy has to
      // survive its own subject, so it says "a den".
      expect(notices[0]?.conversationId).toBeNull();
    }
    // The owner dissolved it. Telling them about their own action would be a
    // notice they did not need and cannot act on.
    expect(await endedNoticesFor(ownerId)).toEqual([]);
  });

  test("the notice outlives the den it is about", async () => {
    // The one property the cascade makes non-obvious. If this ever fails, a
    // dissolved den is silent for exactly the readers it was written for.
    const { adminId, denId, ownerId } = await freshDen();
    await dissolveDen(denId, ownerId);
    const survivors = await prisma.orm.public.MessageConversations.select("id")
      .where({ id: denId })
      .first();
    expect(survivors).toBeNull();
    expect(await endedNoticesFor(adminId)).toHaveLength(1);
  });

  test("the last member out writes no notice to themselves", async () => {
    // A leave that dissolves the den is self-inflicted and self-announced. The
    // actor is filtered out of the recipient list, so a two-member den that ends
    // this way produces nothing at all rather than a notice telling somebody they
    // had left.
    const ownerId = await freshUser("solo-owner");
    const adminId = await freshUser("solo-admin");
    const den = await createDen({
      creatorId: ownerId,
      description: null,
      memberIds: [adminId],
      name: `Last out ${Date.now().toString(36)}-${sequence}`,
    });
    createdDenIds.push(den.id);
    await leaveDen(den.id, ownerId);
    await leaveDen(den.id, adminId);
    expect(await endedNoticesFor(adminId)).toEqual([]);
  });
});

describe("memberships that end quietly", () => {
  test("a member who leaves is not notified", async () => {
    // The person who left knows. A notice would be telling somebody what they
    // just did, which is the definition of noise.
    const { adminId, denId, memberId, ownerId } = await freshDen();
    await leaveDen(denId, memberId);
    expect(await endedNoticesFor(memberId)).toEqual([]);
    expect(await endedNoticesFor(ownerId)).toEqual([]);
    expect(await endedNoticesFor(adminId)).toEqual([]);
  });

  test("an ownership transfer is not a membership ending", async () => {
    // The heir is now the owner, which is a change of authority rather than a
    // loss of access. Folding it into this type would tell somebody they were
    // removed from a den they now run.
    const { adminId, denId, memberId, ownerId } = await freshDen();
    const result = await leaveDen(denId, ownerId);
    expect(result.newOwnerId).toBe(adminId);
    // The leaver, the new owner and the member who stayed: none of them is a
    // membership that ended.
    expect(await endedNoticesFor(ownerId)).toEqual([]);
    expect(await endedNoticesFor(adminId)).toEqual([]);
    expect(await endedNoticesFor(memberId)).toEqual([]);
  });
});

describe("the type is part of the schema, not a magic string", () => {
  test("the enum value the rows carry is the one the contract declares", async () => {
    // The write path and the read path each name this value, and a Postgres enum
    // is the only thing that makes them agree. A row written under a different
    // label would simply not exist as far as the inbox query is concerned, which
    // is a failure with no error message anywhere.
    const { denId, memberId, ownerId } = await freshDen();
    await removeDenMember(denId, ownerId, memberId);
    const notices = await endedNoticesFor(memberId);
    expect(notices[0]?.type).toBe("DEN_MEMBERSHIP_ENDED");
  });
});
