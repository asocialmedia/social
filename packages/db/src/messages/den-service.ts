import { randomBytes } from "node:crypto";

import { and } from "@prisma/orm-postgres/orm-client";

import { enqueueNotificationCreated } from "../../queue";
import prisma, { fromPrismaDateTime, toPrismaDateTime } from "../prisma";
import type { PrismaTransaction } from "../prisma";
import { publishDenMembershipChanged } from "../redis";
import type { DenMembershipAction } from "../redis";
import { createDenMembershipEndedNotifications } from "./den-membership-notifications";
import type { DenMembershipEndedNotification } from "./den-membership-notifications";
import {
  canManageDen,
  canManageRole,
  DEN_INVITE_CODE_ALPHABET,
  DEN_LIMITS,
  normalizeDenName,
  validateDenDescription,
  validateDenName,
} from "./dens";
import type { DenRole } from "./dens";

// Den (group conversation) mutation layer.
//
// Every function here is the authority on who may do what. Routes parse bodies
// and map errors to status codes; they do not re-implement a permission check,
// because two copies of a rule is one rule too many and they will drift.
//
// Concurrency follows the rest of this package: an optimistic claim on
// `message_conversations.updatedAt` as the first statement inside the
// transaction. The claim is a real UPDATE that writes the value it just read, so
// it takes a Postgres row lock held to commit. Every other mutation on that den
// serializes behind it, which is what turns "count the members, refuse if over
// the cap" into an atomic check instead of a read-then-write race.
//
// Blocks are not consulted anywhere in this file, and that is a decision rather
// than an omission. See the note above `rosterIds` for the whole of it.

export class DenError extends Error {
  // Deliberately has no BLOCKED code. A block is a DM-only rule and this is the den
  // service, so there is no den outcome a block could produce - the reasoning is in
  // the note above `rosterIds`, and the same rule on the route side is
  // `validateDenRoster`. A future reader looking for the refusal that used to be
  // here should find its absence, which is why this union is not padded back out.
  code:
    | "ALREADY_MEMBER"
    | "FORBIDDEN"
    | "INVALID_INPUT"
    | "INVALID_ROLE"
    | "LIMIT_REACHED"
    | "MEMBERS_REQUIRED"
    | "NOT_A_DEN"
    | "NOT_FOUND"
    | "SELF_ACTION";
  constructor(code: DenError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "DenError";
  }
}

// Prisma 8 does not map driver errors to Prisma codes: a unique violation
// bubbles from the pg driver as SQLSTATE 23505. Both shapes are checked.
function isUniqueConstraintViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2002" || code === "23505";
}

// A transaction that lost a race and is safe to replay: 40001 serialization
// failure, 40P01 deadlock, 23505 unique violation. Every caller re-derives its
// whole write inside the fresh transaction, so a replay cannot double-apply.
function isRetryableConflict(error: unknown): boolean {
  if (error instanceof DenError) {
    // A domain outcome is final. Replaying only repeats the same refusal.
    return false;
  }
  if (error instanceof Error && "sqlState" in error) {
    return (
      error.sqlState === "40001" ||
      error.sqlState === "40P01" ||
      error.sqlState === "23505"
    );
  }
  return (
    error instanceof Error && error.message.includes("could not serialize")
  );
}

async function runWithRetry<T>(
  operation: (tx: PrismaTransaction) => Promise<T>,
  attemptsRemaining = 4
): Promise<T> {
  try {
    return await prisma.transaction(operation);
  } catch (error) {
    if (!isRetryableConflict(error) || attemptsRemaining <= 1) {
      throw error;
    }
    return await runWithRetry(operation, attemptsRemaining - 1);
  }
}

export interface DenMembership {
  role: DenRole;
}

export interface CreateDenInput {
  avatarMediaId?: string | null;
  description?: string | null;
  // Verified by the caller before reaching here: every id must exist and have a
  // message identity (a wrap is the price of membership), and be followed by the
  // creator. Blocks are NOT part of this contract: a den admits regardless of
  // blocks, so there is nothing here for a block to fail.
  memberIds: string[];
  creatorId: string;
  name: string;
}

// Generates a join code from the unambiguous alphabet. Rejection sampling keeps
// the distribution uniform: a plain `% alphabet.length` would bias toward the
// first few symbols, because 256 is not a multiple of 31.
export function generateInviteCode(): string {
  const alphabet = DEN_INVITE_CODE_ALPHABET;
  const length = DEN_LIMITS.inviteCodeLength;
  // 256 % 31 = 8, so bytes at or above 248 are discarded rather than folded.
  const limit = 256 - (256 % alphabet.length);
  let code = "";
  while (code.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit) {
        code += alphabet[byte % alphabet.length];
        if (code.length === length) {
          break;
        }
      }
    }
  }
  return code;
}

// Bounds the invite-code retry loop. 31^12 codes make a collision a
// non-event; the loop exists so a pathological state degrades to a clean error
// rather than spinning.
const INVITE_CODE_ATTEMPTS = 5;

// One create attempt. Null means the code collided and the caller should try
// another; anything else propagates. Split out so the announcement can be
// published after the commit, outside the retry's catch -- a publish that threw
// in there would be mistaken for a collision and would re-create the den.
async function createDenAttempt(params: {
  avatarMediaId: string | null;
  creatorId: string;
  description: string | null;
  inviteCode: string;
  memberIds: string[];
  name: string;
}): Promise<{ id: string; inviteCode: string } | null> {
  try {
    return await prisma.transaction(async (tx) => {
      // `membershipSeq` is left at its default of 0 rather than set to 1: a
      // creation is not a change to a roster that already existed, it is the
      // first state of one, and there is no client anywhere holding a stale view
      // of it to invalidate. A value of 0 also keeps a fresh den's counter
      // identical to a den created before the column existed.
      const den = await tx.orm.public.MessageConversations.create({
        _type: "DEN",
        avatarMediaId: params.avatarMediaId,
        createdById: params.creatorId,
        description: params.description,
        inviteCode: params.inviteCode,
        name: params.name,
        ownerId: params.creatorId,
      });
      // The owner row is written first, so a hypothetical partial write would
      // leave the den ownerless rather than memberless.
      await tx.orm.public.MessageConversationMembers.create({
        conversationId: den.id,
        role: "OWNER",
        userId: params.creatorId,
      });
      // Sequential on purpose. These are dependent writes to the same
      // conversation in one transaction, and a parallel fan-out would buy
      // nothing on a pool that is already holding this transaction's
      // connection.
      const invitees = params.memberIds.filter(
        (userId) => userId !== params.creatorId
      );
      for (const userId of invitees) {
        // oxlint-disable-next-line no-await-in-loop -- sequential writes under one connection, see above
        await tx.orm.public.MessageConversationMembers.create({
          conversationId: den.id,
          invitedById: params.creatorId,
          role: "MEMBER",
          userId,
        });
      }
      return { id: den.id, inviteCode: params.inviteCode };
    });
  } catch (error) {
    // Two possible causes: the code collided, or a member row collided. The
    // second cannot happen (ids are deduped, the den id is fresh), so retrying
    // is safe and bounded.
    if (isUniqueConstraintViolation(error) || isRetryableConflict(error)) {
      return null;
    }
    throw error;
  }
}

export async function createDen(
  input: CreateDenInput
): Promise<{ id: string; inviteCode: string }> {
  const name = normalizeDenName(input.name);
  const nameError = validateDenName(name);
  if (nameError) {
    throw new DenError("INVALID_INPUT", nameError);
  }
  const description = (input.description ?? "").trim();
  const descriptionError = validateDenDescription(description);
  if (descriptionError) {
    throw new DenError("INVALID_INPUT", descriptionError);
  }
  // The creator is always a member, so this union is the authoritative roster.
  const memberIds = [
    ...new Set([input.creatorId, ...input.memberIds]),
  ].toSorted();
  if (memberIds.length < DEN_LIMITS.membersMin) {
    throw new DenError("MEMBERS_REQUIRED", "A den needs at least two people");
  }
  if (memberIds.length > DEN_LIMITS.membersMax) {
    throw new DenError(
      "LIMIT_REACHED",
      `A den can have at most ${DEN_LIMITS.membersMax} members`
    );
  }

  for (let attempt = 1; attempt <= INVITE_CODE_ATTEMPTS; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- bounded retry, each attempt must settle before the next
    const created = await createDenAttempt({
      avatarMediaId: input.avatarMediaId ?? null,
      creatorId: input.creatorId,
      description: description || null,
      inviteCode: generateInviteCode(),
      memberIds,
      name,
    });
    if (!created) {
      continue;
    }
    // The whole roster is told, because every one of them has a conversation
    // LIST that has never seen this den. Published here rather than inside the
    // transaction, so a retry that loses its race announces nothing.
    // oxlint-disable-next-line no-await-in-loop -- bounded retry, see above
    await flushDenAnnouncement(created.id, input.creatorId, {
      action: "created",
      memberIds,
    });
    return created;
  }
  throw new DenError("INVALID_INPUT", "Couldn't generate a join code");
}

export async function getDenMembership(
  conversationId: string,
  userId: string
): Promise<DenMembership | null> {
  const member = await prisma.orm.public.MessageConversationMembers.select(
    "role"
  )
    .where((candidate) =>
      and(
        candidate.conversationId.eq(conversationId),
        candidate.userId.eq(userId)
      )
    )
    .first();
  return member ? { role: member.role } : null;
}

// Membership only, and DM-aware. A DM row carries MEMBER too, so the type check
// is what stops a management route from being pointed at somebody's private
// thread and finding a plausible-looking member row there.
export async function requireDenMembership(
  conversationId: string,
  userId: string
): Promise<DenMembership> {
  const den = await prisma.orm.public.MessageConversations.select("_type")
    .where({ id: conversationId })
    .first();
  if (!den) {
    throw new DenError("NOT_FOUND", "Den not found");
  }
  if (den._type !== "DEN") {
    throw new DenError("NOT_A_DEN", "That is not a den");
  }
  const membership = await getDenMembership(conversationId, userId);
  if (!membership) {
    throw new DenError("FORBIDDEN", "You are not a member of this den");
  }
  return membership;
}

export async function requireDenManager(
  conversationId: string,
  userId: string
): Promise<DenMembership> {
  const membership = await requireDenMembership(conversationId, userId);
  // `canManageDen`, not a written-out `role !== "OWNER" && role !== "ADMIN"`.
  //
  // The role table lives in `dens.ts` precisely so there is one answer to "who
  // may manage a den", and the UI already reads it from there. Spelling the same
  // comparison out here meant the two were free to diverge, which is the failure
  // that hurts: add a role to `DEN_MANAGEMENT_ROLES` and the panels start drawing
  // its controls while this keeps refusing them, so the button is on screen and
  // every press is a 403 and nothing anywhere is red.
  if (!canManageDen(membership.role)) {
    // Product copy, not a diagnostic: this string is forwarded verbatim to the
    // client and read by the person whose button did nothing, so it names the
    // roles the way the product names them.
    throw new DenError("FORBIDDEN", "Only the owner or an elder can do that");
  }
  return membership;
}

export async function requireDenOwner(
  conversationId: string,
  userId: string
): Promise<DenMembership> {
  const membership = await requireDenMembership(conversationId, userId);
  if (membership.role !== "OWNER") {
    throw new DenError("FORBIDDEN", "Only the owner can do that");
  }
  return membership;
}

// The den row as the claim found it, handed to every write that runs under it.
//
// `membershipSeq` rides along because the roster mutations below have to write
// `+1` of the value they claimed, and a second read inside the same transaction
// would be a value nothing has proved exclusive: the claim is what makes this
// writer the only one touching the row, so the row it already read IS the
// current counter. Reading it again later would return the same number and cost
// a round trip to say so.
interface ClaimedDen {
  membershipSeq: number;
}

// Optimistic claim on the den row. Re-reads, then issues a conditional no-op
// UPDATE matching the value just read. updateAndCount returns 1 when this caller
// won; anything else means another writer moved the row in between, so try
// again. The winning UPDATE holds a row lock to commit, serializing every other
// mutation on this den behind it.
async function claimDen(
  transaction: PrismaTransaction,
  conversationId: string
): Promise<ClaimedDen> {
  const den = await transaction.orm.public.MessageConversations.select(
    "membershipSeq",
    "updatedAt"
  )
    .where({ id: conversationId })
    .first();
  if (!den) {
    // Deleted between the caller's read and the claim. Every write the caller
    // issued after the claim would target a missing row anyway, so failing here
    // makes the real cause explicit instead of surfacing it as a later error.
    throw new DenError("NOT_FOUND", "Den not found");
  }
  const claimed = await transaction.orm.public.MessageConversations.where(
    (candidate) =>
      and(
        candidate.id.eq(conversationId),
        candidate.updatedAt.eq(den.updatedAt)
      )
  ).updateAndCount({ updatedAt: den.updatedAt });
  if (claimed === 1) {
    return { membershipSeq: den.membershipSeq };
  }
  return await claimDen(transaction, conversationId);
}

// Runs `write` while holding the den's claim lock. The write itself must not
// re-filter on `updatedAt`: the claim already serializes it, and a second
// filter would be a comparison against a value the claim has just changed.
async function withDenClaim<T>(
  conversationId: string,
  write: (tx: PrismaTransaction, claimed: ClaimedDen) => Promise<T>
): Promise<T> {
  return await runWithRetry(async (tx) => {
    const claimed = await claimDen(tx, conversationId);
    return await write(tx, claimed);
  });
}

// What a membership mutation owes its peers, decided while the transaction is
// open and published once it has resolved.
//
// The announcement is BUILT inside the transaction and SENT after it. Sending
// inside would announce a roster that a rollback then un-does, which is not a
// theoretical concern here: `runWithRetry` replays the callback on a
// serialization failure or a unique violation, so a losing attempt would already
// have told every open thread the den moved. It would also announce a change
// that never committed while a client is busy deciding which epoch it may still
// write into. Same shape as `deferred-events.ts` holding its queue until the
// commit, for the same reason.
//
// `memberIds` is the roster as it stands after the mutation, PLUS whoever left
// or was removed. They are no longer members, and their conversation list still
// shows the den until they refetch it, so their activity channel is exactly the
// one that has to hear about it.
export interface DenAnnouncement {
  action: DenMembershipAction;
  memberIds: string[];
  // The post-increment `message_conversations.membershipSeq`, so a receiver can
  // tell a fresh announcement from a duplicate and notice one it never got.
  //
  // Optional because a dissolve has no value to report: the row is gone by the
  // time this publishes, and a dissolve is terminal for every receiver anyway.
  // An absent value degrades to the pre-sequence behaviour, never to a guess.
  membershipSeq?: number;
}

// What a mutation owes the members who are no longer coming back, for the same
// reason and with the same after-commit discipline. Null means the mutation left
// everybody in, which is every mutation that is not a removal or a dissolve.
type DenMembershipEnded = DenMembershipEndedNotification[] | null;

// Null means "nothing actually moved" -- a re-add of somebody already inside, a
// re-join through a link they had already used, a rename, a code rotation. Those
// write nothing to the roster, so announcing them would be a refetch every
// member pays for and learns nothing from.
async function flushDenAnnouncement(
  conversationId: string,
  actorId: string,
  announcement: DenAnnouncement | null
): Promise<void> {
  if (!announcement) {
    return;
  }
  try {
    await publishDenMembershipChanged({
      action: announcement.action,
      actorId,
      conversationId,
      memberIds: announcement.memberIds,
      membershipSeq: announcement.membershipSeq,
    });
  } catch (error) {
    // The publisher is already best-effort; this is the belt to its braces, for
    // the case where it ever grows a code path that throws. A committed
    // membership change must not be reported to the caller as a failure, because
    // the caller would then retry a mutation that already landed.
    console.error("Failed to announce den membership change:", error);
  }
}

// `withDenClaim` plus the announcement the write decided on, published after the
// commit. One place, so no mutation can forget the after-commit half and start
// announcing from inside its transaction.
async function withDenMembershipChange<T>(
  conversationId: string,
  actorId: string,
  write: (
    tx: PrismaTransaction,
    claimed: ClaimedDen
  ) => Promise<{
    announce: DenAnnouncement | null;
    ended: DenMembershipEnded;
    value: T;
  }>
): Promise<T> {
  const outcome = await withDenClaim(conversationId, write);
  await flushDenAnnouncement(conversationId, actorId, outcome.announce);
  await flushMembershipEndedNotifications(outcome.ended);
  return outcome.value;
}

// Hands the push jobs for the rows a mutation wrote to the worker, once the
// transaction has committed. Same discipline as the announcement above and for
// the same reason: a worker that ran before the commit would look the row up,
// find nothing, and drop the push.
//
// Best-effort per row, and a failure here is logged rather than raised. The
// mutation itself is already durable, and re-running it because a queue was down
// would remove somebody twice.
async function flushMembershipEndedNotifications(
  notifications: DenMembershipEnded
): Promise<void> {
  if (!notifications) {
    return;
  }
  await Promise.all(
    notifications.map(async ({ id, recipientId }) => {
      try {
        await enqueueNotificationCreated(recipientId, id);
      } catch (error) {
        console.error("Failed to enqueue den membership notice:", error);
      }
    })
  );
}

// The roster as a set of user ids, so a mutation can add its departing member
// back to the list without a second query.
function rosterIds(members: readonly { userId: string }[]): string[] {
  return members.map((member) => member.userId);
}

// There is deliberately no block probe anywhere in this file.
//
// A den used to carry one at the create, add and join doors. It does not any more,
// and this is where a future reader comes looking for it: a den is a shared space
// with up to DEN_LIMITS.membersMax members, so "these two must not be in one room"
// is not a question anybody can reason about at that size, and the refusal it
// produced was all-or-nothing - one blocked pair refused the whole request,
// including the innocent ninety-eight who were about to be added alongside them.
// Nobody is vulnerable in a den they are not in, and a blocked member's remedy
// for a den they do not want to be inside is to leave, which is a decision they
// get to make on their own rather than one a third party makes for them.
//
// Blocks remain fully enforced for DMs, which is the rest of this package and the
// web app's conversation gate. `apps/web/src/lib/messages/blocks.ts` is where that
// rule is stated in full and which surfaces cover it.
//
// The proof that none of it came back is `den-service.integration.test.ts` - the
// "blocks do not stop a den" suite - because a missing rule is invisible to every
// other test in this file.

// Stamps the den row so every reader can see that the membership moved, and
// moves the roster-only counter that says how far it has moved.
//
// This is the change signal for a client's cached conversation detail. A den's
// roster is the only input to "may this epoch still be written into", so a client
// holding a roster that has since lost a member sees a complete epoch, no
// departed holder and no newcomer, and sends into the exact epoch the removed
// member still holds. Nothing inside the snapshot can detect that; the row can,
// and `updatedAt` is already the column the claim lock reads, so bumping it costs
// the mutation nothing.
//
// `membershipSeq` is what makes the detection sound rather than best-effort. The
// timestamp alone cannot say whether a client's cached detail is behind because
// the roster moved or because somebody sent a message, and it cannot count
// changes at all, so a receiver that missed one announcement has nothing to
// notice. This moves by exactly one per committed roster change and on nothing
// else, so it is both a gap detector and a duplicate filter. The value it writes
// is the one the claim already read, plus one: the claim has proved this writer
// is alone on the row, so re-reading it would return the same number.
//
// Both columns move together, in the caller's transaction, so a rollback moves
// neither and there is no state in which the timestamp moved and the counter did
// not. Returns the new counter so the announcement can carry it without reading
// the row again.
//
// NOT called by a rename, a description or avatar edit, an invite-code rotation,
// a preferences write, or a send. None of those change who may read this
// conversation, and a counter that moved for them would cost every member a
// detail refetch each time somebody typed.
async function touchDen(
  transaction: PrismaTransaction,
  claimed: ClaimedDen,
  conversationId: string
): Promise<number> {
  const membershipSeq = claimed.membershipSeq + 1;
  await transaction.orm.public.MessageConversations.where((candidate) =>
    candidate.id.eq(conversationId)
  ).updateAndCount({
    membershipSeq,
    updatedAt: toPrismaDateTime(new Date()),
  });
  return membershipSeq;
}

export async function updateDenDetails(
  conversationId: string,
  actorId: string,
  input: {
    avatarMediaId?: string | null;
    description?: string | null;
    name?: string;
  }
): Promise<void> {
  await requireDenManager(conversationId, actorId);
  const patch: Record<string, string | null> = {};
  if (input.name !== undefined) {
    const name = normalizeDenName(input.name);
    const nameError = validateDenName(name);
    if (nameError) {
      throw new DenError("INVALID_INPUT", nameError);
    }
    patch.name = name;
  }
  if (input.description !== undefined) {
    // An explicit null clears the description; an empty string is normalized to
    // null so the two cannot drift into two representations of "no description".
    const description = (input.description ?? "").trim();
    const descriptionError = validateDenDescription(description);
    if (descriptionError) {
      throw new DenError("INVALID_INPUT", descriptionError);
    }
    patch.description = description || null;
  }
  if (input.avatarMediaId !== undefined) {
    patch.avatarMediaId = input.avatarMediaId;
  }
  if (Object.keys(patch).length === 0) {
    return;
  }
  await withDenClaim(conversationId, async (tx) => {
    // Deliberately not touchDen. A rename, a description, an avatar: none of
    // them change who may read or write this den, so the counter stays put and no
    // member's client refetches a roster that did not move. The members route is
    // the only other writer on this table, and it is the one that counts.
    await tx.orm.public.MessageConversations.where((candidate) =>
      candidate.id.eq(conversationId)
    ).updateAndCount(patch);
  });
}

// Returns the ids actually added, so the caller knows who to rotate the epoch
// for and who was already in.
export async function addDenMembers(
  conversationId: string,
  actorId: string,
  userIds: string[]
): Promise<string[]> {
  // Authorization first, before the claim: a plain member must not be able to
  // take the den's row lock at all, let alone write to it.
  await requireDenManager(conversationId, actorId);
  return await withDenMembershipChange(
    conversationId,
    actorId,
    async (tx, claimed) => {
      const existing = await tx.orm.public.MessageConversationMembers.select(
        "userId"
      )
        .where((member) => member.conversationId.eq(conversationId))
        .all();
      const taken = new Set(existing.map((member) => member.userId));
      const room = DEN_LIMITS.membersMax - taken.size;
      if (room <= 0) {
        throw new DenError(
          "LIMIT_REACHED",
          `A den can have at most ${DEN_LIMITS.membersMax} members`
        );
      }
      // Sorted so two callers adding overlapping sets agree on who wins a
      // contested slot, which keeps a partial write reproducible in a log.
      const wanted = [...new Set(userIds)]
        .toSorted()
        .filter((userId) => !taken.has(userId));
      if (wanted.length > room) {
        throw new DenError(
          "LIMIT_REACHED",
          `A den can have at most ${DEN_LIMITS.membersMax} members`
        );
      }
      // No block check, at either end of the write: a den admits regardless of who
      // blocks whom. The rule and its reasoning are stated once above `rosterIds`,
      // and the cap above is the only thing standing between a candidate and the
      // membership row.
      for (const userId of wanted) {
        // oxlint-disable-next-line no-await-in-loop -- ordered writes under the claim lock, see above
        await tx.orm.public.MessageConversationMembers.create({
          conversationId,
          invitedById: actorId,
          role: "MEMBER",
          userId,
        });
      }
      if (wanted.length === 0) {
        // Only a roster that actually moved. Re-adding somebody already inside is
        // a no-op, and a no-op must not look like a membership change to a client
        // watching the row - neither to its timestamp nor to its counter, because
        // a counter that moved on a no-op would make every member's client treat
        // the next real change as a gap.
        return { announce: null, ended: null, value: wanted };
      }
      const membershipSeq = await touchDen(tx, claimed, conversationId);
      return {
        // The newcomers are in `wanted`, so the post-mutation roster is everyone
        // who was already inside plus them. No second read needed.
        announce: {
          action: "member_added",
          memberIds: [...taken, ...wanted],
          membershipSeq,
        },
        ended: null,
        value: wanted,
      };
    }
  );
}

export async function removeDenMember(
  conversationId: string,
  actorId: string,
  targetUserId: string
): Promise<void> {
  if (actorId === targetUserId) {
    throw new DenError("SELF_ACTION", "Use leave to remove yourself");
  }
  // The actor's own role is carried into the transaction rather than re-read:
  // `requireDenManager` has already resolved it, and the question below is
  // `canManageRole(actorRole, targetRole)`.
  const manager = await requireDenManager(conversationId, actorId);
  await withDenMembershipChange(
    conversationId,
    actorId,
    async (tx, claimed) => {
      const members = await tx.orm.public.MessageConversationMembers.select(
        "role",
        "userId"
      )
        .where((member) => member.conversationId.eq(conversationId))
        .all();
      const target = members.find((member) => member.userId === targetUserId);
      if (!target) {
        throw new DenError("NOT_FOUND", "That person is not a member");
      }
      // The shared helper, not a written-out role comparison. This is the same
      // function `den-permissions.ts` draws the panel's remove control from, so the
      // button on screen and the write behind it read one rule: add a role to the
      // table and both move.
      //
      // It also carries the owner rule. A den has exactly one owner and ownership
      // moves by leaving rather than by promotion, so the only actor who could pass
      // `canManageRole(_, "OWNER")` is another owner, and there is never one - which
      // is why the refusal below is reachable and says why.
      if (!canManageRole(manager.role, target.role)) {
        throw new DenError("FORBIDDEN", "The owner cannot be removed");
      }
      await tx.orm.public.MessageConversationMembers.where((member) =>
        and(
          member.conversationId.eq(conversationId),
          member.userId.eq(targetUserId)
        )
      ).deleteAndCount();
      const membershipSeq = await touchDen(tx, claimed, conversationId);
      // The removal is not self-evident offline. The announcement reaches the
      // members with this den open on a stream; a removed member who is not
      // looking learns it only when the den stops opening, which is a worse way to
      // find out than being told. See `den-membership-notifications.ts`.
      const ended = await createDenMembershipEndedNotifications(tx, {
        actorId,
        conversationId,
        reason: "removed",
        recipientIds: [targetUserId],
      });
      return {
        // The removed member is on the list even though their row is gone: their
        // conversation list still shows this den until they refetch, and their open
        // stream has to learn it is no longer allowed to deliver.
        announce: {
          action: "member_removed",
          memberIds: rosterIds(members),
          membershipSeq,
        },
        ended,
        value: undefined,
      };
    }
  );
}

function roleRank(role: DenRole): number {
  if (role === "OWNER") {
    return 0;
  }
  return role === "ADMIN" ? 1 : 2;
}

export interface LeaveDenResult {
  dissolved: boolean;
  newOwnerId: string | null;
}

export async function leaveDen(
  conversationId: string,
  userId: string
): Promise<LeaveDenResult> {
  await requireDenMembership(conversationId, userId);
  // The explicit type argument is what lets the four return literals below be
  // plain literals. Left to infer, the generic settles on the first branch's
  // narrower shape and every later branch is a type error, which is a pressure
  // that ends as `as LeaveDenResult` on each one - four casts hiding that the
  // function's contract is `LeaveDenResult` and could simply have said so.
  return await withDenMembershipChange<LeaveDenResult>(
    conversationId,
    userId,
    async (tx, claimed) => {
      const members = await tx.orm.public.MessageConversationMembers.select(
        "createdAt",
        "role",
        "userId"
      )
        .where((member) => member.conversationId.eq(conversationId))
        .all();
      const me = members.find((member) => member.userId === userId);
      if (!me) {
        throw new DenError("NOT_FOUND", "You are not a member of this den");
      }

      if (members.length === 1) {
        // The last member out dissolves the den. Messages, wraps and read
        // watermarks all hang off this row and are unreachable the moment it goes,
        // so an empty den is not a state worth keeping.
        await tx.orm.public.MessageConversations.where((candidate) =>
          candidate.id.eq(conversationId)
        ).deleteAndCount();
        return {
          // No `membershipSeq`: there is no row left to count, and every receiver
          // treats a dissolve as terminal, so there is nothing a sequence could add.
          announce: { action: "dissolved", memberIds: rosterIds(members) },
          // The only member left is the one walking out, and the actor is filtered
          // out of the recipient list, so this writes nothing. Stated rather than
          // left implicit because it is the one place the two lines above and
          // below read identically.
          ended: null,
          value: { dissolved: true, newOwnerId: null },
        };
      }

      await tx.orm.public.MessageConversationMembers.where((member) =>
        and(member.conversationId.eq(conversationId), member.userId.eq(userId))
      ).deleteAndCount();

      // Everyone who was inside, plus the leaver. The leaver's list has to drop
      // the den, and their open stream has to learn they are out of it.
      const announce = (
        action: DenMembershipAction,
        membershipSeq: number
      ) => ({
        action,
        memberIds: rosterIds(members),
        membershipSeq,
      });

      if (me.role !== "OWNER") {
        const membershipSeq = await touchDen(tx, claimed, conversationId);
        return {
          announce: announce("left", membershipSeq),
          // Nobody left but the person who left, and they know.
          ended: null,
          value: { dissolved: false, newOwnerId: null },
        };
      }

      // Ownership transfers rather than dying with the row: a den whose owner walks
      // away would otherwise be unmanageable by everyone left in it. Longest
      // tenure first, an elder outranking a plain member at equal tenure, so the
      // choice is deterministic and defensible.
      const heirs = members
        .filter((member) => member.userId !== userId)
        .toSorted((left, right) => {
          const tenure = compareTenure(left.createdAt, right.createdAt);
          return tenure === 0
            ? roleRank(left.role) - roleRank(right.role)
            : tenure;
        });
      const [heir] = heirs;
      if (!heir) {
        const membershipSeq = await touchDen(tx, claimed, conversationId);
        return {
          announce: announce("left", membershipSeq),
          ended: null,
          value: { dissolved: false, newOwnerId: null },
        };
      }
      await tx.orm.public.MessageConversationMembers.where((candidate) =>
        and(
          candidate.conversationId.eq(conversationId),
          candidate.userId.eq(heir.userId)
        )
      ).updateAndCount({ role: "OWNER" });
      // The one roster mutation that does not go through `touchDen`: it has to
      // write `ownerId` in the same statement, and a second UPDATE to move the
      // counter would be a second chance for the claim's own guarantee to be
      // wrong. So the counter rides along here, from the same claimed value, and
      // the increment is exactly as transactional as the ownership move.
      const membershipSeq = claimed.membershipSeq + 1;
      await tx.orm.public.MessageConversations.where((candidate) =>
        candidate.id.eq(conversationId)
      ).updateAndCount({
        membershipSeq,
        ownerId: heir.userId,
        updatedAt: toPrismaDateTime(new Date()),
      });
      // One announcement, not two. The owner left AND ownership moved, but a
      // receiver's response is identical either way (re-read the detail), and two
      // announcements would mean two refetches for one membership mutation -
      // and two increments for one change, which would make every later event
      // look like a gap.
      return {
        announce: announce("owner_transferred", membershipSeq),
        ended: null,
        value: { dissolved: false, newOwnerId: heir.userId },
      };
    }
  );
}

// Only ADMIN and MEMBER are assignable. OWNER is refused on purpose: assigning
// a role changes one row, while ownership also has to move the den's `ownerId`,
// so there is no way to hand it over that does not go through
// `transferDenOwnership` and its single transaction. No promote route can mint a
// second owner, and no promote route can leave the two sources of truth
// disagreeing.
//
// The parameter is the full `DenRole` rather than an `Exclude`, so the refusal
// below is reachable rather than shadowed by the type. Narrowing it would make
// the guard dead code that no test can write, and the routes cannot enforce it on
// their own: a body is a runtime value, so `OWNER` really does arrive here.
export async function setDenMemberRole(
  conversationId: string,
  actorId: string,
  targetUserId: string,
  role: DenRole
): Promise<void> {
  if (role !== "ADMIN" && role !== "MEMBER") {
    throw new DenError("INVALID_ROLE", "That role cannot be assigned");
  }
  await requireDenOwner(conversationId, actorId);
  if (actorId === targetUserId) {
    throw new DenError("SELF_ACTION", "You cannot change your own role");
  }
  await withDenMembershipChange(
    conversationId,
    actorId,
    async (tx, claimed) => {
      const members = await tx.orm.public.MessageConversationMembers.select(
        "role",
        "userId"
      )
        .where((member) => member.conversationId.eq(conversationId))
        .all();
      const target = members.find((member) => member.userId === targetUserId);
      if (!target) {
        throw new DenError("NOT_FOUND", "That person is not a member");
      }
      if (target.role === "OWNER") {
        throw new DenError("FORBIDDEN", "The owner's role cannot be changed");
      }
      await tx.orm.public.MessageConversationMembers.where((member) =>
        and(
          member.conversationId.eq(conversationId),
          member.userId.eq(targetUserId)
        )
      ).updateAndCount({ role });
      const membershipSeq = await touchDen(tx, claimed, conversationId);
      return {
        // Nobody joined or left, but a promotion changes who may add and remove
        // members, and every open details panel renders the roster's roles.
        announce: {
          action: "role_changed",
          memberIds: rosterIds(members),
          membershipSeq,
        },
        ended: null,
        value: undefined,
      };
    }
  );
}

// Hands the den to somebody who is already in it. The owner gives up ownership
// and becomes an Elder, which is the same end state `leaveDen` produces for an
// owner who walks out - only this one is chosen on purpose rather than by tenure.
//
// Two rules the rest of this file leans on:
//
//   The target must be a member. A transfer to somebody outside the den would
//   have to mint a membership row and a root wrap in the same breath, and a
//   person who cannot read the den is not somebody to hand it to. NOT_FOUND is
//   the right code because from the owner's point of view the target does not
//   exist as a candidate.
//
//   Exactly one owner at every instant. The three writes below are one
//   transaction under the claim lock, and Postgres commits all three or none, so
//   the only states that exist are the state before and the state after - one
//   owner in both. There is deliberately no intermediate ownerless or
//   two-owner state for anything to catch: a writer that could observe the rows
//   between the writes would have to be inside this transaction, and the only
//   thing inside it is this function.
//
// The actor's ownership is RE-READ under the claim rather than trusted from the
// `requireDenOwner` above it, which is why the re-check below is not defensive
// noise. Two transfers from the same owner can both pass that gate - the second
// waits on the claim rather than being refused - and without this check the
// loser would happily promote a second owner and demote an actor who is already
// an Elder, which is exactly the two-owner state the transaction exists to
// prevent.
export async function transferDenOwnership(
  conversationId: string,
  actorId: string,
  targetUserId: string
): Promise<void> {
  await requireDenOwner(conversationId, actorId);
  // SELF_ACTION rather than a code of its own: the refusal is "this is already
  // true", which is what that code means, and `removeDenMember` and
  // `setDenMemberRole` already answer it the same way.
  if (actorId === targetUserId) {
    throw new DenError("SELF_ACTION", "You already own this den");
  }
  await withDenMembershipChange(
    conversationId,
    actorId,
    async (tx, claimed) => {
      const members = await tx.orm.public.MessageConversationMembers.select(
        "role",
        "userId"
      )
        .where((member) => member.conversationId.eq(conversationId))
        .all();
      if (
        !members.some(
          (member) => member.userId === actorId && member.role === "OWNER"
        )
      ) {
        throw new DenError("FORBIDDEN", "Only the owner can do that");
      }
      const target = members.find((member) => member.userId === targetUserId);
      if (!target) {
        throw new DenError("NOT_FOUND", "That person is not a member");
      }
      // Demotion first, then promotion, then the den row. The order is not what
      // makes the single-owner guarantee true - the transaction is - but it keeps
      // the two role writes adjacent to each other and to the `ownerId` write
      // they have to agree with, so a reader of this function sees one movement
      // rather than three.
      await tx.orm.public.MessageConversationMembers.where((member) =>
        and(member.conversationId.eq(conversationId), member.userId.eq(actorId))
      ).updateAndCount({ role: "ADMIN" });
      await tx.orm.public.MessageConversationMembers.where((member) =>
        and(
          member.conversationId.eq(conversationId),
          member.userId.eq(targetUserId)
        )
      ).updateAndCount({ role: "OWNER" });
      // The one roster mutation that does not go through `touchDen`, for the same
      // reason `leaveDen`'s transfer does not: `ownerId` has to be written in the
      // same statement as the counter, or a rollback of one and a commit of the
      // other would leave two sources of truth disagreeing about who is in charge.
      const membershipSeq = claimed.membershipSeq + 1;
      await tx.orm.public.MessageConversations.where((candidate) =>
        candidate.id.eq(conversationId)
      ).updateAndCount({
        membershipSeq,
        ownerId: targetUserId,
        updatedAt: toPrismaDateTime(new Date()),
      });
      return {
        // One announcement, for the same reason `leaveDen` sends one: a receiver's
        // response to "the owner transferred it" is identical whether the owner
        // left or handed it over, and two announcements would mean two refetches
        // and two increments for one change.
        announce: {
          action: "owner_transferred",
          memberIds: rosterIds(members),
          membershipSeq,
        },
        // Nobody left: both people are still in the den, one of them as its owner
        // and one as an Elder, so nobody is owed a "you are out of this den" notice.
        ended: null,
        value: undefined,
      };
    }
  );
}

export async function rotateInviteCode(
  conversationId: string,
  actorId: string
): Promise<string> {
  await requireDenManager(conversationId, actorId);
  for (let attempt = 1; attempt <= INVITE_CODE_ATTEMPTS; attempt += 1) {
    const inviteCode = generateInviteCode();
    try {
      // oxlint-disable-next-line no-await-in-loop -- bounded retry, same reason as the create loop
      await withDenClaim(conversationId, async (tx) => {
        // Deliberately NOT touchDen: a new code changes the door, never the room.
        // Nobody's read or write access moves, so the counter stays where it is and
        // no member's client refetches a roster that did not change.
        await tx.orm.public.MessageConversations.where((candidate) =>
          candidate.id.eq(conversationId)
        ).updateAndCount({ inviteCode });
      });
      return inviteCode;
    } catch (error) {
      if (isUniqueConstraintViolation(error) || isRetryableConflict(error)) {
        continue;
      }
      throw error;
    }
  }
  throw new DenError("INVALID_INPUT", "Couldn't generate a join code");
}

export async function dissolveDen(
  conversationId: string,
  actorId: string
): Promise<void> {
  await requireDenOwner(conversationId, actorId);
  await withDenMembershipChange(conversationId, actorId, async (tx) => {
    const members = await tx.orm.public.MessageConversationMembers.select(
      "userId"
    )
      .where((member) => member.conversationId.eq(conversationId))
      .all();
    // Written BEFORE the delete, not after. The rows carry no conversation id
    // (a dissolve deletes the row a foreign key would point at, and the cascade
    // would take the notification with it), so the order is not load-bearing
    // today; it is written this way so that a future version which does want to
    // name the den cannot be added after the row it needs to name is gone.
    const ended = await createDenMembershipEndedNotifications(tx, {
      actorId,
      conversationId,
      reason: "dissolved",
      recipientIds: rosterIds(members),
    });
    await tx.orm.public.MessageConversations.where((candidate) =>
      candidate.id.eq(conversationId)
    ).deleteAndCount();
    return {
      // Read inside the transaction because the row it would have been read from
      // is gone by the time this publishes. Their conversation lists still show
      // a den that no longer exists, and their open streams would otherwise keep
      // delivering into a row they can no longer read.
      //
      // No counter either, and deliberately: the row is deleted, so there is no
      // value to publish and no client that could act on one. A receiver reads a
      // dissolve as terminal, which is the whole answer.
      announce: { action: "dissolved", memberIds: rosterIds(members) },
      ended,
      value: undefined,
    };
  });
}

// An invite preview carries only what a join screen needs. It never returns the
// roster, a message, or the member identities: possession of a code must not be
// enough to enumerate who is in a den.
export interface DenInvitePreview {
  id: string;
  inviteCode: string;
  memberCount: number;
  name: string | null;
}

// Normalizes before comparing so a code pasted with surrounding whitespace or in
// the wrong case still resolves. The alphabet is already lowercase, so
// lowercasing is the whole normalization.
function normalizeInviteCode(raw: string): string {
  return raw.trim().toLowerCase();
}

async function findDenByInviteCode(
  inviteCode: string
): Promise<{ id: string } | null> {
  const den = await prisma.orm.public.MessageConversations.select("id")
    .where((candidate) =>
      and(
        candidate._type.eq("DEN"),
        candidate.inviteCode.eq(normalizeInviteCode(inviteCode))
      )
    )
    .first();
  return den ? { id: den.id } : null;
}

export async function previewInvite(
  inviteCode: string
): Promise<DenInvitePreview | null> {
  const den = await findDenByInviteCode(inviteCode);
  if (!den) {
    return null;
  }
  // One read carries everything, so the preview cannot observe a code that was
  // rotated between the lookup and the read below.
  const row = await prisma.orm.public.MessageConversations.select(
    "id",
    "inviteCode",
    "name"
  )
    .where({ id: den.id })
    .first();
  if (!row?.inviteCode) {
    // Dissolved, or the code was rotated out from under this lookup.
    return null;
  }
  const members = await prisma.orm.public.MessageConversationMembers.where(
    (member) => member.conversationId.eq(den.id)
  ).aggregate((aggregate) => ({ count: aggregate.count() }));
  return {
    id: row.id,
    inviteCode: row.inviteCode,
    memberCount: members.count,
    name: row.name,
  };
}

export interface JoinDenResult {
  alreadyMember: boolean;
  id: string;
}

// Joining by code is a self-service add, so it does not go through the manager
// gate that addDenMembers enforces. The one check it does carry is here for a
// concrete reason: an invite link is a public URL and anything the route checked
// outside the transaction can be stale by the time the row is written. It
// re-checks the cap because a hundred people can open one link at once.
//
// It used to re-check blocks here too, and that was the most defensible of the
// three doors it had, because this is the widest door in the product. It is gone
// anyway: the join is not special, and a den that admits a blocked pair through
// a direct add has no standing to refuse the same pair through a link. The
// reasoning behind the removal is stated once above `rosterIds`.
export async function joinDenByInviteCode(
  inviteCode: string,
  userId: string
): Promise<JoinDenResult> {
  const den = await findDenByInviteCode(inviteCode);
  if (!den) {
    throw new DenError("NOT_FOUND", "That join code is not valid");
  }
  const outcome = await withDenMembershipChange(
    den.id,
    userId,
    async (tx, claimed) => {
      const members = await tx.orm.public.MessageConversationMembers.select(
        "userId"
      )
        .where((member) => member.conversationId.eq(den.id))
        .all();
      if (members.some((member) => member.userId === userId)) {
        // Re-opening a link you already joined changes nothing, so nothing is
        // announced: a client would refetch its roster to learn the roster it
        // already has. The counter does not move either, which is the load-bearing
        // half of that: an increment here would leave the next real change looking
        // like a gap and cost every member a refetch for it.
        return { announce: null, ended: null, value: false };
      }
      if (members.length >= DEN_LIMITS.membersMax) {
        throw new DenError(
          "LIMIT_REACHED",
          `This den is full (${DEN_LIMITS.membersMax} members)`
        );
      }
      await tx.orm.public.MessageConversationMembers.create({
        conversationId: den.id,
        role: "MEMBER",
        userId,
      });
      const membershipSeq = await touchDen(tx, claimed, den.id);
      return {
        announce: {
          action: "joined",
          memberIds: [...rosterIds(members), userId],
          membershipSeq,
        },
        ended: null,
        value: true,
      };
    }
  );
  return { alreadyMember: !outcome, id: den.id };
}

// Tenure comparison over Prisma temporal values: chronological, oldest first.
// A function rather than an inline subtraction so the sign convention is stated
// once, and so the same ordering is used for every heir candidate.
function compareTenure(
  left: Parameters<typeof fromPrismaDateTime>[0],
  right: Parameters<typeof fromPrismaDateTime>[0]
): number {
  return (
    fromPrismaDateTime(left).getTime() - fromPrismaDateTime(right).getTime()
  );
}
