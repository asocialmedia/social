import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import {
  addDenMembers,
  banDenMember,
  createDen,
  dissolveDen,
  filterBannedUserIds,
  getDenMembership,
  isDenBanned,
  joinDenByInviteCode,
  leaveDen,
  listDenBans,
  prisma,
  removeDenMember,
  unbanDenMember,
} from "@asm/db";
import { and } from "@prisma/orm-postgres/orm-client";

// Bans, against a live database.
//
// The whole point of this feature is that the two ways in AGREE, and neither a unit
// test nor a mocked route can prove that: the join door and the direct-add door are
// different services reading the same fact, and the bug this guards against is one of
// them quietly not asking. So these are written as the abuse report rather than as the
// API - a kicked person walking back in through a link somebody else still holds - and
// each refusal is checked through BOTH doors.
//
// Every test builds its own den, because a shared fixture plus a shared ban row would
// let one test's unban decide another test's answer.

const RUN_ID = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;

const OWNER = `ban-owner-${RUN_ID}`;
const ELDER = `ban-elder-${RUN_ID}`;
const MEMBER = `ban-member-${RUN_ID}`;
// The person this file is about: removed, then banned, and holding a live code.
const SUBJECT = `ban-subject-${RUN_ID}`;
// Somebody who holds the same code and must be entirely unaffected by it.
const BYSTANDER = `ban-bystander-${RUN_ID}`;
const OUTSIDER = `ban-outsider-${RUN_ID}`;
// The two accounts the delete-rule cases below destroy. Their own, deliberately: those
// cases delete a user, and a shared fixture that a deletion poisons makes every test
// after them fail for a reason that has nothing to do with them. Seen the hard way.
const RETIRED_ELDER = `ban-retired-elder-${RUN_ID}`;
const DELETED_TARGET = `ban-deleted-target-${RUN_ID}`;
const RETIRED_TARGET = `ban-retired-target-${RUN_ID}`;

const USER_IDS = [
  OWNER,
  ELDER,
  MEMBER,
  SUBJECT,
  BYSTANDER,
  OUTSIDER,
  RETIRED_ELDER,
  DELETED_TARGET,
  RETIRED_TARGET,
];

const denIds: string[] = [];

// A den whose code is live, holding the owner, an elder and a plain member, plus the
// subject when the test needs them on the roster.
async function makeDen(subjectOnRoster: boolean): Promise<string> {
  const den = await createDen({
    creatorId: OWNER,
    memberIds: subjectOnRoster ? [ELDER, MEMBER, SUBJECT] : [ELDER, MEMBER],
    name: `Ban ${RUN_ID}`,
  });
  denIds.push(den.id);
  // Scoped to THIS den. The run-scoped ids make it idempotent in practice, but an
  // unscoped update would also promote every other membership row this account holds
  // anywhere in the database - including rows another file created for the same id - and
  // a test that quietly edits state it does not own is a test that can fail for reasons
  // its author never sees.
  await prisma.orm.public.MessageConversationMembers.where((member) =>
    and(member.userId.eq(ELDER), member.conversationId.eq(den.id))
  ).updateAndCount({ role: "ADMIN" });
  return den.id;
}

async function inviteCodeOf(conversationId: string): Promise<string> {
  const row = await prisma.orm.public.MessageConversations.select("inviteCode")
    .where({ id: conversationId })
    .first();
  if (!row?.inviteCode) {
    throw new Error("den has no invite code");
  }
  return row.inviteCode;
}

beforeAll(async () => {
  await prisma.orm.public.Users.createAll(
    USER_IDS.map((id) => ({
      displayName: id,
      email: `${id}@example.test`,
      id,
      username: id,
    }))
  );
});

afterAll(async () => {
  // Dens first: they cascade their members, keys and bans.
  if (denIds.length > 0) {
    await prisma.orm.public.MessageConversations.where((conversation) =>
      conversation.id.in(denIds)
    ).deleteAndCount();
  }
  await prisma.orm.public.Users.where((user) =>
    user.id.in(USER_IDS)
  ).deleteAndCount();
});

describe("banning somebody who is still inside", () => {
  test("removes them and locks the door in one go", async () => {
    const denId = await makeDen(true);

    await banDenMember(denId, OWNER, SUBJECT, { reason: "spam" });

    // Out of the room...
    const membership = await getDenMembership(denId, SUBJECT);
    expect(membership?.leftAt ?? null).not.toBeNull();
    // ...and the door shut behind them.
    expect(await isDenBanned(denId, SUBJECT)).toBe(true);
  });

  // The bug this whole file is about, and the reason a ban cannot be a separate call
  // made after a removal.
  test("cannot come back through the very link that let them in", async () => {
    const denId = await makeDen(true);
    const code = await inviteCodeOf(denId);
    await banDenMember(denId, OWNER, SUBJECT);

    await expect(joinDenByInviteCode(code, SUBJECT)).rejects.toMatchObject({
      code: "BANNED",
    });
    // Still out, so the refusal wrote no membership row.
    const membership = await getDenMembership(denId, SUBJECT);
    expect(membership?.leftAt ?? null).not.toBeNull();
  });

  // The case that makes rotation the wrong tool. Somebody else is holding a working
  // link; the ban has to hold against it without the den invalidating anything.
  test("the current link is refused, rotation or not", async () => {
    const denId = await makeDen(true);
    await banDenMember(denId, OWNER, SUBJECT);

    await expect(
      joinDenByInviteCode(await inviteCodeOf(denId), SUBJECT)
    ).rejects.toMatchObject({ code: "BANNED" });
  });

  test("cannot be added back by a manager", async () => {
    const denId = await makeDen(true);
    await banDenMember(denId, OWNER, SUBJECT);

    await expect(addDenMembers(denId, OWNER, [SUBJECT])).rejects.toMatchObject({
      code: "BANNED",
    });
  });

  // The bystander is the control that makes every refusal above mean something: had the
  // ban been written as "this den has stopped accepting joins", this would fail.
  test("leaves everybody else alone", async () => {
    const denId = await makeDen(true);
    const code = await inviteCodeOf(denId);
    await banDenMember(denId, OWNER, SUBJECT);

    await expect(joinDenByInviteCode(code, BYSTANDER)).resolves.toMatchObject({
      alreadyMember: false,
    });
    const bystander = await getDenMembership(denId, BYSTANDER);
    expect(bystander?.leftAt ?? null).toBeNull();
  });

  test("an Elder may ban a plain member", async () => {
    const denId = await makeDen(true);
    await banDenMember(denId, ELDER, SUBJECT);
    expect(await isDenBanned(denId, SUBJECT)).toBe(true);
  });

  test("refuses to ban the owner", async () => {
    const denId = await makeDen(false);
    await expect(banDenMember(denId, ELDER, OWNER)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("refuses to ban yourself", async () => {
    const denId = await makeDen(false);
    await expect(banDenMember(denId, ELDER, ELDER)).rejects.toMatchObject({
      code: "SELF_ACTION",
    });
  });

  // A ban aimed at somebody who has never been in the room is a preemptive ban of a
  // stranger, which this product has no surface for and no reason to have: a den is not
  // a blocklist.
  test("refuses to ban somebody who was never a member", async () => {
    const denId = await makeDen(false);
    await expect(banDenMember(denId, OWNER, OUTSIDER)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("banning somebody who has already left", () => {
  // The case the feature is really for: somebody removed last week who is now coming
  // back through a link somebody else still holds.
  test("writes the ban without a second removal", async () => {
    const denId = await makeDen(true);
    await removeDenMember(denId, OWNER, SUBJECT);

    await banDenMember(denId, OWNER, SUBJECT, { reason: "second offence" });

    expect(await isDenBanned(denId, SUBJECT)).toBe(true);
    const events =
      await prisma.orm.public.MessageConversationMembershipEvents.select(
        "action"
      )
        .where((event) =>
          and(event.conversationId.eq(denId), event.targetUserId.eq(SUBJECT))
        )
        .all();
    // Exactly one REMOVED line, from the removal that already happened. A ban is not a
    // second event and the transcript must not say it is.
    expect(events.filter((event) => event.action === "REMOVED")).toHaveLength(
      1
    );
  });

  test("the departed one is refused the link as well", async () => {
    const denId = await makeDen(true);
    const code = await inviteCodeOf(denId);
    await removeDenMember(denId, OWNER, SUBJECT);
    await banDenMember(denId, OWNER, SUBJECT);

    await expect(joinDenByInviteCode(code, SUBJECT)).rejects.toMatchObject({
      code: "BANNED",
    });
  });

  // The asymmetry that makes the feature coherent: leaving is not misconduct, so it must
  // not be punished. This is the case a naive "ban everyone who left" would break.
  test("a voluntary leaver is NOT refused", async () => {
    const denId = await makeDen(true);
    const code = await inviteCodeOf(denId);
    await leaveDen(denId, SUBJECT);

    expect(await isDenBanned(denId, SUBJECT)).toBe(false);
    await expect(joinDenByInviteCode(code, SUBJECT)).resolves.toMatchObject({
      alreadyMember: false,
    });
  });

  // Removal on its own grants nothing about the future, and that is deliberate: it is
  // the right tool for somebody removed in error.
  test("a removal without a ban still lets them back", async () => {
    const denId = await makeDen(true);
    const code = await inviteCodeOf(denId);
    await removeDenMember(denId, OWNER, SUBJECT);

    await expect(joinDenByInviteCode(code, SUBJECT)).resolves.toMatchObject({
      alreadyMember: false,
    });
  });
});

describe("lifting a ban", () => {
  test("restores eligibility without adding anybody back", async () => {
    const denId = await makeDen(true);
    const code = await inviteCodeOf(denId);
    await banDenMember(denId, OWNER, SUBJECT);

    await unbanDenMember(denId, OWNER, SUBJECT);

    expect(await isDenBanned(denId, SUBJECT)).toBe(false);
    // Still out. Unbanning is a permission, not a put-back.
    const membership = await getDenMembership(denId, SUBJECT);
    expect(membership?.leftAt ?? null).not.toBeNull();
    // And the link now works again.
    await expect(joinDenByInviteCode(code, SUBJECT)).resolves.toMatchObject({
      alreadyMember: false,
    });
  });

  test("an unban of somebody who is not banned is not an error", async () => {
    const denId = await makeDen(false);
    await expect(
      unbanDenMember(denId, OWNER, SUBJECT)
    ).resolves.toBeUndefined();
  });

  test("only a manager may lift a ban", async () => {
    const denId = await makeDen(true);
    await banDenMember(denId, OWNER, SUBJECT);
    await expect(unbanDenMember(denId, MEMBER, SUBJECT)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await isDenBanned(denId, SUBJECT)).toBe(true);
  });
});

describe("reading the ban list", () => {
  test("carries the display fields the row is drawn from", async () => {
    const denId = await makeDen(true);
    await banDenMember(denId, ELDER, SUBJECT, { reason: "link spam" });

    const bans = await listDenBans(denId, OWNER);
    const found = bans.find((ban) => ban.userId === SUBJECT);
    expect(found?.userId).toBe(SUBJECT);
    expect(found?.reason).toBe("link spam");
    // Read live rather than snapshotted, so a ban row that stores no name columns
    // cannot leave a manager looking at a blank row for somebody who exists.
    expect(found?.displayName).toBe(SUBJECT);
    expect(found?.username).toBe(SUBJECT);
    expect(found?.bannedByName).toBe(ELDER);
    expect(found?.bannedById).toBe(ELDER);
  });

  test("a plain member may not read it at all", async () => {
    // A ban is a decision about a person made by somebody else; the room is not party
    // to it, which is the reasoning that keeps departed members out of roster
    // announcements.
    const denId = await makeDen(true);
    await banDenMember(denId, OWNER, SUBJECT);
    await expect(listDenBans(denId, MEMBER)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("lifting the last ban empties the list", async () => {
    const denId = await makeDen(true);
    await banDenMember(denId, OWNER, SUBJECT);
    const before = await listDenBans(denId, OWNER);
    expect(before.some((ban) => ban.userId === SUBJECT)).toBe(true);

    await unbanDenMember(denId, OWNER, SUBJECT);

    const after = await listDenBans(denId, OWNER);
    expect(after.some((ban) => ban.userId === SUBJECT)).toBe(false);
  });
});

describe("the bulk ban read the picker uses", () => {
  test("answers about exactly the accounts asked for", async () => {
    const denId = await makeDen(true);
    await banDenMember(denId, OWNER, SUBJECT);

    const banned = await filterBannedUserIds(denId, [
      SUBJECT,
      BYSTANDER,
      OUTSIDER,
    ]);
    expect([...banned]).toEqual([SUBJECT]);
  });

  test("is empty for an empty list", async () => {
    const denId = await makeDen(false);
    const banned = await filterBannedUserIds(denId, []);
    expect(banned.size).toBe(0);
  });
});

describe("what happens to a ban when the rows around it go", () => {
  // The three delete rules are the entire failure mode the schema comment warns about,
  // and nothing else in the repo would notice if one of them were wrong. `bannedById`
  // in particular: were it Cascade rather than SetNull, deleting the account of one
  // Elder would silently un-ban every person they ever banned, and every test in the
  // repository would still pass.
  //
  // Each case builds and destroys its own den so the deletes below cannot take anything
  // another test is using.
  test("dissolving the den takes its bans with it", async () => {
    const denId = await makeDen(true);
    await banDenMember(denId, OWNER, SUBJECT);
    expect(await isDenBanned(denId, SUBJECT)).toBe(true);

    await dissolveDen(denId, OWNER);

    expect(await isDenBanned(denId, SUBJECT)).toBe(false);
  });

  test("deleting the banned person takes the ban with them", async () => {
    // Cascade, and the right way round: a ban row whose target no longer exists has
    // nothing to keep out of anything.
    const denId = await makeDen(true);
    await addDenMembers(denId, OWNER, [DELETED_TARGET]);
    await banDenMember(denId, OWNER, DELETED_TARGET);

    // Off the roster first - membership rows reference the account restrictively - then
    // the account itself.
    await prisma.orm.public.MessageConversationMembers.where((member) =>
      and(member.userId.eq(DELETED_TARGET), member.conversationId.eq(denId))
    ).deleteAndCount();
    await prisma.orm.public.Users.where({
      id: DELETED_TARGET,
    }).deleteAndCount();

    expect(await isDenBanned(denId, DELETED_TARGET)).toBe(false);
  });

  // The one that matters, and the reason for the SetNull.
  test("deleting the Elder who banned them does NOT lift the ban", async () => {
    // The target has to be on the roster to be banned at all - a ban needs an existing
    // membership row - and the throwaway OWNS this den, which is the simplest way to
    // give it the authority to ban without adding it to a shared fixture.
    const den = await createDen({
      creatorId: RETIRED_ELDER,
      memberIds: [RETIRED_TARGET],
      name: `Ban retired ${RUN_ID}`,
    });
    denIds.push(den.id);
    await banDenMember(den.id, RETIRED_ELDER, RETIRED_TARGET);

    // Off the roster first. Membership rows reference the account restrictively - a
    // den's roster is taken apart in order on purpose - so the account cannot be removed
    // while the row is there. That row is not what this test is about; the ban row's
    // foreign key is.
    await prisma.orm.public.MessageConversationMembers.where((member) =>
      and(member.userId.eq(RETIRED_ELDER), member.conversationId.eq(den.id))
    ).deleteAndCount();
    await prisma.orm.public.Users.where({ id: RETIRED_ELDER }).deleteAndCount();

    // Still barred.
    expect(await isDenBanned(den.id, RETIRED_TARGET)).toBe(true);
    await expect(
      joinDenByInviteCode(await inviteCodeOf(den.id), RETIRED_TARGET)
    ).rejects.toMatchObject({ code: "BANNED" });

    // The row survived with its author nulled rather than cascaded, which is the whole
    // reason the foreign key is SetNull. Read straight from the table: the account that
    // could have read it through the route is the one just deleted, and the remaining
    // members of this den are the target.
    const row = await prisma.orm.public.MessageDenBans.where((ban) =>
      and(ban.conversationId.eq(den.id), ban.userId.eq(RETIRED_TARGET))
    ).first();
    expect(row).not.toBeNull();
    expect(row?.bannedById ?? null).toBeNull();
  });
});
