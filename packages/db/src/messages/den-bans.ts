// Reading a den's bans, and the shared vocabulary around them.
//
// The mutations live in `den-service.ts` rather than here, and that placement is
// forced rather than tasteful: banning somebody who is still inside has to remove
// them AND write the ban in ONE transaction, so it needs the claim lock, the
// membership announcement and the ended-notification machinery that are private to
// that file. Splitting the two halves across files would mean a window in which a
// person is out of the den but not yet banned, and could walk back in through the
// link in between - which is the entire bug this feature exists to close.
//
// So this file owns what the rest of the app asks for: "is this person banned from
// this den", "who is banned from it", and the reason a client sends. One import
// direction only - this file reads `den-service`, never the reverse.

import { and } from "@prisma/orm-postgres/orm-client";

import prisma, { fromPrismaDateTime } from "../prisma";
import { requireDenManager } from "./den-service";
import { DEN_LIMITS } from "./dens";

// `DEN_BAN_REASON_MAX` and `normalizeDenBanReason` live in `./dens`, beside the den
// limits and the group-add copy, because the client needs the same number the server
// slices to. Re-exported here because this is the module the ban code reads from and a
// caller should not have to know which of the two files it landed in.
export { DEN_BAN_REASON_MAX, normalizeDenBanReason } from "./dens";

// One ban, as the manager-facing list reports it.
export interface DenBan {
  // The banned person's own avatar, read live with everything else about them, so the
  // manager-facing row is drawn from the same fields as the roster row above it rather
  // than a second, thinner shape.
  avatarUrl: string | null;
  // Who imposed it. Null when that account has been deleted, which is why the
  // foreign key is SetNull: losing the manager must not quietly let their ban lapse.
  bannedById: string | null;
  bannedByName: string | null;
  createdAt: Date;
  // The ban target's own display fields, read live rather than snapshotted. A ban row
  // deliberately stores no name columns, so somebody who was banned and then changed
  // their display name is shown under the new one everywhere instead of being frozen
  // into a moderator's list.
  displayName: string | null;
  // Which den. Carried so a caller holding several ban lists cannot mistake one for
  // another, and because the mapper already reads it - leaving it out of the type let
  // the shape drift without a compiler noticing.
  conversationId: string;
  reason: string | null;
  userId: string;
  username: string | null;
}

// How many bans one list page may return.
//
// The den ceiling, so the list cannot be used as a sweep of the column, and because a
// den whose ban list is larger than its membership ceiling is not a case this
// product has to render well. A den can accumulate more bans than it ever had
// members; the page is where that stops being true, and the honest answer then is
// that this surface shows the most recent N.
const MAX_BANS = DEN_LIMITS.membersMax;

// Whether this account is banned from this den. The single predicate both doors ask,
// so an invite join and a manager add cannot disagree about it.
export async function isDenBanned(
  conversationId: string,
  userId: string
): Promise<boolean> {
  const row = await prisma.orm.public.MessageDenBans.select("userId")
    .where((ban) =>
      and(ban.conversationId.eq(conversationId), ban.userId.eq(userId))
    )
    .first();
  return row !== null;
}

// Which of these accounts are banned from this den, in one read.
//
// The bulk form because the direct-add picker asks about several people at a time and
// one query per row would be a query per row of an open dialog. A den can have at
// most DEN_LIMITS.membersMax people in it and at most that many bans against it, so
// the id list is bounded by the caller rather than here.
export async function filterBannedUserIds(
  conversationId: string,
  userIds: readonly string[]
): Promise<Set<string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) {
    return new Set();
  }
  const rows = await prisma.orm.public.MessageDenBans.select("userId")
    .where((ban) =>
      and(ban.conversationId.eq(conversationId), ban.userId.in(unique))
    )
    .all();
  return new Set(rows.map((row) => row.userId));
}

// This den's active bans, newest first. Manager only, and the gate is the same
// `requireDenManager` every other den mutation runs, so a plain member gets a 403
// here for the same reason they get one from the remove route.
//
// Newest first because the reason a manager opens this list is almost always "who
// did we just kick", which is the row at the top.
export async function listDenBans(
  conversationId: string,
  actorId: string
): Promise<DenBan[]> {
  await requireDenManager(conversationId, actorId);
  const rows = await prisma.orm.public.MessageDenBans.select(
    "bannedById",
    "conversationId",
    "createdAt",
    "reason",
    "userId"
  )
    .include("user", (user) =>
      user.select("avatarUrl", "displayName", "username")
    )
    .include("bannedBy", (manager) => manager.select("displayName"))
    .where((ban) => ban.conversationId.eq(conversationId))
    .orderBy([(ban) => ban.createdAt.desc(), (ban) => ban.userId.asc()])
    .limit(MAX_BANS)
    .all();
  return rows.map((row) => ({
    avatarUrl: row.user?.avatarUrl ?? null,
    bannedById: row.bannedById,
    bannedByName: row.bannedBy?.displayName ?? null,
    conversationId: row.conversationId,
    // A real Date rather than the temporal the query hands back, so the route that
    // serialises this does not have to know which shape it was given.
    createdAt: fromPrismaDateTime(row.createdAt),
    displayName: row.user?.displayName ?? null,
    reason: row.reason,
    userId: row.userId,
    username: row.user?.username ?? null,
  }));
}
