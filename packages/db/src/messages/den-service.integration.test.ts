import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { randomUUID } from "node:crypto";

import {
  DEN_LIMITS,
  addDenMembers,
  createDen,
  dissolveDen,
  fromPrismaDateTime,
  getDenMembership,
  joinDenByInviteCode,
  leaveDen,
  listDenMembershipEvents,
  messageActivityChannel,
  messageChannel,
  parseMessageActivityEvent,
  parseMessageEvent,
  prisma,
  previewInvite,
  removeDenMember,
  rotateInviteCode,
  setDenMemberRole,
  subscribeToChannel,
  transferDenOwnership,
  updateDenDetails,
} from "@asm/db";
import { and, or } from "@prisma/orm-postgres/orm-client";

// Coverage for the den mutation layer against a live database: the role model,
// the member cap under concurrent writers, ownership transfer, dissolving, and
// the invite door.
//
// The service is the authority on every rule here, so these tests drive it
// directly. A route test would prove the route forwards correctly; it could not
// prove the rule, because the route delegates.

const RUN_ID =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    .replaceAll("-", "_")
    .slice(0, 18);

const OWNER_ID = `dsvc-owner-${RUN_ID}`;
const ADMIN_ID = `dsvc-admin-${RUN_ID}`;
const OLDEST_ID = `dsvc-oldest-${RUN_ID}`;
const NEWEST_ID = `dsvc-newest-${RUN_ID}`;
const OUTSIDER_ID = `dsvc-outsider-${RUN_ID}`;

const BASE_USER_IDS = [OWNER_ID, ADMIN_ID, OLDEST_ID, NEWEST_ID, OUTSIDER_ID];

async function createUser(id: string): Promise<void> {
  await prisma.orm.public.Users.create({
    displayName: id,
    email: `${id}@example.test`,
    id,
    username: id,
  });
}

// The bulk form, for the hundred-account casts the two contention tests below
// need. One multi-row INSERT rather than a hundred round trips, because the
// cast is not what either of those tests is measuring: the property is what
// happens when a hundred writers collide on one den's claim lock, and the time
// spent assembling the crowd should not be charged to the collision. It also
// keeps a hundred-account fixture from being the slowest thing in the file.
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

// Every den this file makes, so afterAll can clear them even when a test failed
// part-way through.
const denIds: string[] = [];

// The budget for the two hundred-way races below, and the only timeout in this
// file that is not the default.
//
// A hundred-way race is the only kind of test here whose runtime is the point
// rather than an accident. The claim lock serializes all hundred writers onto
// one den row, so the wall clock is a hundred transactions queued behind each
// other's row locks: about a second against an idle database, and several times
// that when the rest of the suite is running alongside on the same Postgres.
//
// The 5s default is not a bound these tests can be held to without gutting what
// they prove. The way to fit inside it is to fire fewer writers than the ceiling
// admits, and then nothing is ever refused and a den with no cap at all would
// pass. Thirty seconds is roughly an order of magnitude over the idle cost and
// far over anything the loaded case has actually reached.
//
// Options go last: this is the (label, fn, options) overload in the pinned
// bun-types.
const CONTENTION_TIMEOUT_MS = 30_000;

async function makeDen(
  memberIds: string[] = [],
  overrides: { name?: string } = {}
): Promise<string> {
  const den = await createDen({
    creatorId: OWNER_ID,
    memberIds,
    name: overrides.name ?? `Den ${RUN_ID}`,
  });
  denIds.push(den.id);
  return den.id;
}

// The fixture user ids read as roles but are only ids, so a den built with
// `makeDen([ADMIN_ID])` holds ADMIN_ID as a plain MEMBER. Anything that needs a
// real admin promotes one explicitly, which also keeps the promotion path under
// test in the fixtures that rely on it.
async function makeDenWithAdmin(
  memberIds: string[] = [],
  overrides: { name?: string } = {}
): Promise<string> {
  const denId = await makeDen(memberIds, overrides);
  const admin = memberIds.find((id) => id !== OWNER_ID);
  if (admin) {
    await setDenMemberRole(denId, OWNER_ID, admin, "ADMIN");
  }
  return denId;
}

// The conversation row's clock, in milliseconds. Membership movement has to show up
// here: it is the one change signal a client holding a cached conversation detail
// can compare against, and nothing inside the snapshot itself reveals it.
async function denUpdatedAt(conversationId: string): Promise<number> {
  const row = await prisma.orm.public.MessageConversations.select("updatedAt")
    .where({ id: conversationId })
    .first();
  if (!row) {
    throw new Error("expected the den to exist");
  }
  return fromPrismaDateTime(row.updatedAt).getTime();
}

// A block row, read-then-written so the fixture's own facts about its accounts
// can be restated by more than one test without colliding on the primary key.
// Module scope because it captures nothing from the suite below.
async function ensureBlock(
  blockerId: string,
  blockedId: string
): Promise<void> {
  const existing = await prisma.orm.public.Blocks.select("blockerId")
    .where({ blockedId, blockerId })
    .first();
  if (existing) {
    return;
  }
  await prisma.orm.public.Blocks.create({ blockedId, blockerId });
}

// A den's live join code, read on demand because rotation is one of the things
// these tests do to a den they have just built.
async function inviteCodeOf(conversationId: string): Promise<string> {
  const row = await prisma.orm.public.MessageConversations.select("inviteCode")
    .where({ id: conversationId })
    .first();
  return row?.inviteCode ?? "";
}

// Who can act in the den. The departed keep their rows, so counting every row
// would say a den still has somebody in it after they walked out.
async function memberCount(conversationId: string): Promise<number> {
  const counted = await prisma.orm.public.MessageConversationMembers.where(
    (member) =>
      and(member.conversationId.eq(conversationId), member.leftAt.isNull())
  ).aggregate((aggregate) => ({ count: aggregate.count() }));
  return counted.count;
}

// Every row, departed included. Only the assertions about history outliving a
// departure need this, and only they can tell the two apart from each other.
async function membershipRowCount(conversationId: string): Promise<number> {
  const counted = await prisma.orm.public.MessageConversationMembers.where(
    (member) => member.conversationId.eq(conversationId)
  ).aggregate((aggregate) => ({ count: aggregate.count() }));
  return counted.count;
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

describe("den creation", () => {
  test("writes the creator as OWNER and the rest as MEMBER with provenance", async () => {
    const denId = await makeDen([ADMIN_ID, OLDEST_ID]);

    const rows = await prisma.orm.public.MessageConversationMembers.select(
      "invitedById",
      "role",
      "userId"
    )
      .where((member) => member.conversationId.eq(denId))
      .all();
    const byUser = new Map(rows.map((row) => [row.userId, row]));

    expect(byUser.get(OWNER_ID)?.role).toBe("OWNER");
    expect(byUser.get(ADMIN_ID)?.role).toBe("MEMBER");
    expect(byUser.get(OLDEST_ID)?.role).toBe("MEMBER");
    // The creator has no referrer: they did not join, they made it.
    expect(byUser.get(OWNER_ID)?.invitedById).toBeNull();
    expect(byUser.get(ADMIN_ID)?.invitedById).toBe(OWNER_ID);

    const den = await prisma.orm.public.MessageConversations.select(
      "_type",
      "createdById",
      "inviteCode",
      "ownerId",
      "pairKey"
    )
      .where({ id: denId })
      .first();
    expect(den?._type).toBe("DEN");
    expect(den?.ownerId).toBe(OWNER_ID);
    expect(den?.createdById).toBe(OWNER_ID);
    // A den has no pair: that column is the DM dedup key and must stay null or it
    // would collide with a real conversation row.
    expect(den?.pairKey).toBeNull();
    expect(den?.inviteCode).toHaveLength(DEN_LIMITS.inviteCodeLength);
  });

  test("listing the creator among the members does not duplicate them", async () => {
    const denId = await makeDen([OWNER_ID, ADMIN_ID]);
    expect(await memberCount(denId)).toBe(2);
    expect(await getDenMembership(denId, OWNER_ID)).toEqual({
      leftAt: null,
      role: "OWNER",
    });
  });

  test("refuses a den of one, which is a DM with extra steps", async () => {
    await expect(
      createDen({ creatorId: OWNER_ID, memberIds: [], name: "Solo" })
    ).rejects.toMatchObject({ code: "MEMBERS_REQUIRED" });
  });

  test("refuses a roster over the cap before writing anything", async () => {
    const tooMany = Array.from(
      { length: DEN_LIMITS.membersMax + 1 },
      (_unused, index) => `ghost-${RUN_ID}-${index}`
    );
    await expect(
      createDen({
        creatorId: OWNER_ID,
        memberIds: tooMany,
        name: "Too many",
      })
    ).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });

  test("normalizes the name so cosmetic variants are one den", async () => {
    const denId = await makeDen([ADMIN_ID], { name: "  game   night " });
    const den = await prisma.orm.public.MessageConversations.select("name")
      .where({ id: denId })
      .first();
    expect(den?.name).toBe("game night");
  });

  test("refuses a blank name that the database CHECK would also refuse", async () => {
    await expect(
      createDen({ creatorId: OWNER_ID, memberIds: [ADMIN_ID], name: "   " })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("gives every den a distinct code", async () => {
    const first = await makeDen([ADMIN_ID]);
    const second = await makeDen([ADMIN_ID]);
    const codes = await prisma.orm.public.MessageConversations.select(
      "inviteCode"
    )
      .where((conversation) =>
        or(conversation.id.eq(first), conversation.id.eq(second))
      )
      .all();
    expect(codes[0]?.inviteCode).not.toBe(codes[1]?.inviteCode);
  });
});

describe("den role model", () => {
  test("an admin may add members, a plain member may not", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);

    await addDenMembers(denId, ADMIN_ID, [NEWEST_ID]);
    expect(await getDenMembership(denId, NEWEST_ID)).toEqual({
      leftAt: null,
      role: "MEMBER",
    });

    // NEWEST is a plain member and the den is full of members they do not
    // manage, so this must be refused.
    await expect(
      addDenMembers(denId, NEWEST_ID, [OUTSIDER_ID])
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("only the owner may promote, and only to ADMIN", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);

    // The owner does the promoting. ADMIN_ID is an admin here and not the owner,
    // so using it as the actor would be testing a refusal, not a promotion.
    await setDenMemberRole(denId, OWNER_ID, OLDEST_ID, "ADMIN");
    expect(await getDenMembership(denId, OLDEST_ID)).toEqual({
      leftAt: null,
      role: "ADMIN",
    });

    // An admin cannot promote a peer, even to the role they hold themselves.
    await expect(
      setDenMemberRole(denId, ADMIN_ID, NEWEST_ID, "ADMIN")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("OWNER is not an assignable role", async () => {
    // Ownership moves by leaving or by dissolving, never by promotion, so there
    // is exactly one way it can change and no route that can mint a second owner.
    const denId = await makeDen([ADMIN_ID, OLDEST_ID]);
    await expect(
      setDenMemberRole(denId, OWNER_ID, OLDEST_ID, "OWNER")
    ).rejects.toMatchObject({ code: "INVALID_ROLE" });
  });

  test("the owner cannot be demoted or removed", async () => {
    const denId = await makeDen([ADMIN_ID, OLDEST_ID]);
    await expect(
      setDenMemberRole(denId, OWNER_ID, OWNER_ID, "MEMBER")
    ).rejects.toMatchObject({ code: "SELF_ACTION" });
    await expect(
      removeDenMember(denId, ADMIN_ID, OWNER_ID)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      removeDenMember(denId, OWNER_ID, OWNER_ID)
    ).rejects.toMatchObject({ code: "SELF_ACTION" });
  });

  test("an admin cannot remove a non-member, or a DM", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await expect(
      removeDenMember(denId, ADMIN_ID, OUTSIDER_ID)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const dm = await prisma.orm.public.MessageConversations.create({
      pairKey: [OWNER_ID, OUTSIDER_ID].toSorted().join(":"),
    });
    denIds.push(dm.id);
    await prisma.orm.public.MessageConversationMembers.create({
      conversationId: dm.id,
      userId: OWNER_ID,
    });
    // A DM row carries MEMBER too, so only the type check stops a management
    // route from being aimed at somebody's private thread.
    await expect(
      addDenMembers(dm.id, OWNER_ID, [NEWEST_ID])
    ).rejects.toMatchObject({ code: "NOT_A_DEN" });
    await expect(getDenMembership(dm.id, OWNER_ID)).resolves.toEqual({
      leftAt: null,
      role: "MEMBER",
    });
  });

  test("a non-member cannot manage, add, or read", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID]);
    await expect(
      updateDenDetails(denId, OUTSIDER_ID, { name: "Hijacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(rotateInviteCode(denId, OUTSIDER_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(dissolveDen(denId, OUTSIDER_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("den member cap", () => {
  test(
    "concurrent adds cannot push the den past the limit",
    async () => {
      // The cap is checked under the claim lock, so this is the test that proves
      // the lock exists. Without it every writer reads the pre-add count, all pass,
      // and the den ends up over the ceiling with nobody able to fix it.
      const denId = await makeDen([ADMIN_ID]);

      // One past the ceiling, so at least one writer must lose.
      const fillerIds = Array.from(
        { length: DEN_LIMITS.membersMax },
        (_unused, index) => `cap-${RUN_ID}-${index}`
      );
      // The den is created with the creator and the admin in it, so this many of
      // the one-at-a-time filler adds have to be the ones that are refused.
      const alreadyInside = 2;
      await createUsers(fillerIds);

      try {
        const results = await Promise.allSettled(
          fillerIds.map((id) => addDenMembers(denId, OWNER_ID, [id]))
        );
        const added = results.filter(
          (result) => result.status === "fulfilled"
        ).length;
        const refused = results.filter(
          (result) => result.status === "rejected"
        );

        expect(await memberCount(denId)).toBeLessThanOrEqual(
          DEN_LIMITS.membersMax
        );
        // The creator and the admin are already inside, so the ceiling admits
        // that many fillers fewer than its full size. Named rather than written
        // as a literal so the assertion cannot read as a den limit of its own.
        expect(added).toBe(DEN_LIMITS.membersMax - alreadyInside);
        expect(refused.length).toBe(fillerIds.length - added);
        for (const refusal of refused) {
          expect((refusal as PromiseRejectedResult).reason).toMatchObject({
            code: "LIMIT_REACHED",
          });
        }
      } finally {
        await prisma.orm.public.Users.where((user) =>
          user.id.in(fillerIds)
        ).deleteAndCount();
      }
    },
    { timeout: CONTENTION_TIMEOUT_MS }
  );

  test("adding somebody already inside returns nothing and writes nothing", async () => {
    const denId = await makeDen([ADMIN_ID, OLDEST_ID]);
    const added = await addDenMembers(denId, OWNER_ID, [
      ADMIN_ID,
      OLDEST_ID,
      NEWEST_ID,
    ]);
    // Idempotent rather than an error: a client retrying an add it already
    // succeeded at should not have to distinguish that from a real failure.
    expect(added).toEqual([NEWEST_ID]);
    expect(await memberCount(denId)).toBe(4);
  });
});

// Blocks and dens.
//
// A block is a DM-only rule. A den admits regardless of who blocks whom, so none
// of the three doors - create, add, join - asks anything about blocks any more.
//
// This suite exists to pin that ABSENCE, which is the whole difficulty: a rule
// that is not there is invisible to every other test in this file. Put any of the
// three checks back and all of them still pass, the refusals simply start
// happening again, and the only thing that notices is here. Each test therefore
// sets up a real block in the exact position a door used to refuse and then
// asserts the write LANDED.
//
// There is no refusal message to pin either, for the same reason. `DenError` has
// no BLOCKED code, `DenCandidateFailureCode` has none, and the join route has no
// 403. What the old doors claimed to buy is written down in
// `apps/web/src/lib/messages/blocks.ts`: a den is up to DEN_LIMITS.membersMax
// people, so "these two must not share a room" is not a thing a member can reason
// about; the refusal was all-or-nothing over the whole request, taking the
// innocent candidates down with it; any third party could walk the pair in
// anyway; and a blocked member's remedy for a den they do not want to be inside is
// to leave, which is their decision to make and not one to be made for them.
//
// The DM rule is untouched by any of this and is not restated here: it lives in
// another package and is covered there.
describe("blocks do not stop a den", () => {
  // Four extra accounts, named for the role each plays rather than for a position
  // in the den, because "who is inside" is exactly what a door used to ask about
  // and no longer does.
  const BLOCKER_ID = `dsvc-blocker-${RUN_ID}`;
  const BLOCKED_ID = `dsvc-blocked-${RUN_ID}`;
  const HELPER_ID = `dsvc-helper-${RUN_ID}`;
  const BYSTANDER_ID = `dsvc-bystander-${RUN_ID}`;
  const blockUserIds = [BLOCKER_ID, BLOCKED_ID, HELPER_ID, BYSTANDER_ID];

  // `makeDen` writes everybody as MEMBER, and only the owner may add. The manager
  // in these tests is the HELPER, so it has to be promoted explicitly - naming it
  // first is what `makeDenWithAdmin` promotes, and which id is the helper is the
  // whole point of the fixture, so the order is load-bearing rather than tidy.
  async function makeDenWithHelper(
    otherMemberIds: string[] = []
  ): Promise<string> {
    return await makeDenWithAdmin([HELPER_ID, ...otherMemberIds]);
  }

  beforeAll(async () => {
    await Promise.all(blockUserIds.map((id) => createUser(id)));
  });

  // Blocks are facts about ACCOUNTS, not about a den, so they outlive a single
  // test unless they are cleared - and the positive control below needs a slate
  // with no block in it at all. Cleared rather than named per test so a test can
  // be run on its own or in any order.
  beforeEach(async () => {
    await clearBlocks();
  });

  afterAll(async () => {
    await clearBlocks();
  });

  async function clearBlocks(): Promise<void> {
    // The den rows cascade their members, but a Blocks row has no conversation to
    // hang off, so it is cleared explicitly. Ordered before the user delete
    // because the block references both.
    await prisma.orm.public.Blocks.where((row) =>
      or(row.blockerId.in(blockUserIds), row.blockedId.in(blockUserIds))
    ).deleteAndCount();
  }

  test("the create door admits a roster holding a blocked pair", async () => {
    // The room this whole file is about, from the moment it exists. The route's
    // pre-check no longer asks either, so the service is the only place a create
    // could refuse - and it does not, because there is nothing to ask.
    await ensureBlock(BLOCKED_ID, BLOCKER_ID);
    const { id: denId } = await createDen({
      creatorId: OWNER_ID,
      memberIds: [BLOCKER_ID, BLOCKED_ID],
      name: `Blocked pair ${RUN_ID}`,
    });
    denIds.push(denId);

    expect(await getDenMembership(denId, BLOCKED_ID)).not.toBeNull();
    expect(await getDenMembership(denId, BLOCKER_ID)).not.toBeNull();
    expect(await memberCount(denId)).toBe(3);
  });

  test("the join door admits somebody who blocked a member", async () => {
    // Direction one of two, and the case the old refusal called a security
    // boundary: BLOCKED blocked BLOCKER, and the link is presented by somebody with
    // no relationship to either of them. It is admitted, because a den is a room
    // and a pair's disagreement does not get to veto it.
    const denId = await makeDen([BLOCKER_ID]);
    await ensureBlock(BLOCKED_ID, BLOCKER_ID);

    await expect(
      joinDenByInviteCode(await inviteCodeOf(denId), BLOCKED_ID)
    ).resolves.toMatchObject({ alreadyMember: false, id: denId });
    expect(await getDenMembership(denId, BLOCKED_ID)).not.toBeNull();
    expect(await memberCount(denId)).toBe(3);
  });

  test("the join door admits the blocker into a den holding the person they blocked", async () => {
    // Direction two, which reads backwards. A block is symmetric in its effect on a
    // DM, so the two directions are asserted separately rather than one standing
    // in for the other: whichever column pair a reintroduced check probed, it has
    // to catch it here.
    const denId = await makeDen([BLOCKED_ID]);
    await ensureBlock(BLOCKER_ID, BLOCKED_ID);

    await expect(
      joinDenByInviteCode(await inviteCodeOf(denId), BLOCKER_ID)
    ).resolves.toMatchObject({ alreadyMember: false, id: denId });
    expect(await memberCount(denId)).toBe(3);
  });

  test("the add door admits a blocked pair brought in by a third party", async () => {
    // HELPER_ID holds no block with either of them, and asks to add BLOCKED_ID to a
    // den that already holds BLOCKER_ID. The old add door used to refuse this and
    // the reasoning was that a third party must not be able to do it. There is no
    // rule to uphold any more: the pair are free to be in one room, so whoever
    // brings them together is not committing anything.
    const denId = await makeDenWithHelper([BLOCKER_ID]);
    await ensureBlock(BLOCKED_ID, BLOCKER_ID);

    expect(await addDenMembers(denId, HELPER_ID, [BLOCKED_ID])).toEqual([
      BLOCKED_ID,
    ]);
    expect(await getDenMembership(denId, BLOCKED_ID)).not.toBeNull();
    expect(await memberCount(denId)).toBe(4);
  });

  test("the add door admits in both directions of the pair", async () => {
    // The mirror of the add above, with the block pointing the other way, because
    // a check that only probes one column pair is a check that gets reintroduced
    // wrong before it gets reintroduced right.
    const denId = await makeDenWithHelper([BLOCKED_ID]);
    await ensureBlock(BLOCKER_ID, BLOCKED_ID);

    expect(await addDenMembers(denId, HELPER_ID, [BLOCKER_ID])).toEqual([
      BLOCKER_ID,
    ]);
    expect(await memberCount(denId)).toBe(4);
  });

  test("a joiner blocked on both sides of the block table is still admitted", async () => {
    // The strongest shape of the removal. The joiner is not a stranger to the
    // block table, they are on the wrong side of it four times over, and two of
    // those rows pair them with somebody inside. Any reintroduced door check - of
    // any orientation - refuses this, so it is the test that catches one that
    // happens to be narrower than the rule it replaced.
    const denId = await makeDen([HELPER_ID, BLOCKER_ID]);
    await ensureBlock(HELPER_ID, BYSTANDER_ID);
    await ensureBlock(BLOCKER_ID, BYSTANDER_ID);
    await ensureBlock(BYSTANDER_ID, BLOCKED_ID);
    await ensureBlock(BYSTANDER_ID, BLOCKER_ID);

    await expect(
      joinDenByInviteCode(await inviteCodeOf(denId), BYSTANDER_ID)
    ).resolves.toMatchObject({ alreadyMember: false, id: denId });
    expect(await getDenMembership(denId, BYSTANDER_ID)).not.toBeNull();
    // The creator, the helper, the blocker and the joiner.
    expect(await memberCount(denId)).toBe(4);
  });

  test("a block with somebody outside the den does not stop the join", async () => {
    // The case that separates "blocked with a member" from "blocked at all", and
    // the one that would be easy to break by reading any future check as a
    // per-account flag. It is kept even though the distinction no longer decides
    // anything, because it is the cheapest description of what a block IS.
    const denId = await makeDen([HELPER_ID]);
    await ensureBlock(BLOCKED_ID, BLOCKER_ID);

    await expect(
      joinDenByInviteCode(await inviteCodeOf(denId), BLOCKED_ID)
    ).resolves.toMatchObject({ alreadyMember: false, id: denId });
  });

  test("a member already inside is not ejected by a block created since", async () => {
    // Nothing ejects anybody from a den. A block created after somebody joined is
    // a fact about them and the rest of the product, and their route out of this
    // room is leaving it - which they choose, and which announces itself.
    const denId = await makeDen([HELPER_ID]);
    await joinDenByInviteCode(await inviteCodeOf(denId), BLOCKED_ID);
    await ensureBlock(BLOCKED_ID, HELPER_ID);

    await expect(
      joinDenByInviteCode(await inviteCodeOf(denId), BLOCKED_ID)
    ).resolves.toMatchObject({ alreadyMember: true });
    expect(await memberCount(denId)).toBe(3);
  });

  test("an admitted join writes one membership row and moves the count", async () => {
    // The half-applied-state question, asked of the write that used to be refused
    // and rolled back. There is no refusal to roll back now, so the property is the
    // positive one: the row exists exactly once and the roster agrees with it.
    const denId = await makeDen([BLOCKER_ID]);
    await ensureBlock(BLOCKED_ID, BLOCKER_ID);
    const before = await denUpdatedAt(denId);

    await joinDenByInviteCode(await inviteCodeOf(denId), BLOCKED_ID);

    expect(await getDenMembership(denId, BLOCKED_ID)).not.toBeNull();
    expect(await memberCount(denId)).toBe(3);
    // The roster moved, so every open thread has to refetch it: `updatedAt` is the
    // only change signal a client holding a cached conversation detail can
    // compare against. Compared with `>=` rather than `!==` because the stamp is a
    // wall clock - the assertion is that the stamp is not in the past, not that a
    // millisecond ticked.
    expect(await denUpdatedAt(denId)).toBeGreaterThanOrEqual(before);
  });

  test("with no block anywhere, both doors still admit everyone", async () => {
    // The positive control, and it is a real assertion rather than a formality:
    // if anything above were passing for the wrong reason - a fixture that never
    // wrote a block, a helper who was never promoted - this would still have to
    // see everybody get in.
    const denId = await makeDenWithHelper([BLOCKER_ID]);
    expect(await addDenMembers(denId, HELPER_ID, [BLOCKED_ID])).toEqual([
      BLOCKED_ID,
    ]);
    expect(
      await joinDenByInviteCode(await inviteCodeOf(denId), BYSTANDER_ID)
    ).toMatchObject({ alreadyMember: false, id: denId });
    // The creator, the helper, the incumbent, the added one and the joiner.
    expect(await memberCount(denId)).toBe(5);
  });
});

describe("leaving a den", () => {
  test("a plain member leaving leaves the den intact", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID, NEWEST_ID]);
    const result = await leaveDen(denId, NEWEST_ID);
    expect(result).toEqual({ newOwnerId: null });
    expect(await memberCount(denId)).toBe(3);
  });

  test("the owner leaving transfers ownership to the longest-tenured member", async () => {
    // Otherwise a den whose founder walks away is unmanageable by everyone left
    // in it: nobody can promote, rename, or dissolve it.
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID, NEWEST_ID]);

    const result = await leaveDen(denId, OWNER_ID);
    expect(result.newOwnerId).toBe(ADMIN_ID);

    expect(await getDenMembership(denId, ADMIN_ID)).toEqual({
      leftAt: null,
      role: "OWNER",
    });
    const den = await prisma.orm.public.MessageConversations.select("ownerId")
      .where({ id: denId })
      .first();
    // Both the membership role and the den's ownerId move together; leaving one
    // stale would let two sources of truth disagree about who is in charge.
    expect(den?.ownerId).toBe(ADMIN_ID);
  });

  test("the last member out leaves the den behind, undissolved", async () => {
    // This used to delete the den, and that is the whole behaviour this test now
    // holds in place: somebody who loses interest in a room keeps that room in
    // their list and keeps every message in it. Deleting the row would take both,
    // so the den survives with nobody in it who can write.
    const denId = await makeDen([ADMIN_ID]);
    await leaveDen(denId, OWNER_ID);
    expect(await memberCount(denId)).toBe(1);

    const result = await leaveDen(denId, ADMIN_ID);
    expect(result).toEqual({ newOwnerId: null });

    const survivors = await prisma.orm.public.MessageConversations.select("id")
      .where({ id: denId })
      .first();
    expect(survivors).not.toBeNull();
    // Nobody can act, and both departures are still rows rather than gaps.
    expect(await memberCount(denId)).toBe(0);
    expect(await membershipRowCount(denId)).toBe(2);
    // The owner row was cleared when they left rather than promoted into a
    // nobody-can-reach den.
    expect(await getDenMembership(denId, OWNER_ID)).toMatchObject({
      leftAt: expect.anything(),
      role: "MEMBER",
    });
  });

  test("a departed member cannot leave again", async () => {
    // They are not on the roster any more, and the refusal is the same one a
    // non-member gets: stamping the row a second time would move `updatedAt` and
    // announce a roster change the roster has already had.
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await leaveDen(denId, OLDEST_ID);
    await expect(leaveDen(denId, OLDEST_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("a non-member cannot leave", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID]);
    await expect(leaveDen(denId, OUTSIDER_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("leaving a den that no longer exists is a clean 404, not a crash", async () => {
    await expect(leaveDen(`missing-${RUN_ID}`, OWNER_ID)).rejects.toMatchObject(
      { code: "NOT_FOUND" }
    );
  });
});

async function keyCount(conversationId: string): Promise<number> {
  const counted = await prisma.orm.public.MessageConversationKeys.where((key) =>
    key.conversationId.eq(conversationId)
  ).aggregate((aggregate) => ({ count: aggregate.count() }));
  return counted.count;
}

async function messageCount(conversationId: string): Promise<number> {
  const counted = await prisma.orm.public.Messages.where((message) =>
    message.conversationId.eq(conversationId)
  ).aggregate((aggregate) => ({ count: aggregate.count() }));
  return counted.count;
}

// A key wrap and a message, so "the history outlives the departure" is a claim
// about rows that actually exist rather than about an empty table.
async function seedHistory(
  conversationId: string,
  senderId: string
): Promise<void> {
  await prisma.orm.public.MessageConversationKeys.create({
    conversationId,
    encryptedKey: "wrap",
    iv: "wrap-iv",
    ownerUserId: senderId,
    version: 1,
    wrapperUserId: OWNER_ID,
  });
  await prisma.orm.public.Messages.create({
    ciphertext: "message",
    conversationId,
    iv: "message-iv",
    senderId,
  });
}

describe("a den somebody left", () => {
  // The rule under all of this: a departure stamps the membership row instead of
  // deleting it, and `leftAt` is what every write, every fan-out and every cap
  // count filters on. The row survives so the den stays in their list and their
  // history stays readable; the stamp is what stops them being party to it.

  test("leaving keeps the row, and keeps the history readable with it", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await seedHistory(denId, OLDEST_ID);

    await leaveDen(denId, OLDEST_ID);

    // The row is stamped rather than gone: this is what keeps the den in their
    // message list and their wrap in the table the rest of the den reads through.
    const membership = await getDenMembership(denId, OLDEST_ID);
    expect(membership?.leftAt).not.toBeNull();
    expect(await membershipRowCount(denId)).toBe(3);
    expect(await keyCount(denId)).toBe(1);
    expect(await messageCount(denId)).toBe(1);
    // They are no longer in the room.
    expect(await memberCount(denId)).toBe(2);
  });

  test("removal stamps the row the same way, and clears the rank it held", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await seedHistory(denId, OLDEST_ID);

    await removeDenMember(denId, OWNER_ID, OLDEST_ID);

    const stamped = await getDenMembership(denId, OLDEST_ID);
    expect(stamped).toMatchObject({ role: "MEMBER" });
    expect(stamped?.leftAt).not.toBeNull();
    expect(await keyCount(denId)).toBe(1);
    expect(await messageCount(denId)).toBe(1);
  });

  test("a departed member cannot manage the den any more", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await leaveDen(denId, ADMIN_ID);

    // Every management route funnels through the membership gate, so this one
    // assertion covers add, remove, rename, rotate and dissolve at once. The
    // refusal is the non-member's, because that is what they now are.
    await expect(
      updateDenDetails(denId, ADMIN_ID, { name: "Hijacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      addDenMembers(denId, ADMIN_ID, [OUTSIDER_ID])
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(rotateInviteCode(denId, ADMIN_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(dissolveDen(denId, ADMIN_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // And the role change, which is NOT_FOUND rather than FORBIDDEN: it is the
    // same answer removing somebody who is not there gives, because they are not.
    await expect(
      setDenMemberRole(denId, OWNER_ID, ADMIN_ID, "ADMIN")
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a departed member cannot be promoted, transferred to, or removed twice", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await removeDenMember(denId, OWNER_ID, OLDEST_ID);

    await expect(
      setDenMemberRole(denId, OWNER_ID, OLDEST_ID, "ADMIN")
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      removeDenMember(denId, OWNER_ID, OLDEST_ID)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // A den owned by somebody who cannot act on it has nobody who can rename it,
    // add anybody, or delete it, so this is the same refusal the role change gets.
    await leaveDen(denId, OWNER_ID);
    const owner = await prisma.orm.public.MessageConversations.select("ownerId")
      .where({ id: denId })
      .first();
    expect(owner?.ownerId).toBe(ADMIN_ID);
  });

  test("ownership is never handed to somebody who already left", async () => {
    // The bug this closes: the heir is chosen on tenure, and a departed member has
    // more of it than anybody still in the room. Electing across the whole table
    // would hand the den to whoever walked out first, and it would be a den
    // nobody can manage.
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    // OLDEST_ID leaves first, so they have the longest tenure of anyone here -
    // longer than the owner, and longer than the Elder who should inherit.
    await leaveDen(denId, OLDEST_ID);

    await leaveDen(denId, OWNER_ID);

    const owner = await prisma.orm.public.MessageConversations.select("ownerId")
      .where({ id: denId })
      .first();
    expect(owner?.ownerId).toBe(ADMIN_ID);
  });

  test("departed members do not count against the cap", async () => {
    // A den that filled itself up with people who left would refuse new arrivals,
    // which is backwards: the rows are cheap and the cap is about live noise.
    // Owner and one member already, so the filler fills the den exactly.
    const denId = await makeDen([ADMIN_ID]);
    const others = await Promise.all(
      Array.from(
        { length: DEN_LIMITS.membersMax - 2 },
        (_, index) => `dsvc-cap-${index}-${RUN_ID}`
      ).map(async (id) => {
        await createUser(id);
        return id;
      })
    );
    try {
      await addDenMembers(denId, OWNER_ID, others);
      expect(await memberCount(denId)).toBe(DEN_LIMITS.membersMax);

      // Full, so a fresh face is refused.
      await expect(
        addDenMembers(denId, OWNER_ID, [OUTSIDER_ID])
      ).rejects.toMatchObject({ code: "LIMIT_REACHED" });

      // Everyone but the owner walks out. Sequential on purpose: they are leaving
      // the same den under the same claim lock, so a parallel fan-out would be
      // testing the retry loop rather than the cap.
      for (const id of others) {
        // oxlint-disable-next-line no-await-in-loop -- see above
        await leaveDen(denId, id);
      }
      // oxlint-disable-next-line no-await-in-loop -- see above
      await leaveDen(denId, ADMIN_ID);
      expect(await memberCount(denId)).toBe(1);
      // Every one of them is still a row, which is the point: the table remembers
      // the whole history of the roster while the count says there is one person
      // left to talk to.
      expect(await membershipRowCount(denId)).toBe(DEN_LIMITS.membersMax);

      await expect(
        addDenMembers(denId, OWNER_ID, [OUTSIDER_ID])
      ).resolves.toEqual([OUTSIDER_ID]);
    } finally {
      await prisma.orm.public.Users.where((user) =>
        user.id.in(others)
      ).deleteAndCount();
    }
  });

  test("the invite preview counts the people still in the den", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    const full = await previewInvite(await inviteCodeOf(denId));
    expect(full?.memberCount).toBe(3);
    await leaveDen(denId, OLDEST_ID);
    const shrunk = await previewInvite(await inviteCodeOf(denId));
    expect(shrunk?.memberCount).toBe(2);
  });

  test("rejoining through an invite brings the same row back as a plain member", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await setDenMemberRole(denId, OWNER_ID, OLDEST_ID, "ADMIN");
    await leaveDen(denId, OLDEST_ID);

    const result = await joinDenByInviteCode(
      await inviteCodeOf(denId),
      OLDEST_ID
    );

    // A revival, not a re-add: their history and their wraps are already here, so
    // the row is cleared rather than replaced.
    expect(result).toEqual({ alreadyMember: false, id: denId });
    expect(await getDenMembership(denId, OLDEST_ID)).toEqual({
      leftAt: null,
      // Not the Elder they were: a rank handed out before somebody left should not
      // be waiting for them on the way back in.
      role: "MEMBER",
    });
    expect(await membershipRowCount(denId)).toBe(3);
  });

  test("an owner putting a departed member back revives them too", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await removeDenMember(denId, OWNER_ID, OLDEST_ID);

    await expect(addDenMembers(denId, OWNER_ID, [OLDEST_ID])).resolves.toEqual([
      OLDEST_ID,
    ]);

    expect(await getDenMembership(denId, OLDEST_ID)).toEqual({
      leftAt: null,
      role: "MEMBER",
    });
    expect(await membershipRowCount(denId)).toBe(3);
  });

  test("re-adding somebody already inside still changes nothing", async () => {
    // The no-op is load-bearing for the counter: an increment on it would make the
    // next real roster change look like a gap to every member's client.
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    const before = await denUpdatedAt(denId);
    expect(await addDenMembers(denId, OWNER_ID, [OLDEST_ID])).toEqual([]);
    expect(await denUpdatedAt(denId)).toBe(before);
  });

  test("a departed member is not told about roster moves they are not party to", async () => {
    // The announcement arrives as a "re-read your list" frame. Pinging somebody
    // about a den they left would put their name back in front of a conversation
    // they deliberately walked out of.
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await leaveDen(denId, OLDEST_ID);

    const before = await denUpdatedAt(denId);
    const seen: string[] = [];
    const subscription = await subscribeToChannel(
      messageActivityChannel(OLDEST_ID),
      (channel, raw) => {
        seen.push(parseMessageActivityEvent(raw)?.conversationId ?? channel);
      }
    );
    try {
      await addDenMembers(denId, OWNER_ID, [NEWEST_ID]);
      await Bun.sleep(200);
    } finally {
      await subscription.unsubscribe();
    }

    // The roster really did move, or the assertion would be about a quiet channel
    // because nothing happened at all.
    expect(await denUpdatedAt(denId)).toBeGreaterThan(before);
    expect(seen).toEqual([]);
  });
});

describe("the durable membership log", () => {
  // The transcript reads this, so the assertions are about the lines a person
  // would see: who, what, and in what order. Role changes overwrite the row and
  // departures stamp it, so this table is the only place the history exists.

  test("records the creator and every join, oldest first", async () => {
    const denId = await makeDen([ADMIN_ID, OLDEST_ID], {
      name: `Logged ${RUN_ID}`,
    });
    const events = await listDenMembershipEvents(denId, null);

    // Creation is one line. The initial members are not a "joined" line each:
    // the den is born with them.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "CREATED",
      actorId: OWNER_ID,
      actorName: OWNER_ID,
    });

    await addDenMembers(denId, OWNER_ID, [NEWEST_ID]);
    const afterAdd = await listDenMembershipEvents(denId, null);
    expect(afterAdd.map((event) => event.action)).toEqual([
      "CREATED",
      "JOINED",
    ]);
    expect(afterAdd[1]).toMatchObject({
      action: "JOINED",
      actorId: OWNER_ID,
      targetName: NEWEST_ID,
      targetUserId: NEWEST_ID,
    });
  });

  test("records a join through a link as the joiner's own line", async () => {
    const denId = await makeDen([ADMIN_ID]);
    await joinDenByInviteCode(await inviteCodeOf(denId), OUTSIDER_ID);

    const events = await listDenMembershipEvents(denId, null);
    expect(events.at(-1)).toMatchObject({
      action: "JOINED",
      actorId: OUTSIDER_ID,
      targetUserId: OUTSIDER_ID,
    });
  });

  test("records leave, removal, promotion, demotion and transfer", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID, NEWEST_ID]);
    // ADMIN_ID is an Elder from the fixture's promotion, which writes a line too.
    await setDenMemberRole(denId, OWNER_ID, OLDEST_ID, "ADMIN");
    await setDenMemberRole(denId, OWNER_ID, OLDEST_ID, "MEMBER");
    await leaveDen(denId, NEWEST_ID);
    await removeDenMember(denId, OWNER_ID, OLDEST_ID);
    await transferDenOwnership(denId, OWNER_ID, ADMIN_ID);

    const log = await listDenMembershipEvents(denId, null);
    const actions = log.map((event) => event.action);
    expect(actions).toEqual([
      "CREATED",
      "PROMOTED", // makeDenWithAdmin promotes ADMIN_ID
      "PROMOTED", // OLDEST_ID to Elder
      "DEMOTED", // and back
      "LEFT",
      "REMOVED",
      "OWNER_TRANSFERRED",
    ]);
  });

  test("a departed member's log stops at the moment they left", async () => {
    // The room as they last saw it. Everything after their departure is about a
    // den they are no longer in, so it is not their history to read.
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await leaveDen(denId, OLDEST_ID);
    const afterLeaving = await listDenMembershipEvents(denId, null).then(
      (events) => events.at(-1)?.createdAt ?? null
    );
    if (!afterLeaving) {
      throw new Error("expected the leave to be logged");
    }
    // A roster move after they left, which they must not see.
    await addDenMembers(denId, OWNER_ID, [NEWEST_ID]);

    const forLeaver = await listDenMembershipEvents(denId, afterLeaving);
    expect(forLeaver.map((event) => event.action)).not.toContain("JOINED");
    const forMember = await listDenMembershipEvents(denId, null);
    expect(forMember.map((event) => event.action)).toContain("JOINED");
  });

  test("names survive the account they belong to", async () => {
    // The snapshot is the whole reason this table exists. A join through the live
    // roster would read "Unknown" the moment the account is gone.
    const denId = await makeDen([ADMIN_ID]);
    await addDenMembers(denId, OWNER_ID, [OUTSIDER_ID]);
    await removeDenMember(denId, OWNER_ID, OUTSIDER_ID);
    await prisma.orm.public.Users.where({ id: OUTSIDER_ID }).deleteAndCount();
    // Recreate the fixture account so later tests in this file still have it.
    await createUser(OUTSIDER_ID);

    const events = await listDenMembershipEvents(denId, null);
    const removed = events.find((event) => event.action === "REMOVED");
    expect(removed).toMatchObject({
      targetName: OUTSIDER_ID,
      targetUserId: OUTSIDER_ID,
    });
  });
});

describe("membership changes are announced on the conversation row", () => {
  // The roster is the only input to "may this epoch still be written into". A
  // client holding a detail snapshot that predates a removal still lists the
  // removed member, still sees no departed holder and no newcomer, and still reads
  // its newest epoch perfectly — so it sends into the exact epoch the removed
  // member holds. Nothing inside the snapshot can detect that; the row's
  // timestamp can, and the send path refuses a snapshot the server has already
  // moved past.
  test("adding a member moves the conversation forward", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    const before = await denUpdatedAt(denId);
    await addDenMembers(denId, ADMIN_ID, [NEWEST_ID]);
    expect(await denUpdatedAt(denId)).toBeGreaterThan(before);
  });

  test("re-adding somebody already inside does not, because nothing moved", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await addDenMembers(denId, ADMIN_ID, [NEWEST_ID]);
    const before = await denUpdatedAt(denId);
    expect(await addDenMembers(denId, ADMIN_ID, [NEWEST_ID])).toEqual([]);
    // A no-op that looked like a membership change would make every open thread
    // refetch for nothing, so the bump is tied to the rows actually written.
    expect(await denUpdatedAt(denId)).toBe(before);
  });

  test("removing a member moves it, which is what closes the stale-client window", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID, NEWEST_ID]);
    const before = await denUpdatedAt(denId);
    await removeDenMember(denId, ADMIN_ID, OLDEST_ID);
    expect(await denUpdatedAt(denId)).toBeGreaterThan(before);
  });

  test("leaving moves it, on both the plain-member and the ownership-transfer paths", async () => {
    const plain = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID, NEWEST_ID]);
    const beforeLeave = await denUpdatedAt(plain);
    await leaveDen(plain, NEWEST_ID);
    expect(await denUpdatedAt(plain)).toBeGreaterThan(beforeLeave);

    // The owner leaving is the same mutation plus an ownership transfer, and it has
    // to move the row too: the remaining members' roster just lost its owner.
    const transfer = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID, NEWEST_ID]);
    const beforeTransfer = await denUpdatedAt(transfer);
    await leaveDen(transfer, OWNER_ID);
    expect(await denUpdatedAt(transfer)).toBeGreaterThan(beforeTransfer);
  });

  test("a role change moves it", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    const before = await denUpdatedAt(denId);
    await setDenMemberRole(denId, OWNER_ID, OLDEST_ID, "ADMIN");
    expect(await denUpdatedAt(denId)).toBeGreaterThan(before);
  });

  test("joining by invite moves it, and re-joining an existing member does not", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID]);
    const den = await prisma.orm.public.MessageConversations.select(
      "inviteCode"
    )
      .where({ id: denId })
      .first();
    const invite = den?.inviteCode ?? "";
    const before = await denUpdatedAt(denId);
    await joinDenByInviteCode(invite, OUTSIDER_ID);
    expect(await denUpdatedAt(denId)).toBeGreaterThan(before);

    const afterJoin = await denUpdatedAt(denId);
    const second = await joinDenByInviteCode(invite, OUTSIDER_ID);
    expect(second).toMatchObject({ alreadyMember: true });
    expect(await denUpdatedAt(denId)).toBe(afterJoin);
  });

  test("a refused mutation moves nothing", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    const before = await denUpdatedAt(denId);
    await expect(
      removeDenMember(denId, OWNER_ID, OWNER_ID)
    ).rejects.toMatchObject({ code: "SELF_ACTION" });
    await expect(
      setDenMemberRole(denId, OWNER_ID, OLDEST_ID, "OWNER")
    ).rejects.toMatchObject({ code: "INVALID_ROLE" });
    await expect(
      addDenMembers(denId, OUTSIDER_ID, [NEWEST_ID])
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await denUpdatedAt(denId)).toBe(before);
  });
});

describe("dissolving a den", () => {
  test("owner only, and it takes the conversation with it", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await prisma.orm.public.Messages.create({
      ciphertext: "c",
      conversationId: denId,
      id: randomUUID(),
      iv: "i",
      senderId: OWNER_ID,
    });

    await expect(dissolveDen(denId, ADMIN_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(dissolveDen(denId, OWNER_ID)).resolves.toBeUndefined();

    const survivors = await prisma.orm.public.MessageConversations.select("id")
      .where({ id: denId })
      .first();
    expect(survivors).toBeNull();
    // Messages hang off the conversation, so the transcript goes with it.
    const messages = await prisma.orm.public.Messages.select("id")
      .where((message) => message.conversationId.eq(denId))
      .all();
    expect(messages).toEqual([]);
  });
});

describe("invite codes", () => {
  test("preview resolves a code without disclosing the roster", async () => {
    const denId = await makeDen([ADMIN_ID, OLDEST_ID]);
    const den = await prisma.orm.public.MessageConversations.select(
      "inviteCode"
    )
      .where({ id: denId })
      .first();
    const preview = await previewInvite(den?.inviteCode ?? "");
    expect(preview?.id).toBe(denId);
    expect(preview?.memberCount).toBe(3);
    // Every field this den preview has ever carried, and nothing that identifies a
    // member. `expired` and `ownerId` joined the shape when the archive landed; the
    // rest is unchanged, which is what the join route's byte-identical promise to a
    // live code rests on.
    expect(Object.keys(preview ?? {}).toSorted()).toEqual([
      "expired",
      "id",
      "inviteCode",
      "memberCount",
      "name",
      "ownerId",
    ]);
    // A live code is not expired, and the owner is the den's real one rather than a
    // value this preview made up.
    expect(preview?.expired).toBe(false);
    expect(preview?.ownerId).toBe(OWNER_ID);
  });

  test("preview tolerates whitespace and case from a pasted code", async () => {
    const denId = await makeDen([ADMIN_ID]);
    const den = await prisma.orm.public.MessageConversations.select(
      "inviteCode"
    )
      .where({ id: denId })
      .first();
    expect(
      await previewInvite(`  ${den?.inviteCode?.toUpperCase()} `)
    ).not.toBeNull();
  });

  test("an unknown code previews as null rather than throwing", async () => {
    // A never-existed code and one whose den is gone must be indistinguishable, and
    // both must look like a plain miss. See the archive suite for the retired case,
    // which is the one that is now answerable.
    expect(await previewInvite(`nope-${RUN_ID}`)).toBeNull();
  });

  test("rotating retires the old code immediately", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID]);
    const before = await prisma.orm.public.MessageConversations.select(
      "inviteCode"
    )
      .where({ id: denId })
      .first();

    const rotated = await rotateInviteCode(denId, ADMIN_ID);
    expect(rotated).not.toBe(before?.inviteCode);
    // The old code stops joining at once. What it now does is IDENTIFY the den, which
    // is the point of the archive and the reason this assertion moved: a reader
    // holding it gets the owner rather than a dead end.
    expect(await previewInvite(rotated)).toMatchObject({ expired: false });
    const stale = await previewInvite(before?.inviteCode ?? "");
    expect(stale).toMatchObject({
      expired: true,
      id: denId,
      ownerId: OWNER_ID,
    });
    // And it grants nothing: the door is shut whatever the preview says.
    await expect(
      joinDenByInviteCode(before?.inviteCode ?? "", OUTSIDER_ID)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a member may not rotate the code", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await expect(rotateInviteCode(denId, OLDEST_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("joining by invite code", () => {
  test("a non-follower may join through a link, which is the point of one", async () => {
    // No Follows row exists between these two in this fixture, so this test also
    // proves the invite door deliberately skips the follow gate that the direct
    // add applies.
    const denId = await makeDen([ADMIN_ID]);
    const den = await prisma.orm.public.MessageConversations.select(
      "inviteCode"
    )
      .where({ id: denId })
      .first();

    const result = await joinDenByInviteCode(
      den?.inviteCode ?? "",
      OUTSIDER_ID
    );
    expect(result).toEqual({ alreadyMember: false, id: denId });
    expect(await getDenMembership(denId, OUTSIDER_ID)).toEqual({
      leftAt: null,
      role: "MEMBER",
    });
  });

  test("an invite join carries no referrer, since a link has no single author", async () => {
    const denId = await makeDen([ADMIN_ID]);
    const den = await prisma.orm.public.MessageConversations.select(
      "inviteCode"
    )
      .where({ id: denId })
      .first();
    await joinDenByInviteCode(den?.inviteCode ?? "", OUTSIDER_ID);

    // `and()` takes accessor expressions, not predicates, so the two membership
    // keys are matched as one object rather than composed from two callbacks.
    const member = await prisma.orm.public.MessageConversationMembers.select(
      "invitedById"
    )
      .where({ conversationId: denId, userId: OUTSIDER_ID })
      .first();
    expect(member?.invitedById).toBeNull();
  });

  test("re-opening a link you already joined is a success, not an error", async () => {
    const denId = await makeDen([ADMIN_ID]);
    const den = await prisma.orm.public.MessageConversations.select(
      "inviteCode"
    )
      .where({ id: denId })
      .first();
    await joinDenByInviteCode(den?.inviteCode ?? "", OUTSIDER_ID);
    const second = await joinDenByInviteCode(
      den?.inviteCode ?? "",
      OUTSIDER_ID
    );
    expect(second.alreadyMember).toBe(true);
    expect(await memberCount(denId)).toBe(3);
  });

  test("a DM's null code cannot be joined", async () => {
    // DMs carry no code. If null ever resolved, the join door would fall into
    // "any conversation" rather than "this den".
    await expect(joinDenByInviteCode("   ", OWNER_ID)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("a rotated-away code no longer admits anybody", async () => {
    const denId = await makeDen([ADMIN_ID]);
    const before = await prisma.orm.public.MessageConversations.select(
      "inviteCode"
    )
      .where({ id: denId })
      .first();
    const stale = before?.inviteCode ?? "";
    await rotateInviteCode(denId, OWNER_ID);

    await expect(joinDenByInviteCode(stale, OUTSIDER_ID)).rejects.toMatchObject(
      { code: "NOT_FOUND" }
    );
    expect(await getDenMembership(denId, OUTSIDER_ID)).toBeNull();
  });

  // The same hundred-way race as the add above, on the wider door, and the same
  // reason for its own budget: every join takes the den's claim lock in turn, so
  // the runtime is a hundred serialized transactions rather than anything this
  // test can shorten. See `CONTENTION_TIMEOUT_MS` for why the default does not
  // fit a test of this shape.
  test(
    "concurrent joins through one link cannot exceed the cap",
    async () => {
      // The link is a public URL, so a hundred people opening it at once is the
      // realistic shape. The cap is re-checked under the claim lock on this path
      // too, not only on the direct add.
      const denId = await makeDen([ADMIN_ID]);
      const den = await prisma.orm.public.MessageConversations.select(
        "inviteCode"
      )
        .where({ id: denId })
        .first();
      const code = den?.inviteCode ?? "";

      const joinerIds = Array.from(
        { length: DEN_LIMITS.membersMax },
        (_unused, index) => `join-${RUN_ID}-${index}`
      );
      // The creator and the admin `makeDen` put inside. Named so the subtraction
      // below cannot be mistaken for a den limit.
      const alreadyInside = 2;
      await createUsers(joinerIds);

      try {
        const results = await Promise.allSettled(
          joinerIds.map((id) => joinDenByInviteCode(code, id))
        );
        const joined = results.filter(
          (result) => result.status === "fulfilled"
        ).length;
        const refused = results.filter(
          (result) => result.status === "rejected"
        );
        expect(await memberCount(denId)).toBeLessThanOrEqual(
          DEN_LIMITS.membersMax
        );
        // The creator and the first joiner are already inside the link's den.
        expect(joined).toBe(DEN_LIMITS.membersMax - alreadyInside);
        // The losers have to be cap refusals rather than a shorter count by
        // accident. A join that died on a serialization failure or a dropped
        // connection would also land here as "not joined", and the count alone
        // could not tell a correct refusal from a lost write.
        expect(refused.length).toBe(joinerIds.length - joined);
        for (const rejection of refused) {
          expect((rejection as PromiseRejectedResult).reason).toMatchObject({
            code: "LIMIT_REACHED",
          });
        }
      } finally {
        await prisma.orm.public.Users.where((user) =>
          user.id.in(joinerIds)
        ).deleteAndCount();
      }
    },
    { timeout: CONTENTION_TIMEOUT_MS }
  );
});

describe("renaming a den", () => {
  test("an admin may rename; a member may not", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID, OLDEST_ID]);
    await updateDenDetails(denId, ADMIN_ID, { name: "Renamed" });

    const den = await prisma.orm.public.MessageConversations.select("name")
      .where({ id: denId })
      .first();
    expect(den?.name).toBe("Renamed");

    await expect(
      updateDenDetails(denId, OLDEST_ID, { name: "Nope" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("a blank rename is refused by validation, not by the database", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID]);
    await expect(
      updateDenDetails(denId, ADMIN_ID, { name: "   " })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("clearing the description normalizes to null", async () => {
    // Empty string and null must not become two representations of "no
    // description", or a details panel has to guess which one to render.
    const denId = await makeDenWithAdmin([ADMIN_ID]);
    await updateDenDetails(denId, ADMIN_ID, { description: "  " });
    const den = await prisma.orm.public.MessageConversations.select(
      "description"
    )
      .where({ id: denId })
      .first();
    expect(den?.description).toBeNull();
  });

  test("an empty patch is a no-op rather than an error", async () => {
    const denId = await makeDenWithAdmin([ADMIN_ID]);
    await expect(
      updateDenDetails(denId, ADMIN_ID, {})
    ).resolves.toBeUndefined();
  });
});

// The realtime half of a membership mutation: who is told, on which channel, and
// when.
//
// Redis is the REAL one here rather than a spy. A spy would prove the service
// called a function; what actually matters is that the frame lands on the
// channel an open thread and a conversation list are already subscribed to, with
// a payload those two can validate. So each test subscribes to the real
// channels first, runs the mutation, and reads what came back off the wire.
//
// The other half of the property is negative and just as important: a mutation
// that changes nothing announces nothing, and one that rolls back announces
// nothing either. Both are asserted with a settle window rather than a single
// tick, so "nothing arrived" is a real observation and not a race that happened
// to pass.

const ANNOUNCE_IDS = {
  admin: `dsvc-ann-admin-${RUN_ID}`,
  departed: `dsvc-ann-gone-${RUN_ID}`,
  invitee: `dsvc-ann-inv-${RUN_ID}`,
  member: `dsvc-ann-mem-${RUN_ID}`,
  outsider: `dsvc-ann-out-${RUN_ID}`,
  owner: `dsvc-ann-own-${RUN_ID}`,
  promoted: `dsvc-ann-pro-${RUN_ID}`,
  // Deleted inside the rollback test to force a foreign-key failure, so it gets
  // its own id: recreating it afterwards would race the test that owns it.
  rollbackSurvivor: `dsvc-ann-sur-${RUN_ID}`,
  rollbackVictim: `dsvc-ann-vic-${RUN_ID}`,
};

const announceDenIds: string[] = [];

// Long enough for Redis to have delivered anything it was going to deliver, so
// "no announcement" means none was made rather than none had arrived yet.
const ANNOUNCE_SETTLE_MS = 200;

interface Announcement {
  channel: string;
  conversationId: string | null;
  event: ReturnType<typeof parseMessageEvent>;
  kind: string | null;
}

async function createAnnounceUser(id: string): Promise<void> {
  await prisma.orm.public.Users.create({
    displayName: id,
    email: `${id}@example.test`,
    id,
    username: id,
  });
}

// Subscribes to the conversation channel and each user's activity channel, runs
// `mutation`, and returns everything that arrived.
async function collectAnnouncements(
  conversationId: string,
  userIds: string[],
  mutation: () => Promise<unknown>
): Promise<Announcement[]> {
  const channels = [
    messageChannel(conversationId),
    ...userIds.map((userId) => messageActivityChannel(userId)),
  ];
  const seen: Announcement[] = [];
  const subscriptions = await Promise.all(
    channels.map((channel) =>
      subscribeToChannel(channel, (chan, raw) => {
        // The two channels carry different payloads: the conversation channel
        // carries the full event, the activity channel only the signal. Parsing
        // both with their own parser is also the assertion -- a frame either
        // channel cannot validate is a frame no client would act on.
        const activity = parseMessageActivityEvent(raw);
        seen.push({
          channel: chan,
          conversationId: activity?.conversationId ?? null,
          event: parseMessageEvent(raw),
          kind: activity?.kind ?? null,
        });
      })
    )
  );
  try {
    await mutation();
    await Bun.sleep(ANNOUNCE_SETTLE_MS);
  } finally {
    await Promise.all(subscriptions.map((sub) => sub.unsubscribe()));
  }
  return seen;
}

// The frames that went to the open-thread channel, which is where the payload
// carries the discriminator.
function conversationFrames(seen: Announcement[], conversationId: string) {
  return seen.filter((item) => item.channel === messageChannel(conversationId));
}

function actionOf(item: Announcement | undefined): string | null {
  return item?.event?.membershipAction ?? null;
}

describe("membership changes are announced in real time", () => {
  beforeAll(async () => {
    await Promise.all(
      Object.values(ANNOUNCE_IDS).map((id) => createAnnounceUser(id))
    );
  });

  afterAll(async () => {
    if (announceDenIds.length > 0) {
      await prisma.orm.public.MessageConversations.where((conversation) =>
        conversation.id.in(announceDenIds)
      ).deleteAndCount();
    }
    await prisma.orm.public.Users.where((user) =>
      user.id.in(Object.values(ANNOUNCE_IDS))
    ).deleteAndCount();
  });

  async function announceDen(
    memberIds: string[],
    name: string
  ): Promise<string> {
    const den = await createDen({
      creatorId: ANNOUNCE_IDS.owner,
      memberIds,
      name: `${name} ${RUN_ID}`,
    });
    announceDenIds.push(den.id);
    return den.id;
  }

  const everyone = (): string[] => Object.values(ANNOUNCE_IDS);

  test("creation reaches every new member's activity channel", async () => {
    // A brand-new den has no open thread to reach, but every member has a
    // conversation LIST that has never heard of it -- this is the frame that
    // makes a den somebody just created appear in the rail of everybody they
    // added it to. The conversation channel is published too, so a client that
    // already holds the id is consistent either way.
    const seen: Announcement[] = [];
    const channels = everyone().map((userId) => messageActivityChannel(userId));
    const subscriptions = await Promise.all(
      channels.map((channel) =>
        subscribeToChannel(channel, (chan, raw) => {
          const activity = parseMessageActivityEvent(raw);
          seen.push({
            channel: chan,
            conversationId: activity?.conversationId ?? null,
            event: parseMessageEvent(raw),
            kind: activity?.kind ?? null,
          });
        })
      )
    );
    let createdId: string | null = null;
    try {
      const created = await createDen({
        creatorId: ANNOUNCE_IDS.owner,
        memberIds: [ANNOUNCE_IDS.admin, ANNOUNCE_IDS.member],
        name: `Created ${RUN_ID}`,
      });
      createdId = created.id;
      announceDenIds.push(created.id);
      await Bun.sleep(ANNOUNCE_SETTLE_MS);
    } finally {
      await Promise.all(subscriptions.map((sub) => sub.unsubscribe()));
    }

    expect(seen.map((item) => item.channel).toSorted()).toEqual(
      [
        messageActivityChannel(ANNOUNCE_IDS.owner),
        messageActivityChannel(ANNOUNCE_IDS.admin),
        messageActivityChannel(ANNOUNCE_IDS.member),
      ].toSorted()
    );
    // Every frame is a VALID activity signal naming a conversation that exists,
    // so the list refetches and finds a den rather than a 404.
    for (const item of seen) {
      expect(item.kind).toBe("den.membership.changed");
      expect(item.conversationId).toBe(createdId);
    }
  });

  test("adding a member announces member_added exactly once, to everyone", async () => {
    const denId = await announceDen(
      [ANNOUNCE_IDS.admin, ANNOUNCE_IDS.member],
      "Add"
    );
    const seen = await collectAnnouncements(denId, everyone(), () =>
      addDenMembers(denId, ANNOUNCE_IDS.owner, [ANNOUNCE_IDS.promoted])
    );

    const frames = conversationFrames(seen, denId);
    expect(frames).toHaveLength(1);
    expect(actionOf(frames[0])).toBe("member_added");
    expect(frames[0]?.event?.userId).toBe(ANNOUNCE_IDS.owner);

    // Every current member, plus the newcomer whose list has never seen it.
    const activityRecipients = seen
      .filter((item) => item.channel !== messageChannel(denId))
      .map((item) => item.channel);
    expect(activityRecipients.toSorted()).toEqual(
      [
        messageActivityChannel(ANNOUNCE_IDS.admin),
        messageActivityChannel(ANNOUNCE_IDS.member),
        messageActivityChannel(ANNOUNCE_IDS.owner),
        messageActivityChannel(ANNOUNCE_IDS.promoted),
      ].toSorted()
    );
    // The list frame stays a signal: a conversation id and nothing else.
    for (const item of seen) {
      if (item.channel !== messageChannel(denId)) {
        expect(item.kind).toBe("den.membership.changed");
      }
    }
  });

  test("adding somebody already inside announces nothing", async () => {
    const denId = await announceDen(
      [ANNOUNCE_IDS.admin, ANNOUNCE_IDS.member],
      "Noop add"
    );
    const seen = await collectAnnouncements(denId, everyone(), () =>
      addDenMembers(denId, ANNOUNCE_IDS.owner, [ANNOUNCE_IDS.member])
    );
    // A no-op must not look like a membership change, or every open thread
    // refetches a roster that did not move.
    expect(seen).toEqual([]);
  });

  test("removing a member announces member_removed to the removed member too", async () => {
    const denId = await announceDen(
      [ANNOUNCE_IDS.admin, ANNOUNCE_IDS.member, ANNOUNCE_IDS.departed],
      "Remove"
    );
    const seen = await collectAnnouncements(denId, everyone(), () =>
      removeDenMember(denId, ANNOUNCE_IDS.owner, ANNOUNCE_IDS.departed)
    );

    const frames = conversationFrames(seen, denId);
    expect(frames).toHaveLength(1);
    expect(actionOf(frames[0])).toBe("member_removed");
    expect(frames[0]?.event?.userId).toBe(ANNOUNCE_IDS.owner);
    // The removed member is no longer on the roster, and that is precisely why
    // their activity channel has to hear: their list still shows the den, and
    // their open stream has to be told to stop delivering.
    expect(
      seen.filter((item) => item.channel !== messageChannel(denId)).length
    ).toBe(4);
  });

  test("a plain member leaving announces left once", async () => {
    const denId = await announceDen(
      [ANNOUNCE_IDS.admin, ANNOUNCE_IDS.member],
      "Leave"
    );
    const seen = await collectAnnouncements(denId, everyone(), () =>
      leaveDen(denId, ANNOUNCE_IDS.member)
    );

    const frames = conversationFrames(seen, denId);
    expect(frames).toHaveLength(1);
    expect(actionOf(frames[0])).toBe("left");
    expect(frames[0]?.event?.userId).toBe(ANNOUNCE_IDS.member);
  });

  test("the owner leaving announces one owner_transferred, not a leave plus a transfer", async () => {
    const denId = await announceDen(
      [ANNOUNCE_IDS.admin, ANNOUNCE_IDS.member],
      "Transfer"
    );
    const seen = await collectAnnouncements(denId, everyone(), () =>
      leaveDen(denId, ANNOUNCE_IDS.owner)
    );

    // One mutation, one announcement: a receiver's response is identical either
    // way, and two announcements mean two refetches for one membership change.
    const frames = conversationFrames(seen, denId);
    expect(frames).toHaveLength(1);
    expect(actionOf(frames[0])).toBe("owner_transferred");
  });

  test("a promotion announces role_changed", async () => {
    const denId = await announceDen(
      [ANNOUNCE_IDS.admin, ANNOUNCE_IDS.member],
      "Promote"
    );
    const seen = await collectAnnouncements(denId, everyone(), () =>
      setDenMemberRole(denId, ANNOUNCE_IDS.owner, ANNOUNCE_IDS.member, "ADMIN")
    );

    const frames = conversationFrames(seen, denId);
    expect(frames).toHaveLength(1);
    expect(actionOf(frames[0])).toBe("role_changed");
  });

  test("joining by invite announces joined, and re-joining announces nothing", async () => {
    const denId = await announceDen([ANNOUNCE_IDS.admin], "Join");
    const row = await prisma.orm.public.MessageConversations.select(
      "inviteCode"
    )
      .where({ id: denId })
      .first();
    const invite = row?.inviteCode ?? "";

    const joined = await collectAnnouncements(denId, everyone(), () =>
      joinDenByInviteCode(invite, ANNOUNCE_IDS.outsider)
    );
    const frames = conversationFrames(joined, denId);
    expect(frames).toHaveLength(1);
    expect(actionOf(frames[0])).toBe("joined");
    expect(frames[0]?.event?.userId).toBe(ANNOUNCE_IDS.outsider);

    const rejoined = await collectAnnouncements(denId, everyone(), () =>
      joinDenByInviteCode(invite, ANNOUNCE_IDS.outsider)
    );
    expect(rejoined).toEqual([]);
  });

  test("dissolving announces to the roster it read before the row went", async () => {
    const denId = await announceDen(
      [ANNOUNCE_IDS.admin, ANNOUNCE_IDS.member],
      "Dissolve"
    );
    const seen = await collectAnnouncements(denId, everyone(), () =>
      dissolveDen(denId, ANNOUNCE_IDS.owner)
    );

    // The conversation row is gone by the time this publishes, so the roster can
    // only have been read inside the transaction. If it had been read after, the
    // announcement would be empty and every open thread would keep delivering
    // into a den that no longer exists.
    const frames = conversationFrames(seen, denId);
    expect(frames).toHaveLength(1);
    expect(actionOf(frames[0])).toBe("dissolved");
    expect(
      seen.filter((item) => item.channel !== messageChannel(denId)).length
    ).toBe(3);
  });

  test("the last member out announces a leave, not a dissolve", async () => {
    // Two members, drained one at a time. This used to take the row with it and
    // announce a dissolve, and it now announces a leave like any other: the den
    // survives the last departure because the people who left keep it in their
    // lists and keep every message in it, so there is no list left to drop it from.
    // The `dissolved` frame now belongs to one operation only, the owner's own
    // delete, which is the test above.
    const denId = await announceDen([ANNOUNCE_IDS.admin], "Last out");
    const first = await collectAnnouncements(denId, everyone(), () =>
      leaveDen(denId, ANNOUNCE_IDS.admin)
    );
    expect(actionOf(conversationFrames(first, denId)[0])).toBe("left");

    const second = await collectAnnouncements(denId, everyone(), () =>
      leaveDen(denId, ANNOUNCE_IDS.owner)
    );
    const frames = conversationFrames(second, denId);
    expect(frames).toHaveLength(1);
    expect(actionOf(frames[0])).toBe("left");

    // And the row is still there, holding the history the two of them keep.
    const survivors = await prisma.orm.public.MessageConversations.select("id")
      .where({ id: denId })
      .first();
    expect(survivors).not.toBeNull();
  });

  test("a rename and a code rotation announce nothing", async () => {
    // Neither moves the roster, so announcing them would make every open thread
    // refetch a roster that did not change.
    const denId = await announceDen([ANNOUNCE_IDS.admin], "Quiet");
    const seen = await collectAnnouncements(denId, everyone(), async () => {
      await updateDenDetails(denId, ANNOUNCE_IDS.owner, {
        name: "Quiet renamed",
      });
      await rotateInviteCode(denId, ANNOUNCE_IDS.owner);
    });
    expect(seen).toEqual([]);
  });

  test("a refused mutation announces nothing", async () => {
    const denId = await announceDen([ANNOUNCE_IDS.admin], "Refused");
    const seen = await collectAnnouncements(denId, everyone(), async () => {
      await expect(
        removeDenMember(denId, ANNOUNCE_IDS.owner, ANNOUNCE_IDS.owner)
      ).rejects.toMatchObject({ code: "SELF_ACTION" });
      await expect(
        setDenMemberRole(denId, ANNOUNCE_IDS.owner, ANNOUNCE_IDS.admin, "OWNER")
      ).rejects.toMatchObject({ code: "INVALID_ROLE" });
      await expect(
        addDenMembers(denId, ANNOUNCE_IDS.admin, [ANNOUNCE_IDS.promoted])
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    expect(seen).toEqual([]);
  });

  test("a transaction that unwinds after writing announces nothing", async () => {
    // The property the after-commit flush exists for. This one is not a clean
    // refusal: the transaction writes a membership row, then a later insert fails
    // on a foreign key, and the whole thing unwinds. An announcement published
    // from inside the transaction would already have reached every open thread,
    // telling them a roster moved when the database rolled it back -- and a
    // client acting on that would rotate an epoch for a membership that does not
    // exist.
    //
    // Forced deterministically rather than raced: `MessageConversationMembers
    // .userId` references Users with an ON DELETE CASCADE, so adding somebody
    // whose account is gone fails on that insert. `wanted` is sorted, so
    // `outsider` ("...-out-") is written first and `promoted` ("...-pro-") is the
    // one that trips the constraint, guaranteeing a write has already landed.
    const denId = await announceDen(
      [ANNOUNCE_IDS.admin, ANNOUNCE_IDS.member],
      "Rollback"
    );
    await prisma.orm.public.Users.where((user) =>
      user.id.eq(ANNOUNCE_IDS.rollbackVictim)
    ).deleteAndCount();

    const seen = await collectAnnouncements(denId, everyone(), async () => {
      await expect(
        addDenMembers(denId, ANNOUNCE_IDS.owner, [
          ANNOUNCE_IDS.rollbackSurvivor,
          ANNOUNCE_IDS.rollbackVictim,
        ])
      ).rejects.toThrow(/foreign key/i);
    });

    expect(seen).toEqual([]);
    // The roster is genuinely untouched, not merely unannounced: the insert that
    // did succeed inside the transaction went with it.
    expect(await memberCount(denId)).toBe(3);
    expect(
      await getDenMembership(denId, ANNOUNCE_IDS.rollbackSurvivor)
    ).toBeNull();
  });
});
