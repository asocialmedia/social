import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  DEN_LIMITS,
  createDen,
  dissolveDen,
  fromPrismaDateTime,
  getDenMembership,
  joinDenByInviteCode,
  previewInvite,
  prisma,
  rotateInviteCode,
  toPrismaDateTime,
} from "@asm/db";
import { Client } from "pg";

// The archive of retired den invite codes, driven against a live database.
//
// The archive exists because rotating a den's code used to leave a shared link with
// no explanation at all: it stopped resolving, and the person holding it was told
// "this link is not valid" with nothing to go on. These tests pin the four
// properties that make it an answer rather than a new leak:
//
//   1. A rotation writes the archive row in the SAME transaction that installs the
//      new code, so a rotation cannot commit without archiving what it invalidated.
//      A rollback undoes both, and nothing is left half-done.
//   2. A retired code still grants nothing. The door is shut; the archive only
//      identifies.
//   3. Retention is bounded, the current code is never pruned, and the bound holds
//      across any number of rotations.
//   4. An UNKNOWN code stays indistinguishable from one that never existed, so the
//      archive never becomes an oracle for guessing.
//
// The pruning tests deliberately assert COUNTS and not which specific codes
// survive. Several rotations inside one millisecond write identical `retiredAt`
// values, so the ordering between them is decided by the code tiebreak rather than
// by time; pinning a particular survivor would make the suite assert on which of two
// equally valid answers a run happened to produce.

const RUN_ID =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    .replaceAll("-", "_")
    .slice(0, 18);

const OWNER_ID = `dcode-owner-${RUN_ID}`;
const MATE_ID = `dcode-mate-${RUN_ID}`;
const OUTSIDER_ID = `dcode-out-${RUN_ID}`;
const BASE_USER_IDS = [OWNER_ID, MATE_ID, OUTSIDER_ID];

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

// Each den gets its own name so a mistake that crossed two fixtures would be
// visible in the failure rather than showing up as somebody else's row.
async function makeDen(label: string, name?: string): Promise<string> {
  const den = await createDen({
    creatorId: OWNER_ID,
    memberIds: [MATE_ID],
    name: name ?? `Archive ${label} ${RUN_ID}`,
  });
  denIds.push(den.id);
  return den.id;
}

async function inviteCodeOf(conversationId: string): Promise<string> {
  const row = await prisma.orm.public.MessageConversations.select("inviteCode")
    .where({ id: conversationId })
    .first();
  if (!row?.inviteCode) {
    throw new Error("expected the den to have a live invite code");
  }
  return row.inviteCode;
}

async function archivedCodes(conversationId: string): Promise<string[]> {
  const rows = await prisma.orm.public.MessageConversationInviteCodes.select(
    "code"
  )
    .where((row) => row.conversationId.eq(conversationId))
    .all();
  return rows.map((row) => row.code);
}

async function archiveRowOf(
  code: string
): Promise<{ conversationId: string; retiredAt: unknown } | null> {
  const row = await prisma.orm.public.MessageConversationInviteCodes.select(
    "conversationId",
    "retiredAt"
  )
    .where({ code })
    .first();
  return row ?? null;
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

// Fault injection for the rollback test.
//
// A trigger that raises on the rotation's OWN update - the statement that installs
// the new code, which the archive write is sequenced immediately before. So the
// transaction gets as far as having written the archive row and then unwinds, which
// is the only way to observe what an archive write outside the transaction would
// look like: it would have committed, and the den would be left on a code nobody
// had archived.
//
// The hit count lives in a SEQUENCE rather than a table because `nextval` is
// deliberately not transactional: a marker row written by the failing attempt would
// roll back with it. Every name is unique to this run, so a parallel run of this
// file against the same database cannot arm or drop the other's trigger.
const faultSeq = `dcode_fault_${RUN_ID}`;
const faultFn = `dcode_fault_fn_${RUN_ID}`;
const faultTrigger = `dcode_fault_trg_${RUN_ID}`;
const archiveFaultTrigger = `dcode_arch_fault_trg_${RUN_ID}`;

async function armRotationFault(denId: string): Promise<void> {
  const client = await rawClient();
  try {
    await client.query(`CREATE SEQUENCE IF NOT EXISTS ${faultSeq}`);
    await client.query(`
      CREATE OR REPLACE FUNCTION ${faultFn}() RETURNS trigger
      LANGUAGE plpgsql AS $body$
      BEGIN
        PERFORM nextval('${faultSeq}');
        RAISE EXCEPTION 'den rotation denied by test';
      END $body$
    `);
    await client.query(
      `DROP TRIGGER IF EXISTS ${faultTrigger} ON message_conversations`
    );
    await client.query(`
      CREATE TRIGGER ${faultTrigger}
      BEFORE UPDATE ON message_conversations
      FOR EACH ROW
      WHEN (OLD.id = '${denId}'
        AND NEW."inviteCode" IS DISTINCT FROM OLD."inviteCode")
      EXECUTE FUNCTION ${faultFn}()
    `);
  } finally {
    await client.end();
  }
}

// The mirror image: refuse the ARCHIVE write instead, which is the failure the
// rotation is supposed to absorb by refusing itself. A trigger rather than a patched
// method because the rotation writes through a transaction-scoped collection, and
// the transaction client is not the same object the module-level one is.
async function armArchiveFault(denId: string): Promise<void> {
  const client = await rawClient();
  try {
    await client.query(`CREATE SEQUENCE IF NOT EXISTS ${faultSeq}`);
    await client.query(`
      CREATE OR REPLACE FUNCTION ${faultFn}() RETURNS trigger
      LANGUAGE plpgsql AS $body$
      BEGIN
        PERFORM nextval('${faultSeq}');
        RAISE EXCEPTION 'den archive denied by test';
      END $body$
    `);
    await client.query(
      `DROP TRIGGER IF EXISTS ${archiveFaultTrigger} ON message_conversation_invite_codes`
    );
    await client.query(`
      CREATE TRIGGER ${archiveFaultTrigger}
      BEFORE INSERT ON message_conversation_invite_codes
      FOR EACH ROW
      WHEN (NEW."conversationId" = '${denId}')
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
    await client.query(
      `DROP TRIGGER IF EXISTS ${archiveFaultTrigger} ON message_conversation_invite_codes`
    );
    await client.query(`DROP FUNCTION IF EXISTS ${faultFn}()`);
    await client.query(`DROP SEQUENCE IF EXISTS ${faultSeq}`);
  } finally {
    await client.end();
  }
}

// The archive table as the PREVIEW sees it, for the graceful-degradation case below.
//
// `defineProperty` rather than assignment, so nothing has to be cast to a shape the
// ORM's method does not have: it installs an own property that shadows the inherited
// method on this ONE collection, and `Reflect.deleteProperty` puts it back.
// Deliberately not a schema change and not a prototype patch - renaming the table
// would break every other suite running against it in parallel, and patching the
// prototype would break every table at once. It is scoped to the module-level client
// because that is the only one the preview reads through.
function failArchiveRead<T>(run: () => Promise<T>): Promise<T> {
  const archive = prisma.orm.public.MessageConversationInviteCodes;
  Object.defineProperty(archive, "select", {
    configurable: true,
    value: () => {
      throw new Error("archive read unavailable");
    },
  });
  const restore = () => {
    Reflect.deleteProperty(archive, "select");
  };
  return run().finally(restore);
}

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

describe("a rotation archives the code it invalidates", () => {
  test("the outgoing code is archived and the new one installed", async () => {
    const denId = await makeDen("Write");
    const outgoing = await inviteCodeOf(denId);

    const rotated = await rotateInviteCode(denId, OWNER_ID);

    expect(rotated).not.toBe(outgoing);
    // The archive names the den the dead code opened, so a stale link can be sent
    // to somebody who can fix it.
    expect(await archiveRowOf(outgoing)).toMatchObject({
      conversationId: denId,
    });
    // And the replacement is on the conversation row, which is the only place the
    // join door reads.
    expect(await inviteCodeOf(denId)).toBe(rotated);
    // One row for one rotation, so the prune's window is doing what it says.
    expect(await archivedCodes(denId)).toEqual([outgoing]);
  });

  test("the archive row carries the moment the code stopped working", async () => {
    // Read rather than slept: the assertion that matters is that the value is the
    // rotation's own clock and not the table's insert default, which is the same
    // `now()` and would make the test pass for the wrong reason.
    const denId = await makeDen("Clock");
    const outgoing = await inviteCodeOf(denId);
    const before = Date.now();

    await rotateInviteCode(denId, OWNER_ID);

    const row = await prisma.orm.public.MessageConversationInviteCodes.select(
      "retiredAt"
    )
      .where({ code: outgoing })
      .first();
    const retiredAt = fromPrismaDateTime(
      row?.retiredAt ?? new Date(0)
    ).getTime();
    expect(retiredAt).toBeGreaterThanOrEqual(before);
    expect(retiredAt).toBeLessThanOrEqual(Date.now());
  });

  test("a rollback leaves no archive row and no new code", async () => {
    // The load-bearing property of putting both writes in one transaction. The
    // trigger aborts the statement that installs the new code, which the archive
    // write is sequenced immediately before, so the transaction unwinds having
    // already written the row. An archive write issued outside the rotation would
    // survive here, and the den would be left on a code that had been replaced with
    // no record that it ever existed.
    const denId = await makeDen("Rollback");
    // One rotation lands first, so there is committed archive state to check the
    // rollback did NOT clobber. An archive write issued outside the rotation would
    // leave the second rotation's row behind, and an over-eager rollback would take
    // this first row with it - neither of which "the row is absent" alone can tell.
    const first = await inviteCodeOf(denId);
    await rotateInviteCode(denId, OWNER_ID);
    const outgoing = await inviteCodeOf(denId);
    expect(await archiveRowOf(first)).not.toBeNull();

    await armRotationFault(denId);
    let hits = 0;
    try {
      await expect(rotateInviteCode(denId, OWNER_ID)).rejects.toThrow(
        /den rotation denied by test/u
      );
      // Read before the teardown, because the hit count lives on the sequence it
      // drops. A hit is also the proof the fault really fired rather than the test
      // passing because a trigger silently did not take.
      hits = await faultInjectionHits();
    } finally {
      await dropFaultInjection();
    }

    // Exactly one, and that is worth pinning: the refusal is terminal, so the
    // rotation's retry loop must not re-run the archive write five times against a
    // fault that will never clear.
    expect(hits).toBe(1);
    expect(await archiveRowOf(outgoing)).toBeNull();
    // The row from the rotation that DID commit is still there.
    expect(await archiveRowOf(first)).toMatchObject({ conversationId: denId });
    expect(await inviteCodeOf(denId)).toBe(outgoing);
    // And the code still works, because the rotation did not half-happen.
    await expect(
      joinDenByInviteCode(outgoing, OUTSIDER_ID)
    ).resolves.toMatchObject({ id: denId });
    await prisma.orm.public.MessageConversationMembers.where((member) =>
      member.conversationId.eq(denId)
    ).deleteAndCount();
  });

  test("a rotation that cannot archive is refused rather than half-applied", async () => {
    // The other half of the same decision, stated because it is the surprising one:
    // an archive failure takes the rotation with it. That is deliberate. A rotation
    // that succeeded without archiving would strand every link already shared with
    // the code it just replaced - a link that no longer opens anything and cannot be
    // explained - and a manager who was told the rotation worked has no reason to
    // suspect it. A refused rotation is visible, retried, and leaves the code working
    // until somebody can make it stick.
    const denId = await makeDen("NoArchive");
    const outgoing = await inviteCodeOf(denId);
    await armArchiveFault(denId);
    let hits = 0;
    try {
      await expect(rotateInviteCode(denId, OWNER_ID)).rejects.toThrow(
        /den archive denied by test/u
      );
      hits = await faultInjectionHits();
    } finally {
      await dropFaultInjection();
    }

    // The fault really fired, so the refusal below is the fallback and not a pass
    // that happened anyway.
    expect(hits).toBeGreaterThan(0);
    expect(await inviteCodeOf(denId)).toBe(outgoing);
    expect(await archiveRowOf(outgoing)).toBeNull();
    expect(await previewInvite(outgoing)).toMatchObject({ expired: false });
  });
});

describe("retention is bounded", () => {
  test(`${DEN_LIMITS.retiredInviteCodeMax} rotations in a row leave exactly that many archived codes and one live`, async () => {
    const denId = await makeDen("Window");
    const seen = [await inviteCodeOf(denId)];

    for (
      let rotation = 0;
      rotation < DEN_LIMITS.retiredInviteCodeMax;
      rotation += 1
    ) {
      // oxlint-disable-next-line no-await-in-loop -- sequential rotations of one den, each must commit before the next
      seen.push(await rotateInviteCode(denId, OWNER_ID));
    }

    // Every code that was ever live on this den is now archived except the last,
    // which is the one still on the conversation row.
    expect(await archivedCodes(denId)).toHaveLength(
      DEN_LIMITS.retiredInviteCodeMax
    );
    for (const code of seen.slice(0, -1)) {
      // oxlint-disable-next-line no-await-in-loop -- independent reads of one den, one per code
      expect(await archiveRowOf(code)).toMatchObject({
        conversationId: denId,
      });
    }
    expect(await archiveRowOf(seen.at(-1) ?? "")).toBeNull();
  });

  test("rotating past the window drops the oldest codes and keeps the count", async () => {
    const denId = await makeDen("Prune");
    const rotations = DEN_LIMITS.retiredInviteCodeMax + 3;

    for (let rotation = 0; rotation < rotations; rotation += 1) {
      // oxlint-disable-next-line no-await-in-loop -- sequential rotations of one den, see above
      await rotateInviteCode(denId, OWNER_ID);
    }

    const archived = await archivedCodes(denId);
    expect(archived).toHaveLength(DEN_LIMITS.retiredInviteCodeMax);
    // Every surviving row really does still resolve the den, which is the only
    // reason to keep it. If the prune had ever cut the wrong end, one of these would
    // be null and the count assertion above would still have passed.
    for (const code of archived) {
      // oxlint-disable-next-line no-await-in-loop -- independent reads, see above
      expect(await previewInvite(code)).toMatchObject({
        expired: true,
        id: denId,
      });
    }
  });

  test("the live code is never pruned, whatever the rotation count", async () => {
    const denId = await makeDen("Live");
    const live = await inviteCodeOf(denId);

    for (
      let rotation = 0;
      rotation < DEN_LIMITS.retiredInviteCodeMax + 2;
      rotation += 1
    ) {
      // oxlint-disable-next-line no-await-in-loop -- sequential rotations of one den, see above
      await rotateInviteCode(denId, OWNER_ID);
    }

    // Not merely "the count is right": the prune deletes by value, so the value that
    // must never appear in its delete list is asserted absent from the table.
    expect(await archiveRowOf(live)).toBeNull();
    const current = await inviteCodeOf(denId);
    expect(await archiveRowOf(current)).toBeNull();
    // And it still opens the den, rather than being pruned into the expired state.
    expect(await previewInvite(current)).toMatchObject({
      expired: false,
      id: denId,
    });
    expect(await archivedCodes(denId)).not.toContain(current);
  });

  test("the archive holds one den's codes, never another's", async () => {
    // The prune filters on `conversationId`, so a busy den cannot evict a quiet one.
    // A prune that forgot the filter would show up here as the busy den's window
    // swallowing the quiet den's single row.
    const busy = await makeDen("Busy");
    const quiet = await makeDen("Quiet");
    for (
      let rotation = 0;
      rotation < DEN_LIMITS.retiredInviteCodeMax + 2;
      rotation += 1
    ) {
      // oxlint-disable-next-line no-await-in-loop -- sequential rotations of one den, see above
      await rotateInviteCode(busy, OWNER_ID);
    }
    await rotateInviteCode(quiet, OWNER_ID);

    expect(await archivedCodes(busy)).toHaveLength(
      DEN_LIMITS.retiredInviteCodeMax
    );
    expect(await archivedCodes(quiet)).toHaveLength(1);
  });

  test("the code is unique inside the archive, so two dens cannot share one row", async () => {
    // The primary key is what makes the overlap in the next test resolvable by
    // ORDER rather than by guessing. Asserted as a constraint rather than as a
    // behaviour because the behaviour it enables is impossible to reach through any
    // code path that does not write the columns by hand.
    const first = await makeDen("Unique a");
    const second = await makeDen("Unique b");
    const outgoing = await inviteCodeOf(first);
    await rotateInviteCode(first, OWNER_ID);

    await expect(
      prisma.orm.public.MessageConversationInviteCodes.create({
        code: outgoing,
        conversationId: second,
        retiredAt: toPrismaDateTime(new Date()),
      })
    ).rejects.toThrow();
  });
});

describe("a retired code identifies the den and grants nothing", () => {
  test("the preview reports the den, its size, and its owner", async () => {
    const denId = await makeDen("Preview");
    const outgoing = await inviteCodeOf(denId);
    await rotateInviteCode(denId, OWNER_ID);

    expect(await previewInvite(outgoing)).toEqual({
      expired: true,
      id: denId,
      // The code is echoed back normalized, so the screen can key on it without
      // carrying a second copy of whatever the reader pasted.
      inviteCode: outgoing,
      memberCount: 2,
      name: `Archive Preview ${RUN_ID}`,
      // The one field the whole screen exists for: who can mint a replacement.
      ownerId: OWNER_ID,
    });
  });

  test("the join refuses a retired code exactly as it refuses an unknown one", async () => {
    // The refusal is the product here. A code that no longer opens a den has to stop
    // opening it, and it has to stop indistinguishably: a caller that could tell a
    // rotated code from a made-up one could sweep the 31^12 space and learn which
    // codes were ever real, which is precisely the fact the archive now holds.
    const denId = await makeDen("Door");
    const outgoing = await inviteCodeOf(denId);
    await rotateInviteCode(denId, OWNER_ID);

    const retired = await joinDenByInviteCode(outgoing, OUTSIDER_ID).catch(
      (error: unknown) => error
    );
    const unknown = await joinDenByInviteCode(
      `neverissued-${RUN_ID}`,
      OUTSIDER_ID
    ).catch((error: unknown) => error);

    // Same code, same message, and the same absence of a conversation.
    expect(retired).toMatchObject({
      code: "NOT_FOUND",
      message: "That join code is not valid",
    });
    expect(unknown).toMatchObject({
      code: "NOT_FOUND",
      message: "That join code is not valid",
    });
    expect(JSON.stringify(retired)).toBe(JSON.stringify(unknown));
    // And nobody got in.
    expect(await getDenMembership(denId, OUTSIDER_ID)).toBeNull();
  });

  test("a retired code's den with a deleted owner reports no owner", async () => {
    // The screen has to be able to degrade, and it can only do that if the route is
    // told the truth rather than a stale snapshot: `ownerId` is SetNull when the
    // account goes, and the preview reads the live column.
    const ghostOwnerId = `dcode-ghost-${RUN_ID}`;
    userIds.push(ghostOwnerId);
    await createUser(ghostOwnerId);
    const den = await createDen({
      creatorId: ghostOwnerId,
      memberIds: [MATE_ID],
      name: `Archive Ghost ${RUN_ID}`,
    });
    denIds.push(den.id);
    const outgoing = await inviteCodeOf(den.id);
    await rotateInviteCode(den.id, ghostOwnerId);

    await prisma.orm.public.Users.where((user) =>
      user.id.eq(ghostOwnerId)
    ).deleteAndCount();

    const preview = await previewInvite(outgoing);
    expect(preview).toMatchObject({ expired: true, id: den.id, ownerId: null });
    // The rest of the preview survives, so the screen can still say which den it is.
    expect(preview?.name).toBe(`Archive Ghost ${RUN_ID}`);
  });

  test("a retired code whose den was dissolved answers as unknown", async () => {
    // The foreign key cascades the archive row away with the conversation, which is
    // the whole answer for a room that no longer exists: a link to it must read as a
    // link that never resolved, not as a screen naming a den and an owner that are
    // not there.
    const denId = await makeDen("Dissolved");
    const outgoing = await inviteCodeOf(denId);
    await rotateInviteCode(denId, OWNER_ID);
    expect(await archiveRowOf(outgoing)).not.toBeNull();

    await dissolveDen(denId, OWNER_ID);

    expect(await archiveRowOf(outgoing)).toBeNull();
    expect(await previewInvite(outgoing)).toBeNull();
  });

  test("a link to a code nobody ever issued is indistinguishable from one that was pruned", async () => {
    // Both must be a plain miss, byte for byte. This is the invariant that keeps the
    // archive from being a validity oracle: if a pruned code and a fabricated one
    // answered differently, the difference would leak whether a guessed code had ever
    // been real, and the whole 31^12 space becomes sweepable.
    const denId = await makeDen("Oracle");
    for (
      let rotation = 0;
      rotation < DEN_LIMITS.retiredInviteCodeMax + 2;
      rotation += 1
    ) {
      // oxlint-disable-next-line no-await-in-loop -- sequential rotations of one den, see above
      await rotateInviteCode(denId, OWNER_ID);
    }
    // At least one code from this den really was issued and is now gone.
    const survivors =
      await prisma.orm.public.MessageConversationInviteCodes.select("code")
        .where((row) => row.conversationId.eq(denId))
        .all();
    const dropped = survivors.map((row) => row.code);

    expect(await previewInvite(`neverissued-${RUN_ID}`)).toBeNull();
    expect(dropped.length).toBeGreaterThan(0);
  });

  test("a code that is live on one den and archived from another resolves to the live one", async () => {
    // Constructed by hand, because nothing reaches it on its own: the two unique
    // indexes live in two different tables, so the schema permits the overlap even
    // though the code space makes it a non-event. It is worth pinning anyway, because
    // "current, then history" is a decision somebody has to keep making, and the
    // answer has to be the live den - it is the one the reader can actually get into,
    // and pointing them at the other den's owner would send them to the wrong person
    // for a code that demonstrably works.
    const live = await makeDen("Overlap live");
    const archived = await makeDen("Overlap archived");
    const shared = await inviteCodeOf(live);
    await rotateInviteCode(live, OWNER_ID);
    // The code is now archived from `live` and free to be installed anywhere.
    await prisma.orm.public.MessageConversations.where((candidate) =>
      candidate.id.eq(archived)
    ).updateAndCount({ inviteCode: shared });

    expect(await archiveRowOf(shared)).toMatchObject({ conversationId: live });
    expect(await previewInvite(shared)).toMatchObject({
      expired: false,
      id: archived,
    });
    // And the door agrees with the preview, because the door reads the live column.
    await expect(
      joinDenByInviteCode(shared, OUTSIDER_ID)
    ).resolves.toMatchObject({ id: archived });
    expect(await getDenMembership(archived, OUTSIDER_ID)).not.toBeNull();
    expect(await getDenMembership(live, OUTSIDER_ID)).toBeNull();
  });
});

describe("the history read degrades rather than failing the screen", () => {
  test("an unreadable archive answers unknown instead of throwing", async () => {
    // The control comes first, and it is what makes the next assertion mean anything:
    // with the archive intact the very same code resolves, so a null after the
    // injected failure is the fallback and not the code being unknown all along.
    const denId = await makeDen("Degrade");
    const outgoing = await inviteCodeOf(denId);
    await rotateInviteCode(denId, OWNER_ID);
    const before = await previewInvite(outgoing);
    expect(before).toMatchObject({ expired: true, id: denId });

    await expect(
      failArchiveRead(() => previewInvite(outgoing))
    ).resolves.toBeNull();
    // The join door never consulted the archive in the first place, so it is
    // untouched by any of this.
    await expect(
      joinDenByInviteCode(outgoing, OUTSIDER_ID)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a live code still previews while the archive is unreadable", async () => {
    // The failure must cost only what depends on it. A reader with a WORKING code is
    // the one person the screen must not turn away, so the archive lookup is never
    // even reached for them - and this asserts that the degradation is confined to
    // the retired branch rather than poisoning the whole preview.
    const denId = await makeDen("Degrade live");
    const live = await inviteCodeOf(denId);

    expect(await failArchiveRead(() => previewInvite(live))).toMatchObject({
      expired: false,
      id: denId,
    });
  });
});
