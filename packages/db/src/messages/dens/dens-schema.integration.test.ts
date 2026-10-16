import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import {
  DEN_LIMITS,
  canManageDen,
  getMessageConversationDataQuery,
  prisma,
} from "@asm/db";
import { and, or } from "@prisma/orm-postgres/orm-client";

// Coverage for the den_v1 schema itself, against a live database: that a DM
// created the old way still reads back correctly, that the new columns behave
// under the constraints they claim, and that the referential actions are the
// ones the encryption model depends on.
//
// The referential actions are the part worth testing hard. Phase 2 fans one
// root-key wrap out per member and stores the wrapper's identity on the wrap
// row. If deleting a user cascaded that row away, the remaining members would
// silently lose a root-key epoch and every message under it would become
// undecryptable - a data-loss bug that only shows up after someone closes their
// account. SetNull keeps the row and its ciphertext, so the epoch survives.

const RUN_ID =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    .replaceAll("-", "_")
    .slice(0, 18);

const OWNER_ID = `den-owner-${RUN_ID}`;
const MEMBER_ID = `den-member-${RUN_ID}`;
const LEAVING_ID = `den-leaving-${RUN_ID}`;
const DM_PEER_ID = `den-dm-peer-${RUN_ID}`;

async function createUser(id: string): Promise<void> {
  await prisma.orm.public.Users.create({
    displayName: id,
    email: `${id}@example.test`,
    id,
    username: id,
  });
}

const USER_IDS = [OWNER_ID, MEMBER_ID, LEAVING_ID, DM_PEER_ID];

// Every conversation this file makes, so afterAll can clear them even if a test
// failed part-way through a transaction.
const conversationIds: string[] = [];

async function createDen(
  overrides: {
    inviteCode?: string | null;
    name?: string | null;
  } = {}
): Promise<string> {
  const den = await prisma.orm.public.MessageConversations.create({
    _type: "DEN",
    createdById: OWNER_ID,
    inviteCode: overrides.inviteCode ?? null,
    name: overrides.name ?? `Den ${RUN_ID}`,
    ownerId: OWNER_ID,
  });
  conversationIds.push(den.id);
  return den.id;
}

async function addMember(
  conversationId: string,
  userId: string,
  role: "ADMIN" | "MEMBER" | "OWNER"
): Promise<void> {
  await prisma.orm.public.MessageConversationMembers.create({
    conversationId,
    role,
    userId,
  });
}

beforeAll(async () => {
  // Parallel: the fixture users have no ordering constraint between them, and
  // this file already opens a connection per query.
  await Promise.all(USER_IDS.map((id) => createUser(id)));
});

afterAll(async () => {
  if (conversationIds.length > 0) {
    await prisma.orm.public.MessageConversations.where((conversation) =>
      conversation.id.in(conversationIds)
    ).deleteAndCount();
  }
  await prisma.orm.public.Users.where((user) =>
    user.id.in(USER_IDS)
  ).deleteAndCount();
});

describe("den_v1 schema", () => {
  test("a DM created without any den column reads back as a DM", async () => {
    // The exact shape the DM path writes: no type, no name, no invite code. The
    // defaults have to make this row indistinguishable from a pre-migration one,
    // or every existing DM regresses at the first list read.
    const dm = await prisma.orm.public.MessageConversations.create({
      pairKey: [OWNER_ID, DM_PEER_ID].toSorted().join(":"),
    });
    conversationIds.push(dm.id);
    await addMember(dm.id, OWNER_ID, "MEMBER");
    await addMember(dm.id, DM_PEER_ID, "MEMBER");

    const row = await prisma.orm.public.MessageConversations.select(
      "_type",
      "avatarMediaId",
      "description",
      "inviteCode",
      "name",
      "ownerId",
      "createdById",
      "pairKey"
    )
      .where({ id: dm.id })
      .first();

    expect(row?._type).toBe("DM");
    expect(row?.pairKey).not.toBeNull();
    expect(row?.name).toBeNull();
    expect(row?.description).toBeNull();
    expect(row?.avatarMediaId).toBeNull();
    expect(row?.ownerId).toBeNull();
    expect(row?.createdById).toBeNull();
    expect(row?.inviteCode).toBeNull();

    const member = await prisma.orm.public.MessageConversationMembers.select(
      "role"
    )
      .where({ conversationId: dm.id, userId: OWNER_ID })
      .first();
    expect(member?.role).toBe("MEMBER");
  });

  test("a den with no pairKey does not consume the DM dedup slot", async () => {
    // pairKey is the DM dedup key and inviteCode the den join key. Both are
    // nullable-unique, which Postgres satisfies by letting NULL repeat - that is
    // what lets dens (pairKey null) and DMs (inviteCode null) coexist in one
    // table. A duplicate non-null pairKey is still refused, which is the
    // create-or-find race guard the DM path depends on.
    const first = await createDen({});
    const second = await createDen({});
    expect(first).not.toBe(second);

    await expect(
      prisma.orm.public.MessageConversations.create({
        pairKey: [OWNER_ID, DM_PEER_ID].toSorted().join(":"),
      })
    ).rejects.toThrow();
  });

  test("a duplicate invite code is refused, and a null one is not", async () => {
    const code = `inv${RUN_ID}`.slice(0, DEN_LIMITS.inviteCodeLength);
    await createDen({ inviteCode: code });
    await expect(
      prisma.orm.public.MessageConversations.create({
        _type: "DEN",
        inviteCode: code,
        name: "Clash",
      })
    ).rejects.toThrow();
    // Two nulls coexist, proven by the other tests, but assert it directly too:
    // the unique index must be a partial-in-practice NULL-tolerant one, not a
    // NOT NULL that merely happens to be empty right now.
    const a = await createDen({});
    const b = await createDen({});
    const rows = await prisma.orm.public.MessageConversations.where((row) =>
      or(row.id.eq(a), row.id.eq(b))
    ).all();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.inviteCode === null)).toBe(true);
  });

  test("the name CHECK refuses blank and over-long names but allows null", async () => {
    await expect(
      prisma.orm.public.MessageConversations.create({
        _type: "DEN",
        name: "",
      })
    ).rejects.toThrow();
    await expect(
      prisma.orm.public.MessageConversations.create({
        _type: "DEN",
        name: "x".repeat(DEN_LIMITS.nameMax + 1),
      })
    ).rejects.toThrow();

    // A DM's null name is the common case and must stay legal.
    const dm = await prisma.orm.public.MessageConversations.create({
      pairKey: null,
    });
    conversationIds.push(dm.id);
    expect(dm.id).toBeTruthy();

    const atBound = await createDen({
      name: "x".repeat(DEN_LIMITS.nameMax),
    });
    expect(atBound).toBeTruthy();
  });

  test("a member role round-trips and reads back through the shared query", async () => {
    // getMessageConversationDataQuery is the one query every message route uses.
    // It now selects role and the den columns, so a mistake in that select
    // surfaces as a runtime failure on the DM list rather than in a den test.
    const den = await createDen({ name: `Round trip ${RUN_ID}` });
    await addMember(den, OWNER_ID, "OWNER");
    await addMember(den, MEMBER_ID, "ADMIN");

    const row = await getMessageConversationDataQuery(prisma.orm)
      .where({ id: den })
      .first();

    expect(row?._type).toBe("DEN");
    expect(row?.name).toBe(`Round trip ${RUN_ID}`);
    const roles = new Map(
      (row?.messageConversationMembers ?? []).map((member) => [
        member.userId,
        member.role,
      ])
    );
    expect(roles.get(OWNER_ID)).toBe("OWNER");
    expect(roles.get(MEMBER_ID)).toBe("ADMIN");
    // Every member row also still carries the member-scoped columns the read
    // and mute paths read, which the explicit select had to keep.
    const member = row?.messageConversationMembers.find(
      (candidate) => candidate.userId === OWNER_ID
    );
    expect(member?.conversationId).toBe(den);
    expect(member?.lastReadAt === null || member?.lastReadAt).toBeTruthy();
    expect("mutedAt" in (member ?? {})).toBe(true);
    expect("themeKey" in (member ?? {})).toBe(true);
  });

  test("a wrap survives the wrapper deleting their account", async () => {
    // The load-bearing case for SetNull on wrapperUserId. A member who leaves a
    // den - or whose account is deleted - is still the wrapper for epochs the
    // remaining members must keep reading. Cascading the wrap row away would
    // make every message under that epoch undecryptable, with no error anywhere.
    const den = await createDen({ name: `Wrapper ${RUN_ID}` });
    await addMember(den, OWNER_ID, "OWNER");
    await addMember(den, LEAVING_ID, "MEMBER");

    const key = await prisma.orm.public.MessageConversationKeys.create({
      conversationId: den,
      encryptedKey: "ciphertext-under-test",
      id: randomUUID(),
      iv: "iv-under-test",
      ownerUserId: OWNER_ID,
      version: 1,
      wrapperPublicKey: "public-key-under-test",
      wrapperUserId: LEAVING_ID,
    });

    // The wrapper leaves the den but keeps their account: the wrap is still
    // theirs to describe.
    await prisma.orm.public.MessageConversationMembers.where((member) =>
      and(member.conversationId.eq(den), member.userId.eq(LEAVING_ID))
    ).deleteAndCount();

    const afterLeave = await prisma.orm.public.MessageConversationKeys.select(
      "encryptedKey",
      "iv",
      "ownerUserId",
      "wrapperPublicKey",
      "wrapperUserId"
    )
      .where({ id: key.id })
      .first();
    expect(afterLeave?.wrapperUserId).toBe(LEAVING_ID);
    expect(afterLeave?.encryptedKey).toBe("ciphertext-under-test");

    // Now the wrapper's account goes away entirely.
    await prisma.orm.public.Users.where((user) =>
      user.id.eq(LEAVING_ID)
    ).deleteAndCount();

    const afterDelete = await prisma.orm.public.MessageConversationKeys.select(
      "encryptedKey",
      "iv",
      "ownerUserId",
      "wrapperPublicKey",
      "wrapperUserId"
    )
      .where({ id: key.id })
      .first();
    // Row kept, ciphertext kept, wrapper link nulled. That is exactly the state
    // Phase 2 reads to unwrap the epoch: the snapshot public key is what makes
    // the unwrap possible without the account.
    expect(afterDelete).toBeTruthy();
    expect(afterDelete?.encryptedKey).toBe("ciphertext-under-test");
    expect(afterDelete?.wrapperPublicKey).toBe("public-key-under-test");
    expect(afterDelete?.wrapperUserId).toBeNull();
  });

  test("deleting a den's owner account does not delete the den", async () => {
    // Same reasoning on the conversation row: SetNull, not Cascade. Deleting one
    // member's account must not take everyone else's transcript with it.
    const ownerToDelete = `den-vanishing-${RUN_ID}`;
    await createUser(ownerToDelete);
    const created = await prisma.orm.public.MessageConversations.create({
      _type: "DEN",
      createdById: ownerToDelete,
      name: `Vanishing ${RUN_ID}`,
      ownerId: ownerToDelete,
    });
    const den = created.id;
    conversationIds.push(den);
    await addMember(den, ownerToDelete, "OWNER");
    await addMember(den, MEMBER_ID, "MEMBER");
    await prisma.orm.public.Messages.create({
      ciphertext: "message-under-test",
      conversationId: den,
      id: randomUUID(),
      iv: "iv",
      senderId: MEMBER_ID,
    });

    await prisma.orm.public.Users.where((user) =>
      user.id.eq(ownerToDelete)
    ).deleteAndCount();

    const survivor = await prisma.orm.public.MessageConversations.select(
      "_type",
      "name",
      "ownerId",
      "createdById"
    )
      .where({ id: den })
      .first();
    expect(survivor?._type).toBe("DEN");
    expect(survivor?.name).toBe(`Vanishing ${RUN_ID}`);
    expect(survivor?.ownerId).toBeNull();
    expect(survivor?.createdById).toBeNull();

    const memberCount =
      await prisma.orm.public.MessageConversationMembers.where((member) =>
        member.conversationId.eq(den)
      ).aggregate((aggregate) => ({ count: aggregate.count() }));
    expect(memberCount.count).toBe(1);
  });

  test("deleting a member row keeps the conversation and its messages", async () => {
    // Leaving is a row delete, not a cascade. If the membership delete cascaded
    // into the conversation, a single "leave" would destroy the den.
    const den = await createDen({ name: `Leaving ${RUN_ID}` });
    await addMember(den, OWNER_ID, "OWNER");
    await addMember(den, MEMBER_ID, "MEMBER");
    await prisma.orm.public.Messages.create({
      ciphertext: "c",
      conversationId: den,
      id: randomUUID(),
      iv: "i",
      senderId: OWNER_ID,
    });

    await prisma.orm.public.MessageConversationMembers.where((member) =>
      and(member.conversationId.eq(den), member.userId.eq(MEMBER_ID))
    ).deleteAndCount();

    const still = await prisma.orm.public.MessageConversations.select("_type")
      .where({ id: den })
      .first();
    expect(still?._type).toBe("DEN");
  });

  test("the role column is guarded by the enum, not by application code", async () => {
    const den = await createDen({});
    await expect(
      prisma.orm.public.MessageConversationMembers.create({
        conversationId: den,
        role: "OWNER" as "MEMBER",
        userId: MEMBER_ID,
      })
    ).resolves.toBeTruthy();
    await expect(
      prisma.orm.public.MessageConversationMembers.create({
        conversationId: den,
        role: "SUPERUSER" as "MEMBER",
        userId: DM_PEER_ID,
      })
    ).rejects.toThrow();
    // Clean up the two rows so the shared membership counts above stay exact.
    await prisma.orm.public.MessageConversationMembers.where((member) =>
      and(
        member.conversationId.eq(den),
        or(member.userId.eq(MEMBER_ID), member.userId.eq(DM_PEER_ID))
      )
    ).deleteAndCount();
  });

  test("canManageDen agrees with what the database stored", async () => {
    // The database holds the role; the helper decides what it may do. Asserting
    // they agree is the guard against a future contract edit renaming a value
    // out from under the authorization check.
    const den = await createDen({ name: `Roles ${RUN_ID}` });
    await addMember(den, OWNER_ID, "OWNER");
    await addMember(den, MEMBER_ID, "MEMBER");

    const rows = await prisma.orm.public.MessageConversationMembers.select(
      "role",
      "userId"
    )
      .where({ conversationId: den })
      .all();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(canManageDen(row.role)).toBe(row.role !== "MEMBER");
    }
  });
});
