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
import type { DenMembershipEventAction, DenRole } from "./dens";

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
  // When this membership stopped being able to act, if it did. Carried so a
  // caller that only wants to know "is this person still in the den" can ask
  // without a second read, and so the refusal in `requireDenMembership` has a
  // name for the state it is refusing.
  //
  // `unknown` rather than `Date`: the ORM hands back a `Temporal.PlainDateTime`,
  // and the only question anybody asks of it here is null or not, which
  // `isCurrentDenMember` answers without a conversion.
  leftAt: unknown;
  role: DenRole;
}

// A durable membership log line, as the transcript reads it.
export interface DenMembershipEvent {
  action: DenMembershipEventAction;
  actorId: string | null;
  actorName: string | null;
  createdAt: Date;
  id: string;
  targetName: string | null;
  targetUserId: string | null;
}

// The den's membership log, oldest first.
//
// `visibleUntil` is the reader's own `leftAt`, or null while they are still in the
// den. Somebody who left sees the room as it was the moment they did: the log
// stops at their departure, because everything after it is about a room they are
// no longer in. Filtering in JS rather than in the query is deliberate - a den's
// log is bounded by membership churn (tens of rows, not thousands), and a
// conditional predicate on the typed builder is harder to read than the one line
// it would save.
export async function listDenMembershipEvents(
  conversationId: string,
  visibleUntil: Date | null
): Promise<DenMembershipEvent[]> {
  const rows =
    await prisma.orm.public.MessageConversationMembershipEvents.select(
      "action",
      "actorId",
      "actorName",
      "createdAt",
      "id",
      "targetName",
      "targetUserId"
    )
      .where((event) => event.conversationId.eq(conversationId))
      .orderBy((event) => event.createdAt.asc())
      .all();
  return rows
    .map((row) => ({
      action: row.action,
      actorId: row.actorId,
      actorName: row.actorName,
      createdAt: fromPrismaDateTime(row.createdAt),
      id: row.id,
      targetName: row.targetName,
      targetUserId: row.targetUserId,
    }))
    .filter(
      (event) => visibleUntil === null || event.createdAt <= visibleUntil
    );
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
      // One line for the birth of the den, naming the creator. Not a JOINED line
      // per initial member: the den is born with them, and a dozen "joined" lines
      // stacked at the top of a new den's transcript is noise, not history.
      const names = await denEventNames(tx, [params.creatorId]);
      await recordDenMembershipEvent(tx, {
        action: "CREATED",
        actorId: params.creatorId,
        actorName: names.get(params.creatorId) ?? null,
        conversationId: den.id,
      });
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
    "leftAt",
    "role"
  )
    .where((candidate) =>
      and(
        candidate.conversationId.eq(conversationId),
        candidate.userId.eq(userId)
      )
    )
    .first();
  return member ? { leftAt: member.leftAt, role: member.role } : null;
}

// The members who can still act in the den: everybody whose `leftAt` is NULL.
//
// A `leftAt` row is kept so the person keeps their history and the den stays in
// their list, and it is excluded from every write: no posting, no promotion, no
// election, no cap count, and never in the audience for a key wrap. Only the read
// path wants them.
//
// Two spellings, because there are two shapes of question. A `where` takes
// `member.leftAt.isNull()` inline, the way every other filter in this file reads.
// A read that has already happened asks the boolean below, so a roster loaded for
// a reason other than filtering still has to decide rather than silently include
// whoever walked out.
export function isCurrentDenMember(member: { leftAt: unknown }): boolean {
  return member.leftAt === null;
}

// Membership, and DM-aware. A DM row carries MEMBER too, so the type check is what
// stops a management route from being pointed at somebody's private thread and
// finding a plausible-looking member row there.
//
// "Membership" means a row that can still act. Somebody who left keeps their row
// so they keep their history, and every write funnels through here, so this is the
// single place that turns "has a row" into "may act". The refusal is the same one
// a non-member gets: somebody who left is not on the roster, and a message that
// said otherwise would tell them the den still has them in it.
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
  if (!membership || !isCurrentDenMember(membership)) {
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
// back to the list without a second query. Every row, including the departed:
// this is the full table, for the callers that need all of it.
function rosterIds(members: readonly { userId: string }[]): string[] {
  return members.map((member) => member.userId);
}

// Who a roster announcement may reach.
//
// The people still in the den, plus whoever the mutation is about. The departed are
// excluded from the general audience because an announcement arrives as a
// "re-read your list" frame on a conversation they are no longer in, and a roster
// move they are not party to is not something to ping them about.
//
// The mutation's own subject is named explicitly rather than left to the read
// order. `leaveDen` and `removeDenMember` both stamp `leftAt` before building the
// audience, so the array in hand still says `leftAt: null` for the person walking
// out - which is the correct answer by accident, and an accident is not a contract.
// They are the one person who must hear it: their open tab is what has to learn it
// can no longer deliver, and their list is what has to learn the den is now
// read-only.
function announceAudienceIds(
  members: readonly { leftAt: unknown; userId: string }[],
  subject: readonly string[] = []
): string[] {
  const audience = new Set([
    ...members
      .filter((member) => isCurrentDenMember(member))
      .map((m) => m.userId),
    ...subject,
  ]);
  return [...audience];
}

// The durable log line for a roster mutation.
//
// Written INSIDE the caller's transaction, so the line and the change it describes
// commit together: a retry that loses its race writes neither, and a committed
// change always has its line. A line written after the commit would be the one
// thing in this file that can lie.
//
// Names are passed in rather than looked up here, because the caller already knows
// who it is acting on and a second read is a second thing to keep in step. The
// snapshots exist because the live roster will not hold them later: the person who
// left is not a member any more, and deleting their account must not erase the line.
async function recordDenMembershipEvent(
  tx: PrismaTransaction,
  event: {
    action: DenMembershipEventAction;
    actorId: string | null;
    actorName: string | null;
    conversationId: string;
    targetId?: string | null;
    targetName?: string | null;
  }
): Promise<void> {
  await tx.orm.public.MessageConversationMembershipEvents.create({
    action: event.action,
    actorId: event.actorId,
    actorName: event.actorName,
    conversationId: event.conversationId,
    targetName: event.targetName ?? null,
    targetUserId: event.targetId ?? null,
  });
}

// Display names for the ids a mutation is about, read in the caller's transaction.
// One query for the whole set, so adding or removing a hundred people costs one
// read rather than a hundred.
async function denEventNames(
  tx: PrismaTransaction,
  userIds: readonly string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await tx.orm.public.Users.select("displayName", "id")
    .where((user) => user.id.in(unique))
    .all();
  return new Map(rows.map((row) => [row.id, row.displayName]));
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
        "leftAt",
        "userId"
      )
        .where((member) => member.conversationId.eq(conversationId))
        .all();
      // The cap counts the people who can act, not the rows. A roster that
      // accumulated departed members would fill itself up with history and refuse
      // new arrivals, which is backwards: the rows are cheap and the cap is about
      // how much noise a live den can have.
      const inside = existing.filter((member) => isCurrentDenMember(member));
      const room = DEN_LIMITS.membersMax - inside.length;
      if (room <= 0) {
        throw new DenError(
          "LIMIT_REACHED",
          `A den can have at most ${DEN_LIMITS.membersMax} members`
        );
      }
      // Every id already on the row, inside or out. Somebody who left still holds a
      // row, so putting them back is a revival rather than an insert, and the two
      // have to be told apart: a plain create would collide with their primary key.
      // Which is also why the filter is on the members who are still inside rather
      // than on everybody holding a row - a departed member has to be able to come
      // back onto a roster that still remembers them.
      const insideIds = new Set(inside.map((member) => member.userId));
      const stale = new Set(
        existing
          .filter((member) => !isCurrentDenMember(member))
          .map((member) => member.userId)
      );
      // Sorted so two callers adding overlapping sets agree on who wins a
      // contested slot, which keeps a partial write reproducible in a log.
      const wanted = [...new Set(userIds)]
        .toSorted()
        .filter((userId) => !insideIds.has(userId));
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
        if (stale.has(userId)) {
          // Back in, as a plain member: a revived row keeps its place in the
          // den's history - their old messages, and their old keys - so it must
          // not come back carrying a rank they held before they left, and the
          // person who put them back is recorded as whoever added them this time.
          // oxlint-disable-next-line no-await-in-loop -- ordered writes under the claim lock, see above
          await tx.orm.public.MessageConversationMembers.where((member) =>
            and(
              member.conversationId.eq(conversationId),
              member.userId.eq(userId)
            )
          ).updateAndCount({
            invitedById: actorId,
            leftAt: null,
            role: "MEMBER",
          });
          continue;
        }
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
      // One line per person added, written after the rows are in place and before
      // the counter moves, so the log and the roster agree. A revival is a join
      // like any other: the room is seeing them arrive again, and which of the two
      // paths the write took is not a distinction the transcript should draw.
      const names = await denEventNames(tx, [actorId, ...wanted]);
      const actorName = names.get(actorId) ?? null;
      for (const userId of wanted) {
        // oxlint-disable-next-line no-await-in-loop -- one line per person under the same claim
        await recordDenMembershipEvent(tx, {
          action: "JOINED",
          actorId,
          actorName,
          conversationId,
          targetId: userId,
          targetName: names.get(userId) ?? null,
        });
      }
      const membershipSeq = await touchDen(tx, claimed, conversationId);
      return {
        // The inside roster plus the newcomers, which is the whole post-mutation
        // roster. Deliberately built from `inside` rather than `taken`: somebody who
        // left this den and is not being put back has no interest in a roster move
        // they are no longer party to, and an announcement reaches them as a
        // "re-read your list" frame on a den they cannot act in.
        announce: {
          action: "member_added",
          memberIds: [...inside.map((member) => member.userId), ...wanted],
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
        "leftAt",
        "role",
        "userId"
      )
        .where((member) => member.conversationId.eq(conversationId))
        .all();
      const target = members.find((member) => member.userId === targetUserId);
      // Somebody already out is not a member to remove. `requireDenManager` above
      // has proved the actor is in, but the target has not been looked up by that
      // gate, and removing twice would write a second `leftAt` and announce a
      // second roster change the roster has already had.
      if (!target || !isCurrentDenMember(target)) {
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
      // Stamped, not deleted. The row is what keeps the den in their message list
      // and their keys readable, so removal ends their access to everything from
      // now on and leaves everything up to this moment exactly as it was. The
      // stamped row is `leftAt` non-null from here on, which is what every write
      // gate and every key fan-out filters on.
      await tx.orm.public.MessageConversationMembers.where((member) =>
        and(
          member.conversationId.eq(conversationId),
          member.userId.eq(targetUserId)
        )
      ).updateAndCount({
        leftAt: toPrismaDateTime(new Date()),
        role: "MEMBER",
      });
      // "Ada removed Bob". The actor is named from a snapshot too: the manager may
      // leave later, and the line should still say who did this.
      const names = await denEventNames(tx, [actorId, targetUserId]);
      await recordDenMembershipEvent(tx, {
        action: "REMOVED",
        actorId,
        actorName: names.get(actorId) ?? null,
        conversationId,
        targetId: targetUserId,
        targetName: names.get(targetUserId) ?? null,
      });
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
        // The removed member is on the list even though their row is stamped: their
        // conversation list still shows this den until they refetch, and their open
        // stream has to learn it is no longer allowed to deliver.
        announce: {
          action: "member_removed",
          memberIds: announceAudienceIds(members, [targetUserId]),
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
  // Null unless this person was the owner and the den passed to somebody. It is
  // the caller's own successor, so returning it tells them nothing about the rest
  // of the roster.
  //
  // There is deliberately no `dissolved` any more. The last member out used to
  // dissolve the den, and now does not - see the branch in `leaveDen` - so the
  // flag would only ever be `false` and a client branching on it would be a
  // branch that can never be taken.
  newOwnerId: string | null;
}

export async function leaveDen(
  conversationId: string,
  userId: string
): Promise<LeaveDenResult> {
  await requireDenMembership(conversationId, userId);
  // The explicit type argument is what lets the three return literals below be
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
        "leftAt",
        "role",
        "userId"
      )
        .where((member) => member.conversationId.eq(conversationId))
        .all();
      const me = members.find((member) => member.userId === userId);
      if (!me) {
        throw new DenError("NOT_FOUND", "You are not a member of this den");
      }

      // The last member out used to dissolve the den, and no longer does. A den
      // whose only member walks away has nowhere left to send a message, but the
      // person who walked away keeps this den in their list and keeps every
      // message in it, and dissolving would take both. That history is the product:
      // somebody who loses interest in a room still has the right to read what
      // happened there. So the den stays, holding its messages and its wraps, with
      // everybody who is left on it stamped `leftAt` and nobody who can write.
      //
      // Dissolving is still available, and it is the owner's own control: the last
      // member holding the den is, by the heir rule below, the one who took it
      // over, so a den can always be deleted by somebody who can still act on it.
      const inside = members.filter((member) => isCurrentDenMember(member));

      // Stamped, not deleted, for the same reason `removeDenMember` stamps. The row
      // is the den's continued existence in this person's list and the thing that
      // still holds the keys their history needs.
      await tx.orm.public.MessageConversationMembers.where((member) =>
        and(member.conversationId.eq(conversationId), member.userId.eq(userId))
      ).updateAndCount({
        leftAt: toPrismaDateTime(new Date()),
        role: "MEMBER",
      });
      // "Ada left the den". Recorded before the ownership branch so the leaver's
      // own line exists whether or not they were the owner; the handover, when
      // there is one, gets its own line below.
      const names = await denEventNames(tx, [userId]);
      await recordDenMembershipEvent(tx, {
        action: "LEFT",
        actorId: userId,
        actorName: names.get(userId) ?? null,
        conversationId,
        targetId: userId,
        targetName: names.get(userId) ?? null,
      });

      // Everyone who was inside, plus the leaver. The leaver's list keeps this den,
      // but their open stream has to learn they are out of it, which is what
      // `membership-ended` on their stream is for.
      const announce = (
        action: DenMembershipAction,
        membershipSeq: number
      ) => ({
        action,
        memberIds: announceAudienceIds(members, [userId]),
        membershipSeq,
      });

      if (inside.length === 1) {
        // The only one still inside is the person walking out. Nobody is left to
        // announce anything to, and there is no heir to promote, so this is the
        // whole change: the den is now read-only to everybody who was ever in it.
        const membershipSeq = await touchDen(tx, claimed, conversationId);
        return {
          announce: announce("left", membershipSeq),
          ended: null,
          value: { newOwnerId: null },
        };
      }

      if (me.role !== "OWNER") {
        const membershipSeq = await touchDen(tx, claimed, conversationId);
        return {
          announce: announce("left", membershipSeq),
          // Nobody left but the person who left, and they know.
          ended: null,
          value: { newOwnerId: null },
        };
      }

      // Ownership transfers rather than dying with the row: a den whose owner walks
      // away would otherwise be unmanageable by everyone left in it. Longest
      // tenure first, an elder outranking a plain member at equal tenure, so the
      // choice is deterministic and defensible.
      //
      // `leftAt` decides who is eligible, and it is not decoration here: a member
      // who left has a longer tenure than anybody who is still in, so electing
      // across the whole roster would hand every den to whoever walked out first.
      const heirs = inside
        .filter((member) => member.userId !== userId)
        .toSorted((left, right) => {
          const tenure = compareTenure(left.createdAt, right.createdAt);
          return tenure === 0
            ? roleRank(left.role) - roleRank(right.role)
            : tenure;
        });
      const [heir] = heirs;
      if (!heir) {
        // Unreachable while the `inside.length === 1` branch above exists: getting
        // here means the owner is inside and somebody else is too. Kept because the
        // cost of being wrong is a den with no owner, and the cost of keeping it is
        // one branch that no test can exercise - which is the better trade.
        const membershipSeq = await touchDen(tx, claimed, conversationId);
        return {
          announce: announce("left", membershipSeq),
          ended: null,
          value: { newOwnerId: null },
        };
      }
      await tx.orm.public.MessageConversationMembers.where((candidate) =>
        and(
          candidate.conversationId.eq(conversationId),
          candidate.userId.eq(heir.userId)
        )
      ).updateAndCount({ role: "OWNER" });
      const heirNameMap = await denEventNames(tx, [heir.userId]);
      const heirName = heirNameMap.get(heir.userId) ?? null;
      await recordDenMembershipEvent(tx, {
        action: "OWNER_TRANSFERRED",
        actorId: userId,
        actorName: names.get(userId) ?? null,
        conversationId,
        targetId: heir.userId,
        targetName: heirName,
      });
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
        value: { newOwnerId: heir.userId },
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
        "leftAt",
        "role",
        "userId"
      )
        .where((member) => member.conversationId.eq(conversationId))
        .all();
      const target = members.find((member) => member.userId === targetUserId);
      // Same refusal as removal: somebody who already left is not on the roster, so
      // there is nobody here to promote. Stamping their role instead of refusing
      // would be writing to a row the rest of the den has already stopped reading.
      if (!target || !isCurrentDenMember(target)) {
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
      // One line, naming both ends: "Ada made Bob an Elder" for a promotion,
      // "Ada removed Bob as Elder" for a demotion. The action is derived from the
      // role the row now holds rather than from a second argument, so the line
      // cannot disagree with the row.
      const names = await denEventNames(tx, [actorId, targetUserId]);
      await recordDenMembershipEvent(tx, {
        action: role === "ADMIN" ? "PROMOTED" : "DEMOTED",
        actorId,
        actorName: names.get(actorId) ?? null,
        conversationId,
        targetId: targetUserId,
        targetName: names.get(targetUserId) ?? null,
      });
      const membershipSeq = await touchDen(tx, claimed, conversationId);
      return {
        // Nobody joined or left, but a promotion changes who may add and remove
        // members, and every open details panel renders the roster's roles.
        announce: {
          action: "role_changed",
          memberIds: announceAudienceIds(members),
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
        "leftAt",
        "role",
        "userId"
      )
        .where((member) => member.conversationId.eq(conversationId))
        .all();
      if (
        !members.some(
          (member) =>
            member.userId === actorId &&
            member.role === "OWNER" &&
            isCurrentDenMember(member)
        )
      ) {
        throw new DenError("FORBIDDEN", "Only the owner can do that");
      }
      const target = members.find((member) => member.userId === targetUserId);
      // NOT_FOUND rather than a refusal about leaving: the transfer route's own
      // error for "that person is not in this den", and it is the same thing. A
      // member who left cannot be handed the den, and the reason that matters is
      // not politeness - it is that a den owned by somebody who cannot act on it
      // has no one who can add anybody, rename it, or delete it.
      if (!target || !isCurrentDenMember(target)) {
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
      // "Ada handed the den to Bob". Both names snapshotted, because a later
      // transfer or a departure must not rewrite who this line was about.
      const names = await denEventNames(tx, [actorId, targetUserId]);
      await recordDenMembershipEvent(tx, {
        action: "OWNER_TRANSFERRED",
        actorId,
        actorName: names.get(actorId) ?? null,
        conversationId,
        targetId: targetUserId,
        targetName: names.get(targetUserId) ?? null,
      });
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
          memberIds: announceAudienceIds(members),
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

// Writes the outgoing code to the archive, in the caller's transaction.
//
// DO NOTHING on conflict, which is the whole reason this is an upsert rather than a
// create. The two unique indexes involved live in two different tables, so a code
// can in principle be archived AND be some other den's live code; a plain insert
// would raise 23505, the rotation's retry loop would try a fresh code, archive the
// same offending value again, and after its five attempts report "Couldn't generate
// a join code" - a rotation refused over a bookkeeping detail, with the den left on
// the code the manager was trying to retire.
//
// Keeping the FIRST archive rather than overwriting it is the other half. The row
// records which den a stale link should send somebody to, and a stale link is
// already sitting in somebody's chat history pointing at the den that retired the
// code. Rewriting the row would re-point every one of those links at a den that has
// never had that code in front of it, which is worse than leaving them where they
// were.
async function archiveRetiredInviteCode(
  transaction: PrismaTransaction,
  conversationId: string,
  code: string
): Promise<void> {
  await transaction.orm.public.MessageConversationInviteCodes.upsert({
    conflictOn: { code },
    create: { code, conversationId, retiredAt: toPrismaDateTime(new Date()) },
    update: {},
  });
}

// Keeps the den's most recent `DEN_LIMITS.retiredInviteCodeMax` archived codes and
// drops the rest, inside the caller's transaction and immediately after the rotation
// that pushed it over.
//
// Retention is bounded rather than unbounded on purpose: every row here is a
// twelve-character secret that granted nothing the moment it was rotated, so an
// archive with no prune is a slow-motion leak whose size tracks how often somebody
// pressed a button. See `DEN_LIMITS.retiredInviteCodeMax` for the number.
//
// Ordered with the code as the tiebreak rather than the timestamp alone: two
// rotations inside one millisecond produce two rows with equal `retiredAt`, and
// without a total order the prune would pick between them arbitrarily - so the same
// input could keep a different row on every run, and "keeps the newest N" would be
// a statement about intent rather than about the table.
//
// `liveCode` is passed in and skipped explicitly, even though the den's current code
// is by construction absent from this table. This is the one writer that deletes
// rows by value while a new live code has just been installed next to it, and
// "keep the newest N" is not by itself an argument that the newest N excludes the
// live code - the guard is what makes that an assertion rather than an assumption.
async function pruneRetiredInviteCodes(
  transaction: PrismaTransaction,
  conversationId: string,
  liveCode: string
): Promise<void> {
  const archived =
    await transaction.orm.public.MessageConversationInviteCodes.select(
      "code",
      "retiredAt"
    )
      .where((row) => row.conversationId.eq(conversationId))
      .all();
  if (archived.length <= DEN_LIMITS.retiredInviteCodeMax) {
    return;
  }
  const newestFirst = archived.toSorted((left, right) => {
    const byTime =
      fromPrismaDateTime(right.retiredAt).getTime() -
      fromPrismaDateTime(left.retiredAt).getTime();
    if (byTime !== 0) {
      return byTime;
    }
    return left.code.localeCompare(right.code);
  });
  for (const row of newestFirst.slice(DEN_LIMITS.retiredInviteCodeMax)) {
    if (row.code === liveCode) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- at most one row past the window, under the claim lock
    await transaction.orm.public.MessageConversationInviteCodes.where(
      (candidate) => candidate.code.eq(row.code)
    ).deleteAndCount();
  }
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
        //
        // The outgoing code is read INSIDE the claim rather than before it, because
        // the claim holds the den's row lock to commit. That lock is what makes it
        // safe to archive the value read here: no other rotation can replace the
        // code between this read and the archive write below, so the row written
        // always describes the code this transaction is actually retiring.
        const current = await tx.orm.public.MessageConversations.select(
          "inviteCode"
        )
          .where({ id: conversationId })
          .first();
        if (!current) {
          // Deleted between `requireDenManager` above and the claim. The writes below
          // would target a missing row anyway, and the foreign key would refuse the
          // archive, so failing here names the real cause.
          throw new DenError("NOT_FOUND", "Den not found");
        }
        const outgoing = current.inviteCode;
        // ONE transaction for the archive and the replacement, and that is the
        // load-bearing property rather than a tidiness choice. Without it a rotation
        // could commit with the archive write lost, and the den would be left exactly
        // where it started: a code that no longer opens anything, with no record that
        // it ever did, so a stale link reads as a link that never existed and the
        // reader is told nothing at all. Rolling the rotation back when the archive
        // write fails is the other half of the same argument and is deliberate: a
        // rotation that could not explain itself is worse than a rotation that did
        // not happen, because a manager who sees a refusal retries, and one who sees
        // a success has been told the old link is dead for a reason.
        if (outgoing) {
          await archiveRetiredInviteCode(tx, conversationId, outgoing);
        }
        await tx.orm.public.MessageConversations.where((candidate) =>
          candidate.id.eq(conversationId)
        ).updateAndCount({ inviteCode });
        await pruneRetiredInviteCodes(tx, conversationId, inviteCode);
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
  // True when the code has been rotated away and the den named here is only what
  // it used to open. The join route refuses an expired code exactly as it refuses
  // an unknown one, so this flag is a presentation decision and never a door: it
  // changes what the screen says, not what anybody may do.
  expired: boolean;
  id: string;
  inviteCode: string;
  memberCount: number;
  name: string | null;
  // Who owns the den, which is the only person who can mint a replacement code.
  // Read from the LIVE conversation row rather than snapshotted at rotation, so a
  // transfer or a deleted account is reflected immediately rather than whenever
  // somebody next rotated. Null when the den's owner account is gone, which the
  // join screen answers by degrading to the unknown state.
  ownerId: string | null;
}

// Normalizes before comparing so a code pasted with surrounding whitespace or in
// the wrong case still resolves. The alphabet is already lowercase, so
// lowercasing is the whole normalization.
function normalizeInviteCode(raw: string): string {
  return raw.trim().toLowerCase();
}

// The live column ONLY, and deliberately: this is the join door's own lookup, and
// a code that has been rotated must not resolve through it. The archive is read by
// `findRetiredDen` and by nothing that admits anybody.
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

// The den a rotated-away code used to open, or null when this archive holds no
// such code - which is every code that never existed, every code older than the
// den's retention window, and every code whose den has since been dissolved (the
// foreign key cascades those away with the conversation).
//
// Best-effort by design, and the catch is the point rather than a shrug: this read
// is an enhancement on top of a lookup that already failed, so a broken or missing
// archive must not turn somebody's join screen into a 500. The safe answer to "we
// cannot tell whether this code was retired" is the same answer as "we can tell and
// it was not" - the unknown state, which tells the reader nothing they could have
// learned by guessing. The alternative, propagating, would make an infrastructure
// fault on a read-only helper indistinguishable from an outage of the join screen
// itself, for a screen whose whole job is to stay readable.
//
// It is also the reason the UNKNOWN case below must stay indistinguishable from a
// code that never existed: this function returning null for any of three different
// reasons is exactly what makes the join screen honest, and widening it later is
// what would turn it into a validity oracle.
async function findRetiredDen(
  inviteCode: string
): Promise<{ conversationId: string } | null> {
  try {
    const row = await prisma.orm.public.MessageConversationInviteCodes.select(
      "conversationId"
    )
      .where({ code: normalizeInviteCode(inviteCode) })
      .first();
    return row ? { conversationId: row.conversationId } : null;
  } catch (error) {
    console.error("Failed to read retired den invite codes:", error);
    return null;
  }
}

// How many people can act in the den, which is what every member count in the
// product means. The departed are excluded: a count that included them would grow
// every time somebody lost interest, and the invite preview would announce a den as
// fuller than it is.
async function countDenMembers(conversationId: string): Promise<number> {
  const members = await prisma.orm.public.MessageConversationMembers.where(
    (member) =>
      and(member.conversationId.eq(conversationId), member.leftAt.isNull())
  ).aggregate((aggregate) => ({ count: aggregate.count() }));
  return members.count;
}

// The preview for a code that has already been rotated away.
//
// PRIVACY, and the whole reason this function exists in this shape: returning the
// den's owner to somebody holding a retired code is acceptable because the only way
// to hold one is to have been given it, and the person who gave it either was that
// den's owner or was already in it. So the reader is somebody the den was already
// named to. A live code hands them the den's id, name and size; a retired one adds
// exactly one fact, the owner, and it is the minimum that makes the screen
// actionable - there is no point telling somebody a den exists if there is nobody
// they could ask about it.
//
// What it deliberately does NOT add, and what any future change here has to argue
// for from scratch: the roster (possession of a code is not a reason to enumerate
// who is in a den, live code or dead), who joined when, a message count, the
// den's description or avatar, and the identity of whoever rotated the code. Any of
// those turns a "go ask the owner" screen into a history of a room people have
// since left, and a holder of an old link is not somebody who should get one.
//
// The UNKNOWN outcome is untouched and stays indistinguishable from a code that
// never existed, which is what keeps this table from being a validity oracle: a
// caller cannot tell a code that was rotated on a den that still exists from one
// that was never issued, and the one difference - an expired preview - is only ever
// available to somebody who already holds a code this den minted.
async function previewRetiredInvite(
  inviteCode: string
): Promise<DenInvitePreview | null> {
  const retired = await findRetiredDen(inviteCode);
  if (!retired) {
    return null;
  }
  const row = await prisma.orm.public.MessageConversations.select(
    "_type",
    "id",
    "name",
    "ownerId"
  )
    .where({ id: retired.conversationId })
    .first();
  // A row here whose conversation is gone, or is not a den, is a den that was
  // dissolved between the archive read and this one. It answers as unknown, not as
  // a screen naming a room and an owner that are not there: the foreign key cascades
  // the archive row away with the conversation, so this is only reachable inside the
  // gap between two reads, and "we cannot find that den" is the true answer to it.
  if (!row || row._type !== "DEN") {
    return null;
  }
  return {
    expired: true,
    id: row.id,
    inviteCode: normalizeInviteCode(inviteCode),
    memberCount: await countDenMembers(row.id),
    name: row.name,
    ownerId: row.ownerId,
  };
}

export async function previewInvite(
  inviteCode: string
): Promise<DenInvitePreview | null> {
  const den = await findDenByInviteCode(inviteCode);
  if (!den) {
    // Current first, then history, then unknown - and that order is the answer to
    // "what if a code is live on one den and archived from another". It cannot arise
    // from any code path here (a rotation archives only the code it is replacing,
    // and the code space is 31^12), but the two unique indexes live in two different
    // tables so nothing in the schema forbids it. Live wins because it is the state
    // that grants access: a reader holding such a code is somebody the live den
    // admitted an instant ago, and answering them with another den's owner would
    // point them at the wrong person for a code that demonstrably works.
    return await previewRetiredInvite(inviteCode);
  }
  // One read carries everything, so the preview cannot observe a code that was
  // rotated between the lookup and the read below.
  const row = await prisma.orm.public.MessageConversations.select(
    "id",
    "inviteCode",
    "name",
    "ownerId"
  )
    .where({ id: den.id })
    .first();
  if (!row?.inviteCode) {
    // Dissolved, or the code was rotated out from under this lookup. The archive is
    // NOT consulted here: a rotation that commits between the two reads is the one
    // case where the caller genuinely does not know, and answering unknown is the
    // same thing the reader would have got a moment earlier.
    return null;
  }
  return {
    expired: false,
    id: row.id,
    inviteCode: row.inviteCode,
    memberCount: await countDenMembers(row.id),
    name: row.name,
    ownerId: row.ownerId,
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
  // `findDenByInviteCode` and NOT the three-way lookup the preview uses. This is
  // the door, and a retired code has to stay shut: the archive exists so a stale
  // link can be attributed to a den, never so it can be replayed into it. A code
  // that resolves here gets a membership row, and nothing in this table is allowed
  // to be the thing that produced one.
  //
  // The refusal is therefore byte-identical to the one a code that never existed
  // gets - same error code, same message, same 404 - so a caller cannot tell from a
  // refused join whether the code was rotated, pruned, or never issued. The expired
  // screen is told by the preview instead, which the client has already fetched and
  // which only answers somebody already holding a code this den minted.
  const den = await findDenByInviteCode(inviteCode);
  if (!den) {
    throw new DenError("NOT_FOUND", "That join code is not valid");
  }
  const outcome = await withDenMembershipChange(
    den.id,
    userId,
    async (tx, claimed) => {
      const members = await tx.orm.public.MessageConversationMembers.select(
        "leftAt",
        "userId"
      )
        .where((member) => member.conversationId.eq(den.id))
        .all();
      const inside = members.filter((member) => isCurrentDenMember(member));
      const mine = members.find((member) => member.userId === userId);
      if (mine && isCurrentDenMember(mine)) {
        // Re-opening a link you already joined changes nothing, so nothing is
        // announced: a client would refetch its roster to learn the roster it
        // already has. The counter does not move either, which is the load-bearing
        // half of that: an increment here would leave the next real change looking
        // like a gap and cost every member a refetch for it.
        return { announce: null, ended: null, value: false };
      }
      if (inside.length >= DEN_LIMITS.membersMax) {
        throw new DenError(
          "LIMIT_REACHED",
          `This den is full (${DEN_LIMITS.membersMax} members)`
        );
      }
      // A row of their own is not the same as being in the den: somebody who left
      // and then opens the same link again is coming back, not colliding with their
      // own primary key. Their history is already here, so the row is cleared rather
      // than replaced - which also keeps the key wraps they were given still
      // meaning something.
      await tx.orm.public.MessageConversationMembers.where((member) =>
        and(member.conversationId.eq(den.id), member.userId.eq(userId))
      ).upsert({
        conflictOn: { conversationId: den.id, userId },
        create: { conversationId: den.id, role: "MEMBER", userId },
        update: { leftAt: null, role: "MEMBER" },
      });
      // A join through a link has no single author, so actor and subject are the
      // same person. The line reads "Ada joined the den", which is what happened.
      const names = await denEventNames(tx, [userId]);
      await recordDenMembershipEvent(tx, {
        action: "JOINED",
        actorId: userId,
        actorName: names.get(userId) ?? null,
        conversationId: den.id,
        targetId: userId,
        targetName: names.get(userId) ?? null,
      });
      const membershipSeq = await touchDen(tx, claimed, den.id);
      return {
        announce: {
          // The inside roster plus the person coming back. Not the whole table: the
          // departed members are not party to this one.
          action: "joined",
          memberIds: [...inside.map((member) => member.userId), userId],
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
