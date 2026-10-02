import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  DenError,
  createDen,
  dissolveDen,
  getDenMembership,
  leaveDen,
  messageChannel,
  parseMessageEvent,
  prisma,
  setDenMemberRole,
  subscribeToChannel,
  transferDenOwnership,
} from "@asm/db";
import { and } from "@prisma/orm-postgres/orm-client";

// Handing a den to somebody else, against a live database.
//
// A transfer is the one mutation in this file that moves BOTH sources of truth at
// once: the membership role and `message_conversations.ownerId`. Everything else
// here follows from that. If they can ever disagree, one of them dissolves a den
// the other still has to answer for, and a den with two owners has no rule at all
// for which one a management route means.
//
// So the tests below are mostly negative and structural: what a refusal leaves
// behind, what a refusal must never leave behind, and what a reader watching from
// outside the transaction can see while one is in flight. The happy path is the
// easy half.

const RUN_ID =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    .replaceAll("-", "_")
    .slice(0, 18);

const OWNER_ID = `dxfer-owner-${RUN_ID}`;
const ELDER_ID = `dxfer-elder-${RUN_ID}`;
const PLAIN_ID = `dxfer-plain-${RUN_ID}`;
const OUTSIDER_ID = `dxfer-outside-${RUN_ID}`;

const BASE_USER_IDS = [OWNER_ID, ELDER_ID, PLAIN_ID, OUTSIDER_ID];

// Every den this file makes, so afterAll can clear them even when a test failed
// part-way through.
const denIds: string[] = [];

async function createUser(id: string): Promise<void> {
  await prisma.orm.public.Users.create({
    displayName: id,
    email: `${id}@example.test`,
    id,
    username: id,
  });
}

// A den owned by OWNER_ID, with ELDER_ID already an Elder and PLAIN_ID a plain
// member. Both target shapes exist because the service must treat them the same
// and a future change that does not should fail here rather than in review.
async function makeDen(name: string): Promise<string> {
  const den = await createDen({
    creatorId: OWNER_ID,
    memberIds: [ELDER_ID, PLAIN_ID],
    name: `${name} ${RUN_ID}`,
  });
  denIds.push(den.id);
  await setDenMemberRole(den.id, OWNER_ID, ELDER_ID, "ADMIN");
  return den.id;
}

// The den row's ownerId, read fresh rather than carried around, because the whole
// subject of this file is that this column has to move.
async function ownerIdOf(conversationId: string): Promise<string | null> {
  const row = await prisma.orm.public.MessageConversations.select("ownerId")
    .where({ id: conversationId })
    .first();
  if (!row) {
    throw new Error("expected the den to exist");
  }
  return row.ownerId;
}

async function membershipSeqOf(conversationId: string): Promise<number> {
  const row = await prisma.orm.public.MessageConversations.select(
    "membershipSeq"
  )
    .where({ id: conversationId })
    .first();
  if (!row) {
    throw new Error("expected the den to exist");
  }
  return row.membershipSeq;
}

// Every membership row's role, so an assertion can be about the whole roster
// rather than about two rows it happened to check.
async function rolesOf(
  conversationId: string
): Promise<Record<string, string>> {
  const rows = await prisma.orm.public.MessageConversationMembers.select(
    "role",
    "userId"
  )
    .where((member) => member.conversationId.eq(conversationId))
    .all();
  return Object.fromEntries(rows.map((row) => [row.userId, row.role]));
}

async function ownerRows(conversationId: string): Promise<string[]> {
  const rows = await prisma.orm.public.MessageConversationMembers.select(
    "userId"
  )
    .where((member) =>
      and(member.conversationId.eq(conversationId), member.role.eq("OWNER"))
    )
    .all();
  return rows.map((row) => row.userId).toSorted();
}

// The code a call refused with, or a marker for the two things that are not a
// refusal. Written rather than read off a promise rejection so a test can assert
// WHICH refusal it was: a service that answered NOT_FOUND where SELF_ACTION
// belongs is broken in a way `rejects.toThrow()` would call a pass.
async function refusalCode(
  conversationId: string,
  actorId: string,
  targetUserId: string
): Promise<string> {
  try {
    await transferDenOwnership(conversationId, actorId, targetUserId);
  } catch (error) {
    return error instanceof DenError ? error.code : "NOT_A_DEN_ERROR";
  }
  return "ACCEPTED";
}

// Long enough for Redis to have delivered anything it was going to deliver, so
// "no announcement" means none was made rather than none had arrived yet.
const ANNOUNCE_SETTLE_MS = 200;

// How often the owner-count watcher below looks. Long enough that it is not a
// hundred queries a second against a pool the rest of the suite is sharing, and
// short enough that a window lasting one transaction is several polls wide.
const WATCH_POLL_MS = 5;

interface Announcement {
  channel: string;
  event: ReturnType<typeof parseMessageEvent>;
}

// Subscribes to the conversation channel, runs `mutation`, and returns what
// arrived. The conversation channel rather than the activity channels because
// this is the frame that carries `membershipSeq`, and the counter is half of what
// has to be asserted here.
async function collectAnnouncements(
  conversationId: string,
  mutation: () => Promise<unknown>
): Promise<Announcement[]> {
  const seen: Announcement[] = [];
  const subscription = await subscribeToChannel(
    messageChannel(conversationId),
    (channel, raw) => {
      seen.push({ channel, event: parseMessageEvent(raw) });
    }
  );
  try {
    await mutation();
    await Bun.sleep(ANNOUNCE_SETTLE_MS);
  } finally {
    await subscription.unsubscribe();
  }
  return seen;
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
    user.id.in(BASE_USER_IDS)
  ).deleteAndCount();
});

describe("handing a den to somebody else", () => {
  test("moves the role and the ownerId together, and the old owner becomes an Elder", async () => {
    const denId = await makeDen("Happy");
    expect(await ownerIdOf(denId)).toBe(OWNER_ID);

    await transferDenOwnership(denId, OWNER_ID, ELDER_ID);

    // Both sources of truth, in one read of each, because the guarantee is that
    // they cannot be observed apart.
    expect(await rolesOf(denId)).toEqual({
      [OWNER_ID]: "ADMIN",
      [ELDER_ID]: "OWNER",
      [PLAIN_ID]: "MEMBER",
    });
    expect(await ownerIdOf(denId)).toBe(ELDER_ID);
  });

  test("a plain member can be given the den, not only an Elder", async () => {
    // The service takes anybody on the roster. Restricting it to Elders would be a
    // second rule to keep in step with the UI's ladder, and it would be a rule
    // about ceremony rather than about capability.
    const denId = await makeDen("Plain target");
    await transferDenOwnership(denId, OWNER_ID, PLAIN_ID);
    expect(await getDenMembership(denId, PLAIN_ID)).toEqual({ role: "OWNER" });
    expect(await ownerIdOf(denId)).toBe(PLAIN_ID);
  });

  test("announces one owner_transferred carrying the post-increment counter", async () => {
    const denId = await makeDen("Announce");
    const before = await membershipSeqOf(denId);

    const seen = await collectAnnouncements(denId, () =>
      transferDenOwnership(denId, OWNER_ID, ELDER_ID)
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.event?.membershipAction).toBe("owner_transferred");
    expect(seen[0]?.event?.userId).toBe(OWNER_ID);
    // The counter moves by exactly one, in the row and in the frame. Two
    // increments for one change would make every later announcement look like a
    // gap, so every member refetches a roster that has not moved since.
    expect(seen[0]?.event?.membershipSeq).toBe(before + 1);
    expect(await membershipSeqOf(denId)).toBe(before + 1);
  });

  test("nobody is told they were removed, because nobody was", async () => {
    // Both people are still in the den at the end of it. A membership-ended
    // notification here would push a "you are no longer in this den" notice to
    // somebody who is very much still in it.
    const denId = await makeDen("Nobody left");
    await transferDenOwnership(denId, OWNER_ID, ELDER_ID);
    const notices = await prisma.orm.public.Notifications.select("id")
      .where((notice) =>
        and(
          notice.recipientId.in([OWNER_ID, ELDER_ID]),
          notice._type.eq("DEN_MEMBERSHIP_ENDED")
        )
      )
      .all();
    expect(notices).toEqual([]);
  });
});

describe("a transfer it will not do", () => {
  test("an Elder cannot hand the den on", async () => {
    // `requireDenOwner`, before anything is read or written. The claim lock is the
    // owner's alone to take.
    const denId = await makeDen("Not the owner");
    await expect(
      transferDenOwnership(denId, ELDER_ID, PLAIN_ID)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("somebody who is not in the den at all cannot", async () => {
    const denId = await makeDen("Outsider");
    await expect(
      transferDenOwnership(denId, OUTSIDER_ID, PLAIN_ID)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("the owner cannot hand it to themselves", async () => {
    // SELF_ACTION, not FORBIDDEN: the state the request asks for is already true,
    // which is what that code means, and it is the same code the other two
    // targeted mutations use for it.
    const denId = await makeDen("Self");
    await expect(
      transferDenOwnership(denId, OWNER_ID, OWNER_ID)
    ).rejects.toMatchObject({ code: "SELF_ACTION" });
    expect(await ownerIdOf(denId)).toBe(OWNER_ID);
  });

  test("it cannot be handed to somebody who is not a member", async () => {
    // NOT_FOUND rather than FORBIDDEN: from the owner's side the target does not
    // exist as a candidate, and a 403 would imply the person exists and the
    // owner merely lacks the right.
    const denId = await makeDen("Stranger");
    await expect(
      transferDenOwnership(denId, OWNER_ID, OUTSIDER_ID)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a den that does not exist is a clean refusal", async () => {
    await expect(
      transferDenOwnership(`missing-${RUN_ID}`, OWNER_ID, ELDER_ID)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("every refusal leaves both the roles and the ownerId exactly as they were", async () => {
    // The whole point of doing the checks inside one transaction under the claim
    // lock: a refusal is indistinguishable from never having been asked. This
    // walks every refusal the service can produce and then reads all three facts.
    const denId = await makeDen("Untouched");
    const before = {
      counter: await membershipSeqOf(denId),
      owner: await ownerIdOf(denId),
      roles: await rolesOf(denId),
    };

    // Every refusal the service can produce for this call, in one read each. The
    // codes are asserted rather than the promise rejections, because "it threw"
    // is not the property worth pinning - WHICH refusal it was is.
    expect([
      await refusalCode(denId, OWNER_ID, OWNER_ID),
      await refusalCode(denId, OWNER_ID, OUTSIDER_ID),
      await refusalCode(denId, ELDER_ID, PLAIN_ID),
      await refusalCode(denId, OUTSIDER_ID, PLAIN_ID),
      await refusalCode(`missing-${RUN_ID}`, OWNER_ID, ELDER_ID),
    ]).toEqual([
      "SELF_ACTION",
      "NOT_FOUND",
      "FORBIDDEN",
      "FORBIDDEN",
      "NOT_FOUND",
    ]);

    expect(await rolesOf(denId)).toEqual(before.roles);
    expect(await ownerIdOf(denId)).toBe(before.owner);
    // The counter too. A refusal that moved it would make every open thread
    // refetch a roster that never changed, and would make the next real change
    // look like a gap.
    expect(await membershipSeqOf(denId)).toBe(before.counter);
  });

  test("a refused transfer announces nothing", async () => {
    const denId = await makeDen("Quiet refusal");
    const seen = await collectAnnouncements(denId, async () => {
      await expect(
        transferDenOwnership(denId, OWNER_ID, OUTSIDER_ID)
      ).rejects.toBeInstanceOf(DenError);
      await expect(
        transferDenOwnership(denId, ELDER_ID, PLAIN_ID)
      ).rejects.toBeInstanceOf(DenError);
    });
    expect(seen).toEqual([]);
  });
});

describe("exactly one owner, always", () => {
  test("a reader watching from outside never sees two owners or none", async () => {
    // The invariant, observed rather than asserted from the code: while the
    // transaction is open the rows are the ones it wrote, and while it is closed
    // they are the ones before. There is no third answer, and this is what proves
    // it - a loop reading the roster in its own connection while transfers commit
    // underneath it, which is exactly the window a half-applied transfer would
    // show.
    //
    // Several transfers rather than one, because the window a regression would
    // open is as wide as the gap between two transactions - a round trip - and one
    // sample of that is a coin toss. Eight handovers in both directions gives it
    // eight chances and costs milliseconds.
    const denId = await makeDen("Watched");
    let watching = true;
    let worstSeen = 0;
    let reads = 0;
    const watcher = (async () => {
      // oxlint-disable-next-line no-unmodified-loop-condition -- the flag is flipped by the transfers below, from outside this closure
      while (watching) {
        // oxlint-disable-next-line no-await-in-loop -- a polling loop, each read must settle before the next
        const rows = await ownerRows(denId);
        reads += 1;
        worstSeen = Math.max(worstSeen, rows.length);
        if (rows.length !== 1) {
          throw new Error(`saw ${rows.length} owners`);
        }
        // oxlint-disable-next-line no-await-in-loop -- a polling loop, see above
        await Bun.sleep(WATCH_POLL_MS);
      }
    })();

    try {
      for (let round = 0; round < 8; round += 1) {
        const to = round % 2 === 0 ? ELDER_ID : OWNER_ID;
        const from = round % 2 === 0 ? OWNER_ID : ELDER_ID;
        // oxlint-disable-next-line no-await-in-loop -- sequential on purpose, each handover must land before the next
        await transferDenOwnership(denId, from, to);
      }
    } finally {
      watching = false;
      // oxlint-disable-next-line no-await-in-loop -- settling the poller, see above
      await watcher;
    }

    // A watcher that never ran would make the two assertions above pass for the
    // wrong reason, which is the one way an observational test lies.
    expect(reads).toBeGreaterThan(1);
    expect(worstSeen).toBe(1);
    // An even number of handovers, so the den is back where it started.
    expect(await ownerIdOf(denId)).toBe(OWNER_ID);
  });

  test("two transfers from the same owner leave one owner, and one refusal", async () => {
    // The case the in-transaction re-check exists for. Both callers pass
    // `requireDenOwner` before either takes the claim, so the loser is refused
    // while holding it - and without that re-check it would promote a second
    // owner and demote an actor who is already an Elder.
    const denId = await makeDen("Contended");
    const outcomes = await Promise.allSettled([
      transferDenOwnership(denId, OWNER_ID, ELDER_ID),
      transferDenOwnership(denId, OWNER_ID, PLAIN_ID),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled")
    ).toHaveLength(1);
    const refused = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected"
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toMatchObject({ code: "FORBIDDEN" });

    expect(await ownerRows(denId)).toHaveLength(1);
    // And the one that won is the owner in BOTH places, not one of them.
    const [owner] = await ownerRows(denId);
    expect(await ownerIdOf(denId)).toBe(owner);
  });
});

describe("what the new owner can do about it", () => {
  test("the new owner can dissolve the den, and the old owner cannot", async () => {
    // The consequence the confirmation copy promises. If this pair disagreed, the
    // copy would be a lie and the button that caused it would have taken away a
    // control the reader still has.
    const denId = await makeDen("Dissolve");
    await transferDenOwnership(denId, OWNER_ID, ELDER_ID);

    await expect(dissolveDen(denId, ELDER_ID)).resolves.toBeUndefined();
    const gone = await prisma.orm.public.MessageConversations.select("id")
      .where({ id: denId })
      .first();
    expect(gone).toBeNull();
  });

  test("the old owner is refused, and is not an owner any more", async () => {
    const denId = await makeDen("Refused dissolve");
    await transferDenOwnership(denId, OWNER_ID, ELDER_ID);
    await expect(dissolveDen(denId, OWNER_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Still an Elder, so still able to do what an Elder can: add and remove.
    expect(await getDenMembership(denId, OWNER_ID)).toEqual({ role: "ADMIN" });
    expect(await rolesOf(denId)).toEqual({
      [OWNER_ID]: "ADMIN",
      [ELDER_ID]: "OWNER",
      [PLAIN_ID]: "MEMBER",
    });
  });

  test("the old owner can hand it straight back", async () => {
    // A handover is not one-way. The previous owner is an Elder with full
    // management rights, and ownership is theirs to give again if they change
    // their mind.
    const denId = await makeDen("Back again");
    await transferDenOwnership(denId, OWNER_ID, ELDER_ID);
    await transferDenOwnership(denId, ELDER_ID, OWNER_ID);
    expect(await rolesOf(denId)).toEqual({
      [OWNER_ID]: "OWNER",
      [ELDER_ID]: "ADMIN",
      [PLAIN_ID]: "MEMBER",
    });
    expect(await ownerIdOf(denId)).toBe(OWNER_ID);
  });

  test("leaving still transfers ownership, and still moves both", async () => {
    // The pre-existing path, unchanged and still asserted: it is the other way
    // ownership moves, and a change that made the two disagree would be invisible
    // until a founder walked out of a den nobody else could manage.
    const denId = await makeDen("Leave transfer");
    const result = await leaveDen(denId, OWNER_ID);
    expect(result).toMatchObject({ dissolved: false, newOwnerId: ELDER_ID });
    expect(await rolesOf(denId)).toEqual({
      [ELDER_ID]: "OWNER",
      [PLAIN_ID]: "MEMBER",
    });
    expect(await ownerIdOf(denId)).toBe(ELDER_ID);
  });

  test("a new owner leaving passes it on again, by tenure", async () => {
    const denId = await makeDen("Leave twice");
    await transferDenOwnership(denId, OWNER_ID, ELDER_ID);
    await transferDenOwnership(denId, ELDER_ID, PLAIN_ID);
    const result = await leaveDen(denId, PLAIN_ID);
    expect(result).toMatchObject({ dissolved: false, newOwnerId: OWNER_ID });
    expect(await ownerRows(denId)).toEqual([OWNER_ID]);
    expect(await ownerIdOf(denId)).toBe(OWNER_ID);
  });
});
