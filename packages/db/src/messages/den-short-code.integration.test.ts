import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  DEN_LIMITS,
  DEN_SHORT_CODE_LENGTH,
  DenError,
  createDen,
  createDenInvite,
  createDenShortCode,
  getDenMembership,
  isDenShortCode,
  joinDenByInviteCode,
  previewInvite,
  prisma,
  toPrismaDateTime,
} from "@asm/db";

// Integration test suite for 6-character short den invite codes.
//
// Tests live database behavior:
// 1. Creation mints both 12-char link codes and 6-char short codes.
// 2. Minting replaces, archives outgoing code, and prunes to DEN_LIMITS.retiredInviteCodeMax.
// 3. Independence: minting link never alters short code columns and vice versa.
// 4. Lazy expiry: expired short code is named by previewInvite as expired and refused
//    with byte-identical 404 by joinDenByInviteCode.
// 5. Expiry boundary: expiresAt <= now is refused.
// 6. Case-insensitive resolve: lowercase input resolves correctly.
// 7. Cross-kind resolution: live short code beats an archive row.

const RUN_ID =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    .replaceAll("-", "_")
    .slice(0, 18);

const OWNER_ID = `dscode_owner_${RUN_ID}`;
const MATE_ID = `dscode_mate_${RUN_ID}`;
const OUTSIDER_ID = `dscode_out_${RUN_ID}`;
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

async function makeDen(label: string): Promise<string> {
  const den = await createDen({
    creatorId: OWNER_ID,
    memberIds: [MATE_ID],
    name: `ShortCode ${label} ${RUN_ID}`,
  });
  denIds.push(den.id);
  return den.id;
}

async function shortCodeOf(conversationId: string): Promise<string> {
  const row = await prisma.orm.public.MessageConversations.select(
    "inviteShortCode"
  )
    .where({ id: conversationId })
    .first();
  if (!row?.inviteShortCode) {
    throw new Error("expected the den to have a live invite short code");
  }
  return row.inviteShortCode;
}

async function linkCodeOf(conversationId: string): Promise<string> {
  const row = await prisma.orm.public.MessageConversations.select("inviteCode")
    .where({ id: conversationId })
    .first();
  if (!row?.inviteCode) {
    throw new Error("expected the den to have a live invite link code");
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

beforeAll(async () => {
  await Promise.all(BASE_USER_IDS.map((id) => createUser(id)));
});

afterAll(async () => {
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

describe("den short codes", () => {
  test("creation mints both link code and short code", async () => {
    const denId = await makeDen("CreationBoth");
    const den = await prisma.orm.public.MessageConversations.select(
      "inviteCode",
      "inviteDurationDays",
      "inviteExpiresAt",
      "inviteShortCode",
      "inviteShortCodeDurationDays",
      "inviteShortCodeExpiresAt"
    )
      .where({ id: denId })
      .first();

    expect(den).not.toBeNull();
    expect(den?.inviteCode).toBeDefined();
    expect(den?.inviteCode?.length).toBe(DEN_LIMITS.inviteCodeLength);
    expect(den?.inviteExpiresAt).toBeNull();
    expect(den?.inviteDurationDays).toBeNull();

    expect(den?.inviteShortCode).toBeDefined();
    expect(den?.inviteShortCode?.length).toBe(DEN_SHORT_CODE_LENGTH);
    expect(isDenShortCode(den?.inviteShortCode ?? "")).toBe(true);
    expect(den?.inviteShortCodeExpiresAt).toBeNull();
    expect(den?.inviteShortCodeDurationDays).toBeNull();
  });

  test("minting replaces short code, archives old code, and bounds retention", async () => {
    const denId = await makeDen("RotateAndArchive");
    const initialShortCode = await shortCodeOf(denId);

    const firstMint = await createDenShortCode(denId, OWNER_ID, 7);
    expect(firstMint.inviteShortCode).not.toBe(initialShortCode);
    expect(isDenShortCode(firstMint.inviteShortCode)).toBe(true);
    expect(firstMint.inviteShortCodeExpiresAt).toBeInstanceOf(Date);

    // Old code is in the archive table
    const archiveRow =
      await prisma.orm.public.MessageConversationInviteCodes.select(
        "conversationId"
      )
        .where({ code: initialShortCode })
        .first();
    expect(archiveRow?.conversationId).toBe(denId);

    // Check bounded retention: rotate retiredInviteCodeMax more times
    let lastCode = firstMint.inviteShortCode;
    for (let i = 0; i < DEN_LIMITS.retiredInviteCodeMax; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- sequential rotations
      const nextMint = await createDenShortCode(denId, OWNER_ID);
      expect(nextMint.inviteShortCode).not.toBe(lastCode);
      lastCode = nextMint.inviteShortCode;
    }

    const archived = await archivedCodes(denId);
    expect(archived.length).toBe(DEN_LIMITS.retiredInviteCodeMax);
    // The current live code is not in the archive
    expect(archived).not.toContain(lastCode);
  });

  test("door independence: minting link never touches short code and vice versa", async () => {
    const denId = await makeDen("DoorIndependence");

    // Mint a short code with 7-day preset
    const shortMint = await createDenShortCode(denId, OWNER_ID, 7);
    const linkBefore = await linkCodeOf(denId);

    const denAfterShort = await prisma.orm.public.MessageConversations.select(
      "inviteCode",
      "inviteDurationDays",
      "inviteExpiresAt",
      "inviteShortCode",
      "inviteShortCodeDurationDays",
      "inviteShortCodeExpiresAt"
    )
      .where({ id: denId })
      .first();

    // Link columns remained untouched
    expect(denAfterShort?.inviteCode).toBe(linkBefore);
    expect(denAfterShort?.inviteDurationDays).toBeNull();
    expect(denAfterShort?.inviteExpiresAt).toBeNull();
    expect(denAfterShort?.inviteShortCode).toBe(shortMint.inviteShortCode);
    expect(denAfterShort?.inviteShortCodeDurationDays).toBe(7);

    // Now mint a link code with 1-day preset
    const linkMint = await createDenInvite(denId, OWNER_ID, 1);

    const denAfterLink = await prisma.orm.public.MessageConversations.select(
      "inviteCode",
      "inviteDurationDays",
      "inviteExpiresAt",
      "inviteShortCode",
      "inviteShortCodeDurationDays",
      "inviteShortCodeExpiresAt"
    )
      .where({ id: denId })
      .first();

    // Short code columns remained byte-identical
    expect(denAfterLink?.inviteShortCode).toBe(shortMint.inviteShortCode);
    expect(denAfterLink?.inviteShortCodeDurationDays).toBe(7);
    expect(denAfterLink?.inviteShortCodeExpiresAt).toEqual(
      denAfterShort?.inviteShortCodeExpiresAt
    );
    // Link columns were updated
    expect(denAfterLink?.inviteCode).toBe(linkMint.inviteCode);
    expect(denAfterLink?.inviteDurationDays).toBe(1);
    expect(denAfterLink?.inviteExpiresAt).toBeDefined();
  });

  test("expiry: preview returns expired shape and join throws 404 NOT_FOUND", async () => {
    const denId = await makeDen("ExpiryTest");
    const shortCode = await shortCodeOf(denId);

    // Set expiry 10 minutes in the past
    const past = new Date(Date.now() - 600_000);
    await prisma.orm.public.MessageConversations.where((candidate) =>
      candidate.id.eq(denId)
    ).updateAndCount({
      inviteShortCodeExpiresAt: toPrismaDateTime(past),
    });

    const preview = await previewInvite(shortCode);
    expect(preview).not.toBeNull();
    expect(preview?.expired).toBe(true);
    expect(preview?.id).toBe(denId);
    expect(preview?.inviteCode).toBe(shortCode);
    expect(preview?.avatarMediaId).toBeNull();
    expect(preview?.ownerId).toBe(OWNER_ID);

    // Join attempt fails with standard 404
    await expect(joinDenByInviteCode(shortCode, OUTSIDER_ID)).rejects.toThrow(
      new DenError("NOT_FOUND", "That join code is not valid")
    );
  });

  test("boundary: expiresAt == now refuses", async () => {
    const denId = await makeDen("BoundaryNow");
    const shortCode = await shortCodeOf(denId);

    const now = new Date();
    await prisma.orm.public.MessageConversations.where((candidate) =>
      candidate.id.eq(denId)
    ).updateAndCount({
      inviteShortCodeExpiresAt: toPrismaDateTime(now),
    });

    // The boundary is <= now, so it must be refused
    await expect(joinDenByInviteCode(shortCode, OUTSIDER_ID)).rejects.toThrow(
      new DenError("NOT_FOUND", "That join code is not valid")
    );

    const preview = await previewInvite(shortCode);
    expect(preview?.expired).toBe(true);
  });

  test("case-insensitive resolution: lowercase short code resolves in preview and join", async () => {
    const denId = await makeDen("CaseInsensitive");
    const shortCode = await shortCodeOf(denId);
    const lowercaseCode = shortCode.toLowerCase();

    // Preview resolves even with lowercase code
    const preview = await previewInvite(lowercaseCode);
    expect(preview).not.toBeNull();
    expect(preview?.id).toBe(denId);
    expect(preview?.expired).toBe(false);
    expect(preview?.inviteCode).toBe(shortCode);

    // Join resolves even with lowercase code
    const result = await joinDenByInviteCode(lowercaseCode, OUTSIDER_ID);
    expect(result.id).toBe(denId);
    expect(result.alreadyMember).toBe(false);

    const member = await getDenMembership(denId, OUTSIDER_ID);
    expect(member).not.toBeNull();
  });

  test("cross-kind archive: live short code beats archive row from another den", async () => {
    const victimDenId = await makeDen("CrossKindVictim");
    const liveDenId = await makeDen("CrossKindLive");

    const liveShortCode = await shortCodeOf(liveDenId);

    // Insert an archive row in victim den with the exact same code
    await prisma.orm.public.MessageConversationInviteCodes.create({
      code: liveShortCode,
      conversationId: victimDenId,
      retiredAt: toPrismaDateTime(new Date()),
    });

    // Preview must resolve to the live den, not the retired victim den
    const preview = await previewInvite(liveShortCode);
    expect(preview).not.toBeNull();
    expect(preview?.id).toBe(liveDenId);
    expect(preview?.expired).toBe(false);
  });

  test("manager gate refuses non-managers from minting short code", async () => {
    const denId = await makeDen("ManagerGate");
    // Plain member gets FORBIDDEN
    await expect(createDenShortCode(denId, MATE_ID)).rejects.toThrow(
      new DenError("FORBIDDEN", "Only the owner or an elder can do that")
    );

    // Non-member gets NOT_FOUND
    await expect(createDenShortCode(denId, OUTSIDER_ID)).rejects.toThrow(
      new DenError("NOT_FOUND", "You are not a member of this den")
    );
  });
});
