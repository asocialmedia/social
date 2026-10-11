import {
  and,
  fromPrismaDateTime,
  getUserDataQuery,
  mapUserData,
  prisma,
} from "@asm/db";
import type { ConversationType } from "@asm/db";

import { ACCESS_ENDED_MESSAGE } from "./access-ended";
import { blockedSendPeer } from "./blocks";

// The server never sees plaintext, but it does validate membership, follow
// relationships, and blocks so the API cannot be abused to spam or read
// outside a conversation. What a block means inside a conversation is decided
// once, in `./blocks`; this file only answers the database half of it.

function loadConversationRow(conversationId: string) {
  return prisma.orm.public.MessageConversations.select(
    "id",
    "pairKey",
    "_type",
    "name",
    "description",
    "avatarMediaId",
    "wallpaperKey",
    "wallpaperDim",
    "wallpaperMediaId",
    "ownerId",
    "inviteCode",
    "createdAt",
    // The roster-only counter, on the detail payload for the same reason it is on
    // the list payload: the client compares it against the last value the server
    // reported and refetches when it is ahead.
    "membershipSeq",
    "updatedAt"
  )
    .include("messageConversationMembers", (member) =>
      member
        .select(
          "userId",
          "createdAt",
          // Den-only, and the column the read/write split turns on. NULL for every
          // DM row, so nothing in the DM path has to know it exists.
          "leftAt",
          "role",
          "lastReadAt",
          "mutedAt",
          "themeKey",
          "wallpaperDim",
          "wallpaperKey",
          "wallpaperMediaId"
        )
        .include("user", (_user) =>
          getUserDataQuery(prisma.orm, "").include(
            "messageIdentities",
            (identity) => identity.select("publicKey")
          )
        )
    )
    .include("messageConversationKeys")
    .where({ id: conversationId })
    .first();
}

type ConversationRow = NonNullable<
  Awaited<ReturnType<typeof loadConversationRow>>
>;

// `_type` is renamed to `type` on the way out. The underscore exists only
// because `type` collides with a PSL keyword in the authored contract; no client
// should have to know that, so the raw name is destructured away rather than
// shipped alongside the friendly one.
function mapConversationRow(row: ConversationRow) {
  const { _type, ...rest } = row;
  return {
    ...rest,
    createdAt: fromPrismaDateTime(row.createdAt),
    keys: row.messageConversationKeys.map((key) => ({
      ...key,
      createdAt: fromPrismaDateTime(key.createdAt),
    })),
    members: row.messageConversationMembers.map((member) => {
      if (!member.user) {
        throw new Error("Conversation member has no user");
      }
      return {
        ...member,
        lastReadAt: member.lastReadAt
          ? fromPrismaDateTime(member.lastReadAt)
          : null,
        leftAt: member.leftAt ? fromPrismaDateTime(member.leftAt) : null,
        mutedAt: member.mutedAt ? fromPrismaDateTime(member.mutedAt) : null,
        user: {
          ...mapUserData(member.user),
          messageIdentity: member.user.messageIdentities,
        },
      };
    }),
    type: _type,
    updatedAt: fromPrismaDateTime(row.updatedAt),
  };
}

// Whether `userId` is blocked from `conversation`, for a DM. Returns false
// without touching the database for a den, because a block is a DM-only rule: a
// den admits and stays visible regardless of who blocks whom, so the block probe
// stays off the hot path for every group read rather than running and being
// discarded.
//
// The peer comes from `./blocks`, so this is the database half of the one rule
// rather than a second copy of it.
export async function isBlockedFromConversation(
  conversation: {
    members: { userId: string }[];
    type: ConversationType;
  },
  userId: string
): Promise<boolean> {
  const peer = blockedSendPeer(conversation, userId);
  if (!peer) {
    return false;
  }
  return await areBlocked(userId, peer);
}

// Whether this user is still a member of the conversation. Nothing else.
//
// This is the re-check an ALREADY-OPEN stream runs when the conversation's
// roster moves, and again on every keep-alive tick. Membership is checked once
// when a stream connects, which leaves a window: a member removed an hour into
// an open thread keeps receiving its ciphertext, and in a den they can still
// unwrap it. Re-reading the whole conversation payload to answer a yes/no
// question every twenty seconds per open stream would be absurd, so this asks
// the one indexed question instead.
//
// `leftAt isNull` is what makes "still a member" mean "may still receive". A
// departed member has a row, so without it this would keep saying yes to somebody
// who has just walked out and the stream would carry on delivering ciphertext
// that only the people still in the den can unwrap.
//
// No block check, unlike getConversationForUser: a DM's block does not end an
// open stream (the peer is already known to this tab, and their block is not
// this member's business), and a den is unaffected by blocks either way.
// Membership is the only thing that revokes access mid-stream.
export async function isConversationMember(
  conversationId: string,
  userId: string
): Promise<boolean> {
  const member = await prisma.orm.public.MessageConversationMembers.select(
    "conversationId"
  )
    .where((candidate) =>
      and(
        candidate.conversationId.eq(conversationId),
        candidate.userId.eq(userId),
        candidate.leftAt.isNull()
      )
    )
    .first();
  return member !== null;
}

// Returns the conversation only when `userId` is one of its members.
//
// This is a READ gate, and deliberately so: somebody who left a den keeps their
// membership row, is admitted here, and can therefore still read everything that
// was said before they went. Every write asks `hasLeftConversation` after this
// returns, so the split is read-admits / write-refuses rather than two separate
// membership tests that could disagree.
//
// When `enforceBlocks` is true (the default), a bidirectional block between
// the two members of a DM makes the conversation invisible: every read,
// key-fetch, stream, typing and read-receipt route resolves through this gate,
// so a blocked pair loses read/stream/delete access, not just the ability to
// send. The send path passes false so it can answer with its own clearer 403.
//
// The gate applies to DMs only, because a block is a DM-only rule. A den admits
// regardless of blocks, so membership alone decides access to one - which is not
// the same as saying a den "has no peer to be blocked from". That was the older
// framing and it reads like an invitation to put a door check back: a den does
// have members, and two of them may well have a block. The reason there is
// nothing here is the rule, not the absence of a peer.
export async function getConversationForUser(
  conversationId: string,
  userId: string,
  options: { enforceBlocks?: boolean } = {}
) {
  const conversationRow = await loadConversationRow(conversationId);
  const conversation = conversationRow
    ? mapConversationRow(conversationRow)
    : null;
  if (!conversation) {
    return null;
  }
  if (!conversation.members.some((member) => member.userId === userId)) {
    return null;
  }
  if (
    options.enforceBlocks !== false &&
    (await isBlockedFromConversation(conversation, userId))
  ) {
    return null;
  }
  return conversation;
}

// Whether this user's membership in `conversation` has stopped being able to act.
//
// Only ever true for a den: a departed member keeps their row so the den stays in
// their list and their history stays readable, and this is the flag that carries
// that distinction into the routes. `getConversationForUser` admits them on
// purpose - refusing them there would take the history with them - and every
// write then asks this, once, before it touches a row.
//
// It reads the payload rather than the database because every caller has already
// loaded it, and the payload is the conversation the write is about: a row that
// changed underneath the read cannot be re-read away.
export function hasLeftConversation(
  conversation: { members?: { leftAt?: Date | null; userId: string }[] },
  userId: string
): boolean {
  // `members` optional and `leftAt` coalesced, because both are absent in the two
  // shapes this is handed besides a full row: a DM (no `leftAt`) and the trimmed
  // conversation some route tests build. Absent reads as "still here", which is
  // the safe direction: it can only ever offer the write, and the write's own row
  // check still refuses if the person really is out.
  const member = conversation.members?.find((row) => row.userId === userId);
  return (member?.leftAt ?? null) !== null;
}

// The refusal a departed member gets for every write, in one place.
//
// One function so the status, the code and the sentence cannot drift between the
// eight routes that use it. The status is 403 rather than the 404 the membership
// gate answers with, and the difference is the whole point of the split: a 404
// would tell somebody who can still read the whole conversation that it does not
// exist.
//
// The body carries `MEMBERSHIP_ENDED` as well as the sentence, because the client
// has to do something different for this than for any other 403: it turns the
// composer into its read-only state rather than showing an error that goes away
// on the next attempt. There is no next attempt that can succeed.
export function leftConversationResponse(): Response {
  return Response.json(
    { code: "MEMBERSHIP_ENDED", error: ACCESS_ENDED_MESSAGE },
    { status: 403 }
  );
}

// A block is bidirectional in practice: either party blocking is enough to
// prevent messaging between the pair.
export async function areBlocked(a: string, b: string): Promise<boolean> {
  const [ab, ba] = await Promise.all([
    prisma.orm.public.Blocks.select("blockerId")
      .where((block) => and(block.blockerId.eq(a), block.blockedId.eq(b)))
      .first(),
    prisma.orm.public.Blocks.select("blockerId")
      .where((block) => and(block.blockerId.eq(b), block.blockedId.eq(a)))
      .first(),
  ]);
  return Boolean(ab || ba);
}

export async function hasMessageIdentity(userId: string): Promise<boolean> {
  return (
    (await prisma.orm.public.MessageIdentities.select("userId")
      .where({ userId })
      .first()) !== null
  );
}

export function messageSenderSelect() {
  return getUserDataQuery(prisma.orm, "");
}

// The sender's current ratchet index. The authoritative source is the message
// count for that (conversation, sender) pair - indexes are dense (0, 1, 2, ...)
// so the count IS the next index. The atomic per-owner counter on the key row
// is kept in step with the count, but may lag behind rows created before the
// counter existed, so take the max of the two. The unique
// (conversationId, senderId, ratchetIndex) constraint still guards concurrent
// sends that race between the read and the create.
//
// A member can hold several wraps (one per root-key epoch, see
// MessageConversationKey.version); only the newest epoch is active, so its
// counter is the one to read.
export async function nextRatchetIndex(
  conversationId: string,
  senderId: string
): Promise<number> {
  const [key, sentCount] = await Promise.all([
    prisma.orm.public.MessageConversationKeys.select("ratchetCounter")
      .where((keyRow) =>
        and(
          keyRow.conversationId.eq(conversationId),
          keyRow.ownerUserId.eq(senderId)
        )
      )
      // A member can hold one wrap per root-key epoch; only the newest is
      // active, so read that epoch's counter.
      .orderBy((keyRow) => keyRow.version.desc())
      .first(),
    prisma.orm.public.Messages.where((message) =>
      and(
        message.conversationId.eq(conversationId),
        message.senderId.eq(senderId)
      )
    ).aggregate((aggregate) => ({ count: aggregate.count() })),
  ]);
  return Math.max(key?.ratchetCounter ?? 0, sentCount.count);
}

// Safely parses a request body. A malformed JSON body returns null so the
// route can answer 400 instead of letting the parse rejection bubble into a
// 500. Routes cast the result to their own payload shape and validate fields
// themselves.
export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// Prisma surfaces unique constraint conflicts as P2002. Prisma 8 does not map
// driver errors to Prisma codes: they bubble from the pg driver as the
// PostgreSQL SQLSTATE 23505 (unique_violation), so check both shapes.
export function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const { code } = error as { code?: unknown };
  return code === "23505" || code === "P2002";
}
