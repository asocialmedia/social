import {
  and,
  consumeRateLimit,
  createDenMessageNotifications,
  fromPrismaDateTime,
  getMessageDataQuery,
  prisma,
  publishMessageActivity,
  publishMessageCreated,
  toPrismaDateTime,
  unreadMessageCache,
  visibleToUser,
} from "@asm/db";
import type { PrismaTransaction } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { blockedSendPeer } from "@/lib/messages/blocks";
import {
  DEN_MESSAGE_SEND_HOUR_RATE_LIMIT,
  DEN_MESSAGE_SEND_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";
import { MAX_MESSAGE_CIPHERTEXT_LENGTH } from "@/lib/messages/edit-window";
import {
  areBlocked,
  getConversationForUser,
  isUniqueConstraintViolation,
  nextRatchetIndex,
  parseJsonBody,
} from "@/lib/messages/server";
import type { MessageData, MessagePage } from "@/lib/messages/types";
import {
  flushNotificationEvents,
  newNotificationEvents,
  resetNotificationEvents,
} from "@/lib/notifications/deferred-events";

const PAGE_SIZE = 30;
// Upper bound for one page. History indexing (in-conversation search walks the
// whole thread through this endpoint) asks for larger pages so a long thread
// costs tens of round trips instead of hundreds; the cap keeps any single
// response bounded.
const MAX_PAGE_SIZE = 100;
// A declared history walk may ask for much larger pages. Covering a conversation
// is latency-bound, not compute-bound: measured at 200k messages, 100 rows/page
// takes 11.1 minutes of which 4.9 seconds is actual work, and 500 rows/page cuts
// it to 2.3 minutes. The walk is paced per REQUEST, so a bigger page is strictly
// less load on the server for the same politeness, not more. Ordinary transcript
// reads stay at MAX_PAGE_SIZE so a scroll can never pull a large page.
const MAX_HISTORY_WALK_PAGE_SIZE = 500;

// History-walk budgets.
//
// Two separate limits, because they defend against different things:
//
// - A history walk (`?walk=1`) is a client bulk-indexing whole conversations for
//   search. It is paced on the client and resumable, but a client that lies about
//   its intent, a buggy retry loop, or several tabs walking at once would still
//   put sustained load on one conversation's key range. This is the tight budget.
// - Every cursor page is metered too, more loosely. The walk flag is
//   client-supplied, so on its own it is a request for honesty rather than a
//   control; the general ceiling is what actually bounds a client that omits it.
//   240/minute is four per second, far above how fast a person scrolls.
//
// The budgets must sit ABOVE the rate a correctly paced walk generates, or they
// throttle the client they are meant to protect. A 250ms pacing delay is 240
// pages/minute, so a 30/minute walk budget stopped a walk after 7 seconds and 30
// pages: a 5k-message conversation needed two manual restarts and a 200k one
// needed 67. These are set above 240 with headroom for jitter and for several
// tabs, and their job is to catch a client that removed its pacing entirely.
const HISTORY_WALK_LIMIT = 400;
const HISTORY_WALK_WINDOW_SECONDS = 60;
// Higher than the walk budget on purpose: a client that omits walk=1 must not be
// penalised relative to one that declares itself, or every caller would simply
// stop declaring itself.
const CURSOR_PAGE_LIMIT = 600;
const CURSOR_PAGE_WINDOW_SECONDS = 60;

const MAX_CAS_ATTEMPTS = 8;

async function updateMessageRatchetWithCas(
  tx: PrismaTransaction,
  conversationId: string,
  ownerUserId: string,
  attemptsRemaining = MAX_CAS_ATTEMPTS
): Promise<void> {
  // Only the newest root-key epoch drives the counter; older wraps belong to
  // epochs the conversation has already rotated past.
  const key = await tx.orm.public.MessageConversationKeys.select(
    "ratchetCounter"
  )
    .where((candidate) =>
      and(
        candidate.conversationId.eq(conversationId),
        candidate.ownerUserId.eq(ownerUserId)
      )
    )
    .orderBy((candidate) => candidate.version.desc())
    .first();
  if (!key) {
    return;
  }
  const updated = await tx.orm.public.MessageConversationKeys.where(
    (candidate) =>
      and(
        candidate.conversationId.eq(conversationId),
        candidate.ownerUserId.eq(ownerUserId),
        candidate.ratchetCounter.eq(key.ratchetCounter)
      )
  ).updateAndCount({ ratchetCounter: key.ratchetCounter + 1 });
  if (updated === 1) {
    return;
  }
  if (attemptsRemaining <= 1) {
    throw new Error("Could not update message ratchet");
  }
  return updateMessageRatchetWithCas(
    tx,
    conversationId,
    ownerUserId,
    attemptsRemaining - 1
  );
}

type MessageQueryData = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getMessageDataQuery>["first"]>>
>;

// Deliberately does not carry the conversation's roster counter, even though the
// route has one to hand: a transcript says nothing about who may read it, and the
// two responses that do are the conversation detail and a send. Putting it here
// would put it on the paging path, where a scroll through history would record a
// roster change this client had not otherwise learned about.
function mapMessage(message: MessageQueryData): MessageData {
  return {
    ciphertext: message.ciphertext ?? "",
    conversationId: message.conversationId ?? "",
    createdAt: fromPrismaDateTime(message.createdAt),
    deletedAt: message.deletedAt ? fromPrismaDateTime(message.deletedAt) : null,
    editedAt: message.editedAt ? fromPrismaDateTime(message.editedAt) : null,
    id: message.id ?? "",
    iv: message.iv ?? "",
    ratchetIndex: message.ratchetIndex ?? 0,
    sender: message.sender
      ? {
          avatarUrl: message.sender.avatarUrl,
          badge: message.sender.badge,
          badges: message.sender.badges ?? [],
          communityMemberships: [],
          displayName: message.sender.displayName,
          id: message.sender.id,
          username: message.sender.username,
        }
      : null,
    senderId: message.senderId ?? "",
  };
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const aroundParam = url.searchParams.get("around")?.trim() ?? "";
  const afterParam = url.searchParams.get("after")?.trim() ?? "";
  const limitParam = url.searchParams.get("limit")?.trim() ?? "";
  // Declared by the client, not inferred: a transcript scroll and a search
  // backfill page through this endpoint identically, so intent is the only thing
  // that tells them apart.
  const isHistoryWalk = url.searchParams.get("walk") === "1";
  // Strict Number (not parseInt) so "10abc" falls back to the default instead
  // of silently becoming 10.
  const requestedLimit =
    limitParam.length > 0 ? Math.trunc(Number(limitParam)) : Number.NaN;
  const maxPageSize = isHistoryWalk
    ? MAX_HISTORY_WALK_PAGE_SIZE
    : MAX_PAGE_SIZE;
  const pageSize = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), maxPageSize)
    : PAGE_SIZE;

  // The three paging axes are mutually exclusive. Rejecting the ambiguous call
  // surfaces a client bug instead of silently honouring one and dropping the
  // other, which would look like a wrong window rather than a bad request.
  const axisCount = [cursor, aroundParam, afterParam].filter(
    (value) => value !== null && value.length > 0
  ).length;
  if (axisCount > 1) {
    return Response.json(
      { error: "Use only one of cursor, around, or after" },
      { status: 400 }
    );
  }

  // Metered before the database is touched, so a rejected walk costs no query.
  // Only paging reads are metered. An anchored read is a single user-initiated
  // jump, not a walk, and charging it against a budget would let a transcript
  // that auto-grows upward throttle a jump the user made once.
  const isPagingRead =
    (cursor !== null && cursor.length > 0) ||
    (afterParam !== null && afterParam.length > 0);
  if (isHistoryWalk || isPagingRead) {
    const rate = await consumeRateLimit({
      bucket: isHistoryWalk ? "messages-history-walk" : "messages-page",
      identifier: user.id,
      limit: isHistoryWalk ? HISTORY_WALK_LIMIT : CURSOR_PAGE_LIMIT,
      windowSeconds: isHistoryWalk
        ? HISTORY_WALK_WINDOW_SECONDS
        : CURSOR_PAGE_WINDOW_SECONDS,
    });
    if (!rate.allowed) {
      return Response.json(
        {
          error: "Too many history requests, try again shortly",
          retryAfterSeconds: rate.retryAfterSeconds,
        },
        { status: 429 }
      );
    }
  }

  const visible = visibleToUser(user.id);

  // Anchored window: a page centered on one message, so a search hit or a
  // permalink can open the transcript at that point without walking every page
  // between the newest message and the target. Two index range scans (older and
  // newer of the anchor) rather than one OFFSET, so cost is O(limit) no matter
  // how deep in history the anchor sits.
  if (aroundParam.length > 0) {
    const olderCount = Math.ceil(pageSize / 2);
    const newerCount = pageSize - olderCount;
    const [older, newer] = await Promise.all([
      getMessageDataQuery(prisma.orm)
        .where((message) =>
          and(
            message.conversationId.eq(id),
            message.id.lte(aroundParam),
            visible(message)
          )
        )
        .orderBy((message) => message.id.desc())
        .limit(olderCount + 1)
        .all(),
      getMessageDataQuery(prisma.orm)
        .where((message) =>
          and(
            message.conversationId.eq(id),
            message.id.gt(aroundParam),
            visible(message)
          )
        )
        .orderBy((message) => message.id.asc())
        .limit(newerCount + 1)
        .all(),
    ]);
    // One extra row on either side is the "is there more" probe, same as the
    // default read's take(pageSize + 1).
    const hasOlder = older.length > olderCount;
    const hasNewer = newer.length > newerCount;
    const olderPage = hasOlder ? older.slice(0, olderCount) : older;
    const newerPage = hasNewer ? newer.slice(0, newerCount) : newer;
    // Oldest-first, the one order the transcript renders in: the older half read
    // newest-first is reversed, then the newer half appends in ascending order.
    const messages = [...olderPage.toReversed(), ...newerPage].map(mapMessage);
    const oldest = messages.at(0);
    const newest = messages.at(-1);
    const response: MessagePage = {
      anchorIndex: messages.findIndex((message) => message.id === aroundParam),
      messages,
      nextCursor: hasNewer && newest ? newest.id : null,
      // The older page includes the anchor itself (lte), so the cursor is the
      // oldest message actually returned.
      previousCursor: hasOlder && oldest ? oldest.id : null,
    };
    return Response.json(response);
  }

  // Newer paging. Only reachable after an anchored read, when the transcript
  // sits in the middle of history and the user scrolls upward past the window.
  if (afterParam.length > 0) {
    const rows = await getMessageDataQuery(prisma.orm)
      .where((message) =>
        and(
          message.conversationId.eq(id),
          message.id.gt(afterParam),
          visible(message)
        )
      )
      .orderBy((message) => message.id.asc())
      .limit(pageSize + 1)
      .all();
    const messages = rows.map(mapMessage);

    const hasMore = messages.length > pageSize;
    const page = hasMore ? messages.slice(0, pageSize) : messages;
    const oldest = page.at(0);
    const newest = page.at(-1);
    const response: MessagePage = {
      messages: page,
      // Growing older from here is always possible as long as the window does
      // not start at the very first message, which the transcript detects by the
      // page being anchored rather than by probing here.
      nextCursor: hasMore && newest ? newest.id : null,
      previousCursor: oldest ? oldest.id : null,
    };
    return Response.json(response);
  }

  // Newest first from the cursor, then reversed so the client gets oldest-first.
  // The cursor is a message id, so ordering by id keeps the cursor and the sort
  // in the same total order - sorting by createdAt with an id cursor would skip
  // or duplicate messages on long threads where many share a timestamp.
  // (Prisma cuids are time-ordered, so id desc is still newest-first.)
  // "Delete for me": a hidden message never appears in this user's thread,
  // even on a cursor page that predates the hide.
  const messageQuery = getMessageDataQuery(prisma.orm)
    .where((message) =>
      and(
        message.conversationId.eq(id),
        ...(cursor ? [message.id.lt(cursor)] : []),
        visible(message)
      )
    )
    .orderBy((message) => message.id.desc())
    .limit(pageSize + 1);
  const messageRows = await messageQuery.all();
  const messages = messageRows.map(mapMessage);

  const hasMore = messages.length > pageSize;
  const page = hasMore ? messages.slice(0, pageSize) : messages;
  const lastMessage = page.at(-1);
  const previousCursor = hasMore && lastMessage ? lastMessage.id : null;

  const response: MessagePage = {
    messages: [...page].toReversed(),
    previousCursor,
  };

  return Response.json(response);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  // Metered BEFORE the membership read, the payload parse, and every query the
  // send itself runs. A limiter after the transaction would be a limiter that
  // has already let the database do the work it was meant to prevent.
  //
  // Two buckets on the same operation, deliberately, and they defend against
  // different things: the ten-second one stops a burst, and the hourly one stops
  // the caller who simply stays just under it. Slack's posting limit is the same
  // shape, a per-channel rate plus a workspace-wide ceiling.
  const burstLimited = await consumeDenRateLimit(
    DEN_MESSAGE_SEND_RATE_LIMIT,
    user.id
  );
  if (burstLimited) {
    return burstLimited;
  }
  const sustainedLimited = await consumeDenRateLimit(
    DEN_MESSAGE_SEND_HOUR_RATE_LIMIT,
    user.id
  );
  if (sustainedLimited) {
    return sustainedLimited;
  }

  // The send path keeps its own clearer 403 for blocks, so the shared gate
  // runs membership-only here.
  const conversation = await getConversationForUser(id, user.id, {
    enforceBlocks: false,
  });
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const parsed = await parseJsonBody(request);
  const body = parsed as {
    ciphertext?: string;
    iv?: string;
    ratchetIndex?: number;
  } | null;
  if (
    body === null ||
    typeof body.ciphertext !== "string" ||
    body.ciphertext.length === 0 ||
    typeof body.iv !== "string" ||
    body.iv.length === 0 ||
    typeof body.ratchetIndex !== "number"
  ) {
    return Response.json({ error: "Invalid message payload" }, { status: 400 });
  }
  // Bound the row size on create too, not just on edit. Without it an
  // authenticated sender can insert arbitrarily large ciphertext and bloat
  // every thread/list fetch that carries the row.
  if (body.ciphertext.length > MAX_MESSAGE_CIPHERTEXT_LENGTH) {
    return Response.json({ error: "Message is too large" }, { status: 413 });
  }
  // Narrowed consts so the transaction closure below sees definite types
  // (property narrowing does not survive into the arrow function).
  const { ciphertext } = body;
  const { iv } = body;
  const { ratchetIndex } = body;

  // Blocks are a DM-only rule, so a den has no peer for one to bite on. The
  // peer is resolved for a DM only, which is also what keeps the rule from
  // being enforced against an arbitrary third party in a den: picking "somebody
  // who is not the sender" out of a roster of ninety-nine meant one member's
  // block could silence a whole room depending on row order. The den does not get
  // that block enforced by anyone, including its own members - the answer here is
  // no because the rule does not apply, not because nobody was found.
  const blockedPeer = blockedSendPeer(conversation, user.id);
  if (blockedPeer && (await areBlocked(user.id, blockedPeer))) {
    return Response.json(
      { error: "You cannot message this user" },
      { status: 403 }
    );
  }

  // Everyone who accrues an unread badge for this message, decided from the
  // roster already in hand. Two exclusions, and they are the same two the
  // counters are reconciled against:
  //
  //   - the sender, who reads their own message; and
  //   - a member who muted the conversation. The mute exists so the badge stays
  //     off, and the unread seed excludes muted memberships, so incrementing one
  //     would grow a counter the seed would never justify.
  //
  // This has to name EVERY reader, not one of them. A DM has exactly one other
  // member, so the old single-recipient answer was right there and wrong
  // everywhere else: in a den it picked one member out of up to ninety-nine, so
  // ninety-eight people got no badge and which one did was whatever order the
  // roster came back in.
  //
  // From the snapshot the gate loaded, which is a moment before the write rather
  // than the same transaction as it. A member added in that window misses one
  // badge, and one removed in it gets one they should not have. Both are
  // reconciled by the next seed, and re-reading the roster here to close the
  // window would mean a second query on the hottest path in the app to fix an
  // error that self-heals.
  const unreadRecipientIds = conversation.members
    .filter((member) => member.userId !== user.id && !member.mutedAt)
    .map((member) => member.userId);

  // The ratchet index is authoritative on the server: it must equal the
  // sender's atomic per-conversation counter. If the client's count is stale
  // (e.g. a send raced another send), reject so the receiver can still derive
  // the correct message key.
  const expectedIndex = await nextRatchetIndex(id, user.id);
  if (ratchetIndex !== expectedIndex) {
    return Response.json(
      { error: "ratchet index mismatch", expectedIndex },
      { status: 409 }
    );
  }

  let message: MessageData | null = null;
  let createdMessageId: string | null = null;
  // The roster counter as of the bump below, read out of the UPDATE's own
  // RETURNING rather than from another query: the write that stamps the row is
  // the freshest statement in the transaction, and it holds the row lock, so
  // nothing can move the counter between it and the response. A send does NOT
  // change the counter - that is the whole reason this column exists - so this is
  // the conversation's current roster-change count, not a value about this
  // message. Null only if the update somehow returned no row.
  let membershipSeq: number | null = null;
  // Collected inside the transaction, flushed after it resolves. The rows are
  // written under the message's own transaction so a rollback takes them with
  // it; the enqueue has to wait for the commit, because a worker that ran
  // earlier would look the row up, find nothing, and treat it as deleted.
  const notificationEvents = newNotificationEvents();
  try {
    await prisma.transaction(async (tx) => {
      // Reset at the top so a retried attempt starts clean rather than
      // enqueueing the same recipient twice.
      resetNotificationEvents(notificationEvents);
      const created = await tx.orm.public.Messages.create({
        ciphertext,
        conversationId: id,
        iv,
        ratchetIndex: expectedIndex,
        senderId: user.id,
      });
      createdMessageId = created.id;

      await updateMessageRatchetWithCas(tx, id, user.id);

      // The conversation bump comes before the fan-out on purpose: it takes the
      // den's row lock, so two sends into one den serialize here and the second
      // one's fold lookup sees the first one's row.
      //
      // `updatedAt` only. A message is not a roster change, so `membershipSeq` is
      // deliberately left alone - it is the one signal that means "who may read
      // this moved", and moving it here would make every message look like a
      // membership event to every client holding the thread.
      const bumped = await tx.orm.public.MessageConversations.where({
        id,
      }).update({ updatedAt: toPrismaDateTime(new Date()) });
      membershipSeq = bumped?.membershipSeq ?? null;

      // A DM has no notification for a new message, so nothing fans out there.
      // A den does: one row per member, minus the sender, minus anyone who has
      // muted the den, folded per den so a busy room is one row per reader.
      if (conversation.type === "DEN") {
        const createdNotifications = await createDenMessageNotifications(tx, {
          conversationId: id,
          senderId: user.id,
        });
        for (const {
          id: notificationId,
          recipientId,
        } of createdNotifications) {
          notificationEvents.created.push({ notificationId, recipientId });
        }
      }
    });
  } catch (error) {
    // A concurrent send beat us to the same ratchet index. Hand back the
    // authoritative counter so the client can retry at the right position.
    if (isUniqueConstraintViolation(error)) {
      const fresh = await nextRatchetIndex(id, user.id);
      return Response.json(
        { error: "ratchet index mismatch", expectedIndex: fresh },
        { status: 409 }
      );
    }
    throw error;
  }

  // Past this point the message is committed, so the notification events are
  // real. Fire-and-forget: a queue hiccup costs a badge and a push, never the
  // send the caller already succeeded at.
  flushNotificationEvents(notificationEvents, "den message");

  if (!createdMessageId) {
    throw new Error("Message was not created");
  }
  const messageRow = await getMessageDataQuery(prisma.orm)
    .where({ id: createdMessageId })
    .first();
  if (messageRow) {
    message = mapMessage(messageRow);
  }

  // The sender always reads their own messages; only its readers accrue unread.
  // Aligned with the read path, which decrements by the number of rows
  // `unreadMessageWhere` counts for this conversation: peer-authored, not
  // deleted, not hidden, newer than the reader's own watermark. One increment
  // per qualifying member per message is the only shape that nets to zero, so a
  // member's badge cannot drift permanently in either direction.
  //
  // One pipelined round trip for the whole roster rather than a call per member.
  // Best-effort, like every other Redis side effect here: once the message is
  // committed, a counter failure must not turn a successful send into an error,
  // and the next seed reconciles whatever the counter is missing.
  try {
    await unreadMessageCache.incrementMany(unreadRecipientIds);
  } catch (error) {
    console.error("Failed to increment unread message count:", error);
  }
  try {
    // The message is guaranteed present after a committed transaction.
    if (message) {
      await publishMessageCreated(id, message);
    }
  } catch (error) {
    console.error("Failed to publish message created:", error);
  }
  // And tell every member's conversation list that this thread moved, so it
  // reorders and re-reads its preview without waiting for the next poll. Every
  // member, not the pair: the thread moves to the top of each RECIPIENT's list,
  // and the sender's own list has to follow in any other tab they have open.
  // Best-effort, like the publish above.
  try {
    await Promise.all(
      conversation.members.map((member) =>
        publishMessageActivity(member.userId, {
          conversationId: id,
          kind: "message.created",
        })
      )
    );
  } catch (error) {
    console.error("Failed to publish message activity:", error);
  }

  // `membershipSeq` is a sibling of `message`, not a field on it: it describes the
  // conversation, not this row, and putting it on the message would make
  // `mapMessage` carry a fact about a roster it knows nothing about. A send is the
  // one response a member whose membership event was lost will ever see, so this
  // is how they find out their cached roster is behind - the client compares it
  // against the last counter it applied and refetches when it is ahead. A server
  // that does not report it (or a transaction that returned no row) sends null,
  // which the client reads as "cannot tell" and handles exactly as it handled
  // every send before this field existed.
  return Response.json({ membershipSeq, message }, { status: 201 });
}
