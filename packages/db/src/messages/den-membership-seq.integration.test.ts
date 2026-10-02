import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";

import {
  DEN_LIMITS,
  addDenMembers,
  createDen,
  dissolveDen,
  fromPrismaDateTime,
  joinDenByInviteCode,
  leaveDen,
  prisma,
  removeDenMember,
  rotateInviteCode,
  setDenMemberRole,
  toPrismaDateTime,
  transferDenOwnership,
  updateDenDetails,
} from "@asm/db";
import { Client } from "pg";

// The roster-only counter on `message_conversations`, driven against a live
// database.
//
// The rule this file exists for is a boundary, not a behaviour: the counter moves
// on exactly the mutations that change WHO may read and write a den, and on
// nothing else. Every member's client compares it to decide whether its cached
// roster has been overtaken, so a counter that moves too eagerly costs every
// member a refetch per event, and one that fails to move leaves a removed member's
// client holding a roster that no longer exists.
//
// `updatedAt` cannot carry this. It moves on every send as well - the hottest path
// in the app - and it is millisecond resolution, so two changes inside one
// millisecond compare equal. That is why this column exists at all, and the
// "does not move" cases below are the tests that would fail if somebody reached
// for the timestamp instead.
//
// Every test builds its own cast and its own den, because a shared fixture would
// let one test's mutation satisfy the next test's assertion: the counter is
// per-conversation state, and the interesting assertions are about its DELTA.
//
// The counter test at the bottom fires twenty concurrent joiners onto one den, so
// it carries its own budget rather than the 5s default. See
// `CONTENTION_TIMEOUT_MS` below for the number and the reasoning.

const RUN_ID =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    .replaceAll("-", "_")
    .slice(0, 18);

const OWNER_ID = `dmseq-owner-${RUN_ID}`;
const ADMIN_ID = `dmseq-admin-${RUN_ID}`;
const MEMBER_ID = `dmseq-mem-${RUN_ID}`;
const SPARE_ID = `dmseq-spare-${RUN_ID}`;
const OUTSIDER_ID = `dmseq-out-${RUN_ID}`;
const BASE_USER_IDS = [OWNER_ID, ADMIN_ID, MEMBER_ID, SPARE_ID, OUTSIDER_ID];

const denIds: string[] = [];
const userIds = [...BASE_USER_IDS];

async function createUser(id: string): Promise<void> {
  await prisma.orm.public.Users.create({
    displayName: id,
    email: `${id}@example.test`,
    id,
    username: id,
  });
}

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

// The budget for the one race below, and the only timeout in this file that is
// not the default.
//
// Twenty joins, each taking the den's claim lock in turn, so the wall clock is
// twenty transactions queued behind each other's row locks: between roughly 120ms
// and 200ms against an idle database, and several times that when the rest of the
// suite is running alongside on the same Postgres. `bun test --parallel` runs one
// process per file with no cap against a dev Postgres deliberately held at
// max_connections=50 (docker/docker-compose.dev.yml), so "several times that" is
// not a hypothetical here.
//
// The 5s default is not a bound this test can be held to without gutting what it
// proves. The way to fit inside it is to fire fewer joiners, and then every
// writer wins and a counter that incremented twice per change would still come
// out right. Thirty seconds is well over an order of magnitude beyond the idle
// cost and far over anything the loaded case has actually reached.
//
// Options go last: this is the (label, fn, options) overload in the pinned
// bun-types.
const CONTENTION_TIMEOUT_MS = 30_000;

beforeAll(async () => {
  await Promise.all(BASE_USER_IDS.map((id) => createUser(id)));
});

afterAll(async () => {
  await dropFaultInjection();
  if (denIds.length > 0) {
    await prisma.orm.public.MessageConversations.where((conversation) =>
      conversation.id.in(denIds)
    ).deleteAndCount();
  }
  if (userIds.length > 0) {
    await prisma.orm.public.Users.where((user) =>
      user.id.in(userIds)
    ).deleteAndCount();
  }
});

async function makeDen(
  memberIds: string[] = [ADMIN_ID, MEMBER_ID],
  name = "Den"
): Promise<string> {
  const den = await createDen({
    creatorId: OWNER_ID,
    memberIds,
    name: `${name} ${RUN_ID}`,
  });
  denIds.push(den.id);
  return den.id;
}

// The counter as it stands. Throws rather than defaulting: a test that cannot read
// the row must not go on to assert anything about it.
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

async function inviteCodeOf(conversationId: string): Promise<string> {
  const row = await prisma.orm.public.MessageConversations.select("inviteCode")
    .where({ id: conversationId })
    .first();
  return row?.inviteCode ?? "";
}

async function rawClient(): Promise<Client> {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5433/asocialmedia?schema=public",
  });
  await client.connect();
  return client;
}

// Fault injection for the replay test below.
//
// The trigger raises a serialization failure the FIRST time the counter moves on
// one den, so the service's own retry loop replays the whole write. The "once" is
// kept in a SEQUENCE rather than a table, because `nextval` is deliberately not
// transactional: a marker row written by the failing attempt would roll back with
// it, and the retry would then fail forever instead of once.
//
// Every name is unique to this run, so a parallel run of this file against the
// same database cannot arm or drop the other's trigger.
const faultSeq = `dmseq_fault_${RUN_ID}`;
const faultFn = `dmseq_fault_fn_${RUN_ID}`;
const faultTrigger = `dmseq_fault_trg_${RUN_ID}`;

async function armFaultInjection(denId: string): Promise<void> {
  const client = await rawClient();
  try {
    await client.query(`CREATE SEQUENCE IF NOT EXISTS ${faultSeq}`);
    await client.query(`
      CREATE OR REPLACE FUNCTION ${faultFn}() RETURNS trigger
      LANGUAGE plpgsql AS $body$
      BEGIN
        IF nextval('${faultSeq}') = 1 THEN
          RAISE EXCEPTION
            'could not serialize access due to read/write dependencies among transactions'
            USING ERRCODE = '40001';
        END IF;
        RETURN NEW;
      END $body$
    `);
    await client.query(
      `DROP TRIGGER IF EXISTS ${faultTrigger} ON message_conversations`
    );
    await client.query(`
      CREATE TRIGGER ${faultTrigger}
      BEFORE UPDATE ON message_conversations
      FOR EACH ROW
      WHEN (OLD.id = '${denId}' AND NEW."membershipSeq" > OLD."membershipSeq")
      EXECUTE FUNCTION ${faultFn}()
    `);
  } finally {
    await client.end();
  }
}

async function faultInjectionHits(): Promise<number> {
  const client = await rawClient();
  try {
    const rows = await client.query<{ last_value: string }>(
      `SELECT last_value FROM ${faultSeq}`
    );
    return Number(rows.rows[0]?.last_value ?? 0);
  } finally {
    await client.end();
  }
}

async function dropFaultInjection(): Promise<void> {
  const client = await rawClient();
  try {
    await client.query(
      `DROP TRIGGER IF EXISTS ${faultTrigger} ON message_conversations`
    );
    await client.query(`DROP FUNCTION IF EXISTS ${faultFn}()`);
    await client.query(`DROP SEQUENCE IF EXISTS ${faultSeq}`);
  } finally {
    await client.end();
  }
}

describe("a fresh den starts at zero", () => {
  test("creation counts as no change, because there is no earlier roster", async () => {
    // Zero rather than one. A creation is not a change to a roster that already
    // existed, it is the first state of one, and 0 is also what every den created
    // before this column existed reports - so a client cannot tell a new den from
    // a legacy one and does not need to.
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Fresh");
    expect(await membershipSeqOf(denId)).toBe(0);
  });
});

describe("every mutation that moves the roster moves the counter", () => {
  test("adding a member", async () => {
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Add");
    const before = await membershipSeqOf(denId);

    await addDenMembers(denId, OWNER_ID, [SPARE_ID]);

    expect(await membershipSeqOf(denId)).toBe(before + 1);
  });

  test("adding several members is still one change", async () => {
    // One mutation, one increment. The counter counts changes, not rows: a client
    // only needs to know that its cached roster is behind, and a refetch it is
    // already doing covers every member in the batch.
    const batch = Array.from(
      { length: 4 },
      (_unused, index) => `dmseq-batch-${RUN_ID}-${index}`
    );
    await createUsers(batch);
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Batch");
    const before = await membershipSeqOf(denId);

    await addDenMembers(denId, OWNER_ID, batch);

    expect(await membershipSeqOf(denId)).toBe(before + 1);
  });

  test("removing a member", async () => {
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Remove");
    await setDenMemberRole(denId, OWNER_ID, ADMIN_ID, "ADMIN");
    const before = await membershipSeqOf(denId);

    await removeDenMember(denId, OWNER_ID, MEMBER_ID);

    expect(await membershipSeqOf(denId)).toBe(before + 1);
  });

  test("a plain member leaving", async () => {
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Leave");
    const before = await membershipSeqOf(denId);

    await leaveDen(denId, MEMBER_ID);

    expect(await membershipSeqOf(denId)).toBe(before + 1);
  });

  test("the owner leaving, which also transfers ownership", async () => {
    // The one mutation that does not go through `touchDen`: it writes `ownerId` in
    // the same statement, so the increment rides along in that UPDATE. Two
    // increments for one change would make every later announcement look like a
    // gap and cost every member a refetch for it.
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Transfer");
    const before = await membershipSeqOf(denId);

    await leaveDen(denId, OWNER_ID);

    expect(await membershipSeqOf(denId)).toBe(before + 1);
    const den = await prisma.orm.public.MessageConversations.select("ownerId")
      .where({ id: denId })
      .first();
    expect(den?.ownerId).toBe(ADMIN_ID);
  });

  test("a role change, which moves nobody in or out", async () => {
    // Nobody joined and nobody left, but a promotion changes who may add and
    // remove members and every details panel renders the roster's roles, so a
    // client holding a cached roster is holding a wrong one.
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Promote");
    const before = await membershipSeqOf(denId);

    await setDenMemberRole(denId, OWNER_ID, MEMBER_ID, "ADMIN");

    expect(await membershipSeqOf(denId)).toBe(before + 1);
  });

  test("handing the den to somebody else, which also moves nobody in or out", async () => {
    // The same single-statement shape as the leave-transfer above: `ownerId` has to
    // be written with the counter, or a rollback of one and a commit of the other
    // would leave the den with a new owner and a stale counter - which reads to
    // every client as a roster it has already seen.
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Hand over");
    const before = await membershipSeqOf(denId);

    await transferDenOwnership(denId, OWNER_ID, ADMIN_ID);

    expect(await membershipSeqOf(denId)).toBe(before + 1);
    const den = await prisma.orm.public.MessageConversations.select("ownerId")
      .where({ id: denId })
      .first();
    expect(den?.ownerId).toBe(ADMIN_ID);
  });

  test("joining through an invite link", async () => {
    const denId = await makeDen([ADMIN_ID], "Join");
    const before = await membershipSeqOf(denId);

    await joinDenByInviteCode(await inviteCodeOf(denId), OUTSIDER_ID);

    expect(await membershipSeqOf(denId)).toBe(before + 1);
  });
});

describe("the mutations that must NOT move the counter", () => {
  test("re-adding somebody already inside", async () => {
    // The no-op add. It announces nothing today, and an increment here would be
    // the same lie told through the other channel: every member's client would
    // treat the NEXT real change as a gap and refetch for it.
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "No-op add");
    const before = await membershipSeqOf(denId);

    expect(await addDenMembers(denId, OWNER_ID, [MEMBER_ID])).toEqual([]);

    expect(await membershipSeqOf(denId)).toBe(before);
  });

  test("re-opening an invite link already used", async () => {
    // Same reasoning as the no-op add, on the self-service door. This is the path
    // a person takes by accident most often - they follow the link again to get
    // back to a den they are already in - so it is the most likely place for a
    // spurious increment to hide.
    const denId = await makeDen([ADMIN_ID], "No-op re-join");
    const code = await inviteCodeOf(denId);
    await joinDenByInviteCode(code, OUTSIDER_ID);
    const before = await membershipSeqOf(denId);

    await expect(joinDenByInviteCode(code, OUTSIDER_ID)).resolves.toMatchObject(
      {
        alreadyMember: true,
      }
    );

    expect(await membershipSeqOf(denId)).toBe(before);
  });

  test("a rename, a description and an avatar", async () => {
    // None of these change who may read this den. The counter moving here is the
    // cost the column was introduced to avoid: every member with the thread open
    // would refetch a roster that had not moved, each time somebody retyped the
    // room's name.
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Rename");
    const before = await membershipSeqOf(denId);

    await updateDenDetails(denId, OWNER_ID, {
      avatarMediaId: null,
      description: "Weekly",
      name: "Renamed",
    });

    expect(await membershipSeqOf(denId)).toBe(before);
  });

  test("rotating the invite code", async () => {
    // A new code changes the door, never the room. Every member's client would
    // refetch its roster, and every member's detail response would then carry an
    // invite code they already had, for a roster identical to the one they had.
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Rotate");
    const before = await membershipSeqOf(denId);

    const rotated = await rotateInviteCode(denId, OWNER_ID);

    expect(rotated.length).toBeGreaterThan(0);
    expect(await membershipSeqOf(denId)).toBe(before);
  });

  test("a send, which moves the row this counter shares a table with", async () => {
    // The single most important negative case, because it is why the timestamp
    // could not be reused. A message is not a roster change, and the two columns
    // live on the same row: if a send touched the counter, every message in every
    // den would look like a membership event to every client holding the thread.
    //
    // Driven through the same statements the send route issues - create the
    // message, bump `updatedAt` - because the route is what runs them and its own
    // test pins that it writes `updatedAt` and nothing else. What this adds is the
    // part only a live database can show: nothing about the column, its default or
    // the transaction moves it behind the write's back.
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Send");
    const before = await membershipSeqOf(denId);

    await prisma.transaction(async (tx) => {
      await tx.orm.public.Messages.create({
        ciphertext: "ciphertext",
        conversationId: denId,
        iv: "iv",
        ratchetIndex: 0,
        senderId: OWNER_ID,
      });
      await tx.orm.public.MessageConversations.where({ id: denId }).update({
        updatedAt: toPrismaDateTime(new Date()),
      });
    });

    expect(await membershipSeqOf(denId)).toBe(before);
  });

  test("a dissolve, which takes the row with it", async () => {
    // There is no counter to report and no client that could act on one: every
    // receiver reads a dissolve as terminal. Asserted as absence rather than as a
    // value, because a row that is gone has no value to assert.
    const denId = await makeDen([ADMIN_ID], "Dissolve");

    await dissolveDen(denId, OWNER_ID);

    const row = await prisma.orm.public.MessageConversations.select("id")
      .where({ id: denId })
      .first();
    expect(row).toBeNull();
  });

  test("a refused mutation", async () => {
    // A denial is not a change. The counter is written inside the mutation's own
    // transaction, so a refusal that throws before it can write leaves the row
    // exactly where it was.
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Refused");
    const before = await membershipSeqOf(denId);

    await expect(
      removeDenMember(denId, OWNER_ID, OWNER_ID)
    ).rejects.toMatchObject({ code: "SELF_ACTION" });
    await expect(
      setDenMemberRole(denId, OWNER_ID, ADMIN_ID, "OWNER")
    ).rejects.toMatchObject({ code: "INVALID_ROLE" });
    await expect(
      addDenMembers(denId, MEMBER_ID, [SPARE_ID])
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await membershipSeqOf(denId)).toBe(before);
  });
});

describe("the counter is monotonic", () => {
  test("never decreases, and moves exactly once per roster change", async () => {
    // The property a client depends on when it ignores anything at or below what it
    // has applied: a value that could go backwards would make a late announcement
    // look like a gap, and one that skipped ahead without a mutation would make a
    // client refetch for a change that never happened.
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Sequence");
    const seen: number[] = [await membershipSeqOf(denId)];
    const record = async () => {
      seen.push(await membershipSeqOf(denId));
    };

    await addDenMembers(denId, OWNER_ID, [SPARE_ID]);
    await record();
    await setDenMemberRole(denId, OWNER_ID, ADMIN_ID, "ADMIN");
    await record();
    await addDenMembers(denId, OWNER_ID, [MEMBER_ID]);
    await record();
    await rotateInviteCode(denId, OWNER_ID);
    await record();
    await updateDenDetails(denId, OWNER_ID, { name: "Still the same roster" });
    await record();
    await joinDenByInviteCode(await inviteCodeOf(denId), OUTSIDER_ID);
    await record();
    await removeDenMember(denId, OWNER_ID, SPARE_ID);
    await record();
    await leaveDen(denId, MEMBER_ID);
    await record();
    await leaveDen(denId, OWNER_ID);
    await record();

    for (const [index, value] of seen.entries()) {
      if (index === 0) {
        continue;
      }
      const previous = seen[index - 1] ?? 0;
      // `>=`, not `>`, because three of the steps above are deliberate no-ops: the
      // counter is not obliged to move on those. The strict half of the property
      // is the exact total below, and the mutation-by-mutation delta, which every
      // test above pins on its own.
      expect(value).toBeGreaterThanOrEqual(previous);
    }
    // Six roster changes were made across that sequence, so the counter must have
    // moved six times and no more: add, promote, join, remove, plain leave,
    // ownership transfer. A no-op add, a code rotation and a rename contributed
    // nothing.
    expect(seen.at(-1)).toBe(6);
  });
});

describe("the increment lives inside the mutation's transaction", () => {
  test("a replayed mutation still increments exactly once", async () => {
    // `runWithRetry` replays the whole callback on a serialization failure, so
    // this is the shape that could double-apply: the first attempt wrote the
    // counter, the database unwound it, and the replay wrote it again. If the
    // increment were computed from anything other than the row the replay just
    // claimed, the two attempts would not agree - the den would end up at +2 and
    // every later announcement would look like a gap.
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Replayed");
    const before = await membershipSeqOf(denId);
    await armFaultInjection(denId);
    let hits = 0;
    try {
      await addDenMembers(denId, OWNER_ID, [SPARE_ID]);
      // Read before the injection is torn down, because the counter of faults
      // lives on the sequence the teardown drops. At least one hit also says the
      // fault really was injected rather than the test passing because the
      // trigger silently did not take.
      hits = await faultInjectionHits();
    } finally {
      await dropFaultInjection();
    }

    // Two hits is the shape of a replay: the first attempt raised, the replay
    // passed. One hit would mean the injection never ran, and more than two would
    // mean the write is being retried far more than the loop intends.
    expect(hits).toBe(2);
    expect(await membershipSeqOf(denId)).toBe(before + 1);
  });

  test("a mutation that unwinds does not increment at all", async () => {
    // Forced deterministically the same way the announcement suite forces one:
    // `MessageConversationMembers.userId` references `Users` with an ON DELETE
    // CASCADE, so adding somebody whose account is gone fails on that insert and
    // takes the whole transaction - claim, roster write and counter - with it. A
    // counter written outside the mutation would survive this and would then
    // announce a roster change that never happened.
    const ghostId = `dmseq-ghost-${RUN_ID}`;
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Unwound");
    const before = await membershipSeqOf(denId);

    await expect(addDenMembers(denId, OWNER_ID, [ghostId])).rejects.toThrow(
      /foreign key/i
    );

    expect(await membershipSeqOf(denId)).toBe(before);
  });
});

describe("the counter under concurrent writers", () => {
  test(
    "one increment per mutation, however many writers collide on the claim",
    async () => {
      // The claim lock serializes every writer onto one row, so this is a hundred
      // transactions queued behind each other. It is also the shape that would
      // expose an increment computed from a value read before the claim rather
      // than from the row the claim itself read: the losers would write a stale
      // +1 over each other and the final count would land below the number of
      // mutations that actually committed.
      const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Contended");
      const joinerIds = Array.from(
        { length: 20 },
        (_unused, index) => `dmseq-join-${RUN_ID}-${index}`
      );
      await createUsers(joinerIds);
      const before = await membershipSeqOf(denId);
      const code = await inviteCodeOf(denId);

      const results = await Promise.allSettled(
        joinerIds.map((id) => joinDenByInviteCode(code, id))
      );

      const joined = results.filter(
        (result) => result.status === "fulfilled"
      ).length;
      expect(joined).toBe(joinerIds.length);
      for (const result of results) {
        // A join that died on a lost connection would land here too, and the count
        // alone could not tell a correct refusal from a lost write.
        expect(result.status === "fulfilled" ? null : result.reason).toBeNull();
      }
      // Exactly one increment per committed join: no more (a duplicate would make
      // a real change look like a gap) and no fewer (a missed one would hide a
      // roster change from every client).
      expect(await membershipSeqOf(denId)).toBe(before + joinerIds.length);
      expect(joinerIds.length).toBeLessThan(DEN_LIMITS.membersMax);
    },
    { timeout: CONTENTION_TIMEOUT_MS }
  );
});

// The timestamp shares the row with the counter and is what this column exists to
// stop relying on, so the two are asserted to be independently movable: a send
// moves the first and not the second, a roster change moves both.
describe("the counter and the timestamp are independent", () => {
  let lastSentAt = 0;

  beforeEach(() => {
    lastSentAt = 0;
  });

  test("a roster change moves both and a send moves only the timestamp", async () => {
    const denId = await makeDen([ADMIN_ID, MEMBER_ID], "Independent");
    const row = await prisma.orm.public.MessageConversations.select("updatedAt")
      .where({ id: denId })
      .first();
    if (!row) {
      throw new Error("expected the den to exist");
    }
    lastSentAt = fromPrismaDateTime(row.updatedAt).getTime();
    const beforeSeq = await membershipSeqOf(denId);

    await Bun.sleep(5);
    await addDenMembers(denId, OWNER_ID, [SPARE_ID]);

    const afterRoster = await prisma.orm.public.MessageConversations.select(
      "membershipSeq",
      "updatedAt"
    )
      .where({ id: denId })
      .first();
    expect(afterRoster?.membershipSeq).toBe(beforeSeq + 1);
    expect(
      fromPrismaDateTime(afterRoster?.updatedAt ?? new Date(0)).getTime()
    ).toBeGreaterThan(lastSentAt);

    await Bun.sleep(5);
    await prisma.transaction(async (tx) => {
      await tx.orm.public.MessageConversations.where({ id: denId }).update({
        updatedAt: toPrismaDateTime(new Date()),
      });
    });

    const afterSend = await prisma.orm.public.MessageConversations.select(
      "membershipSeq",
      "updatedAt"
    )
      .where({ id: denId })
      .first();
    expect(afterSend?.membershipSeq).toBe(beforeSeq + 1);
    expect(
      fromPrismaDateTime(afterSend?.updatedAt ?? new Date(0)).getTime()
    ).toBeGreaterThan(
      fromPrismaDateTime(afterRoster?.updatedAt ?? new Date(0)).getTime()
    );
  });
});
