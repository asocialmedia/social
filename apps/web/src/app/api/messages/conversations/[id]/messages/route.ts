import {
  and,
  consumeRateLimit,
  createDenMessageNotifications,
  enqueueMessageSearchOutbox,
  fromPrismaDateTime,
  getMessageDataQuery,
  listDenMembershipEvents,
  prisma,
  publishMessageActivity,
  or,
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
import { createBoundedMessagePageResponse } from "@/lib/messages/history-page";
import { readerMessageWindows } from "@/lib/messages/reader-window";
import {
  areBlocked,
  getConversationForUser,
  hasLeftConversation,
  leftConversationResponse,
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
): Promise<number | null> {
  // Only the newest root-key epoch drives the counter; older wraps belong to
  // epochs the conversation has already rotated past.
  const key = await tx.orm.public.MessageConversationKeys.select(
    "ratchetCounter",
    "version"
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
    return null;
  }
  // `version` is part of the predicate, and it has to be.
  //
  // A member holds one wrap per root-key epoch, so rotating a den's key leaves the
  // owner with several rows for the same conversation - and freshly rotated ones
  // all carry the same counter, because a rotation copies it rather than
  // advancing it. A CAS that matched on the counter alone therefore updated EVERY
  // epoch at that value, so `updateAndCount` returned 2, the `=== 1` check failed,
  // and the retry re-read the same untouched state and failed identically eight
  // times. The send then failed with "Could not update message ratchet" in any
  // conversation whose keys had been rotated, which is every den that has had a
  // member added or removed.
  //
  // `(conversationId, ownerUserId, version)` is a unique key, so pinning it makes
  // the write hit exactly the row this read observed, and `=== 1` becomes a real
  // compare-and-swap again: 1 means this writer won, 0 means another writer moved
  // the counter first and the retry is the correct response.
  const updated = await tx.orm.public.MessageConversationKeys.where(
    (candidate) =>
      and(
        candidate.conversationId.eq(conversationId),
        candidate.ownerUserId.eq(ownerUserId),
        candidate.version.eq(key.version),
        candidate.ratchetCounter.eq(key.ratchetCounter)
      )
  ).updateAndCount({ ratchetCounter: key.ratchetCounter + 1 });
  if (updated === 1) {
    return key.version;
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

// The row a `.where()` predicate is handed: every column is a comparison
// accessor rather than a value. Named once because the two tuple helpers below
// take it, and spelling it as `MessageQueryData` would say "a row" where the
// argument is really a set of accessors over one.
type MessageAccessors = Parameters<ReturnType<typeof visibleToUser>>[0];

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
    keyEpoch: message.keyEpoch ?? null,
    ratchetIndex: message.ratchetIndex ?? 0,
    revision: message.revision ?? 1,
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

// The position a cursor names: the id the client holds, plus the timestamp the
// sort needs.
//
// Every read below orders by `(createdAt, id)`, so a cursor that carries only an
// id has to be resolved against the table before it can be used as a keyset
// anchor. One indexed primary-key probe, and it is the same shape the post feeds
// use for the same reason.
//
// Returns null when the row is not there to be found, which callers read as "no
// position" rather than as a position of zero.
async function messageCursorAnchor(
  conversationId: string,
  messageId: string
): Promise<{ createdAt: MessageQueryData["createdAt"]; id: string } | null> {
  const row = await prisma.orm.public.Messages.select("createdAt", "id")
    .where((message) =>
      and(message.conversationId.eq(conversationId), message.id.eq(messageId))
    )
    .first();
  return row ?? null;
}

// Row-wise `<=` against the `(createdAt, id)` total order, for the inclusive
// older half of an anchored read. Written out rather than delegated to a cursor
// seek because this side has to INCLUDE the anchor: `anchorIndex` points at it,
// and the older page's cursor is derived from the oldest row it returned.
//
// The id comparison only decides rows that share a millisecond, so it is the
// second clause rather than the first - which is also why the primary-key index
// is not what serves this, and why the `(conversationId, createdAt)` index is.
function atOrBefore(
  message: MessageAccessors,
  anchor: { createdAt: MessageQueryData["createdAt"]; id: string }
) {
  return or(
    message.createdAt.lt(anchor.createdAt),
    and(message.createdAt.eq(anchor.createdAt), message.id.lte(anchor.id))
  );
}

// The strict `>` half, so the anchor is not returned on both sides of the window.
function strictlyAfter(
  message: MessageAccessors,
  anchor: { createdAt: MessageQueryData["createdAt"]; id: string }
) {
  return or(
    message.createdAt.gt(anchor.createdAt),
    and(message.createdAt.eq(anchor.createdAt), message.id.gt(anchor.id))
  );
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
  const pageSize = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
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

  // This reader's windows over the transcript, and the filter that applies them.
  //
  // `getConversationForUser` admits somebody who left on purpose so their history stays
  // readable, and this is the other half of that split. A departed reader is capped at
  // their `leftAt`, so a reload cannot page in ciphertext from after the departure. A
  // reader who has just JOINED is floored at their membership's `createdAt`, so a
  // newcomer is not handed the room's history - which they could not decrypt anyway,
  // having been wrapped for no epoch minted before they arrived. And a reader who left
  // and came back holds one window per STINT, so the stretch they were gone stays
  // hidden: the membership row alone cannot express it (a rejoin clears `leftAt` on
  // the original row), which is what the membership log is loaded for.
  //
  // The log is uncapped: this filter is about the reader's own stints, and their own
  // lines all lie at or before any departure of theirs. It is also one bounded read -
  // a den's log is churn-sized - and it is skipped for a DM, which has no log and no
  // join floor at all.
  const myMember = conversation.members.find(
    (member) => member.userId === user.id
  );
  const membershipEvents =
    conversation.type === "DEN" ? await listDenMembershipEvents(id, null) : [];
  // `fromPrismaDateTime` rather than a bare read: the member mapper converts the
  // timestamps the routes use but leaves `createdAt` as the raw temporal value, and
  // the window is compared against real dates.
  const readerWindows = readerMessageWindows({
    conversationType: conversation.type,
    events: membershipEvents,
    membership: myMember
      ? {
          createdAt: fromPrismaDateTime(myMember.createdAt),
          leftAt: myMember.leftAt,
        }
      : null,
    userId: user.id,
  });
  // `ReturnType<typeof visibleToUser>[0]` rather than `Parameters<...>[0]`, because
  // `visibleToUser` takes the user id and RETURNS the message filter: indexing the
  // parameter type would describe the id.
  const readerVisible = (
    message: Parameters<ReturnType<typeof visibleToUser>>[0]
  ) => {
    const conditions = [visibleToUser(user.id)(message)];
    // One bounded range per stint, OR-ed. A stint with neither bound admits the
    // whole transcript on its own, so no range is added at all - which is also
    // what keeps a DM on exactly the filter it had before windows existed.
    const ranges = readerWindows
      .map((window) => {
        const bounds = [];
        if (window.after !== null) {
          bounds.push(message.createdAt.gte(toPrismaDateTime(window.after)));
        }
        if (window.before !== null) {
          bounds.push(message.createdAt.lte(toPrismaDateTime(window.before)));
        }
        return bounds.length === 0 ? null : and(...bounds);
      })
      .filter((range) => range !== null);
    if (ranges.length === readerWindows.length) {
      conditions.push(or(...ranges));
    }
    return and(...conditions);
  };

  // Anchored window: a page centered on one message, so a search hit or a
  // permalink can open the transcript at that point without walking every page
  // between the newest message and the target. Two index range scans (older and
  // newer of the anchor) rather than one OFFSET, so cost is O(limit) no matter
  // how deep in history the anchor sits.
  if (aroundParam.length > 0) {
    const anchor = await messageCursorAnchor(id, aroundParam);
    // An anchor that is not readable to this caller - gone, or hidden - leaves no
    // position to centre on, so the window falls back to the newest page rather
    // than 400ing the jump.
    const olderCount = Math.ceil(pageSize / 2);
    const newerCount = pageSize - olderCount;
    const [older, newer] = anchor
      ? await Promise.all([
          getMessageDataQuery(prisma.orm)
            .where((message) =>
              and(
                message.conversationId.eq(id),
                atOrBefore(message, anchor),
                readerVisible(message)
              )
            )
            .orderBy([
              (message) => message.createdAt.desc(),
              (message) => message.id.desc(),
            ])
            .limit(olderCount + 1)
            .all(),
          getMessageDataQuery(prisma.orm)
            .where((message) =>
              and(
                message.conversationId.eq(id),
                strictlyAfter(message, anchor),
                readerVisible(message)
              )
            )
            .orderBy([
              (message) => message.createdAt.asc(),
              (message) => message.id.asc(),
            ])
            .limit(newerCount + 1)
            .all(),
        ])
      : [[], []];
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
      // The older page includes the anchor itself, so the cursor is the
      // oldest message actually returned.
      previousCursor: hasOlder && oldest ? oldest.id : null,
    };
    return createBoundedMessagePageResponse(response, "around");
  }

  // Newer paging. Only reachable after an anchored read, when the transcript
  // sits in the middle of history and the user scrolls upward past the window.
  if (afterParam.length > 0) {
    const anchor = await messageCursorAnchor(id, afterParam);
    let rowsQuery = getMessageDataQuery(prisma.orm)
      .where((message) =>
        and(message.conversationId.eq(id), readerVisible(message))
      )
      .orderBy([
        (message) => message.createdAt.asc(),
        (message) => message.id.asc(),
      ]);
    if (anchor) {
      rowsQuery = rowsQuery.cursor({
        createdAt: anchor.createdAt,
        id: afterParam,
      });
    }
    const rows = await rowsQuery.limit(pageSize + 1).all();
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
    return createBoundedMessagePageResponse(response, "newer");
  }

  // Newest first from the cursor, then reversed so the client gets oldest-first.
  //
  // Ordered by `(createdAt, id)`, NOT by id alone. The id used to be a CUID and
  // therefore time-ordered, which let the cursor and the sort share one column; the
  // contract now declares `messages.id` as a random UUID, so an id sort is a
  // shuffle. Measured on a 100-message thread, 53 of 99 adjacent pairs came back
  // in the wrong order, which is a transcript that reshuffles itself on every
  // refresh and puts a freshly sent message anywhere in the window.
  //
  // `createdAt` alone would be enough until two messages share a millisecond, and
  // then a cursor on that value skips or repeats a row - so the id breaks the tie
  // and keeps `(createdAt, id)` a total order. It costs the `(conversationId,
  // createdAt)` index this table already carries.
  //
  // "Delete for me": a hidden message never appears in this user's thread,
  // even on a cursor page that predates the hide.
  let messageQuery = getMessageDataQuery(prisma.orm)
    .where((message) =>
      and(message.conversationId.eq(id), readerVisible(message))
    )
    .orderBy([
      (message) => message.createdAt.desc(),
      (message) => message.id.desc(),
    ]);
  if (cursor) {
    // The client holds only the id, and a keyset seek needs every column of the
    // sort, so the anchor's timestamp is read back here - the same shape the post
    // feeds use. The seek is exclusive, so no offset hop is needed. A vanished
    // anchor falls back to the newest page: messages are soft-deleted and hidden
    // rather than removed, so the row outlives both, and a hard-deleted anchor
    // should not strand the scroll.
    const anchor = await messageCursorAnchor(id, cursor);
    if (anchor) {
      messageQuery = messageQuery.cursor({
        createdAt: anchor.createdAt,
        id: cursor,
      });
    }
  }
  const messageRows = await messageQuery.limit(pageSize + 1).all();
  const messages = messageRows.map(mapMessage);

  const hasMore = messages.length > pageSize;
  const page = hasMore ? messages.slice(0, pageSize) : messages;
  const lastMessage = page.at(-1);
  const previousCursor = hasMore && lastMessage ? lastMessage.id : null;

  const response: MessagePage = {
    messages: [...page].toReversed(),
    previousCursor,
  };

  return createBoundedMessagePageResponse(response, "older");
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
  // The read gate above admits somebody who left a den, so this refuses them: they
  // can still read everything said before they went, and nothing they send now
  // would ever reach the people still in the room, because the key epoch that
  // would carry it excludes them and they have no unwrap for it.
  if (hasLeftConversation(conversation, user.id)) {
    return leftConversationResponse();
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

  const unreadRecipientIds: string[] = [];

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
  let searchOutboxId: string | null = null;
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

      const keyEpoch = await updateMessageRatchetWithCas(tx, id, user.id);

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

      const changeSequence = (bumped?.changeSeq ?? 0) + 1;
      if (bumped) {
        await tx.orm.public.MessageConversations.where({ id }).update({
          changeSeq: changeSequence,
        });
      }
      await tx.orm.public.Messages.where({ id: created.id }).update({
        creationSequence: changeSequence,
        keyEpoch,
      });

      // The conversation row lock serializes this roster snapshot with reads,
      // counter reconciliation, and den membership changes. Updating members in
      // user-id order keeps the row-lock order consistent across den fan-out.
      const unreadMembers =
        await tx.orm.public.MessageConversationMembers.select(
          "leftAt",
          "mutedAt",
          "unreadCount",
          "userId"
        )
          .where({ conversationId: id })
          .orderBy((member) => member.userId.asc())
          .all();
      for (const member of unreadMembers) {
        if (
          member.userId === user.id ||
          member.leftAt !== null ||
          member.mutedAt !== null
        ) {
          continue;
        }
        unreadRecipientIds.push(member.userId);
        if (member.unreadCount !== null) {
          if (member.unreadCount >= 2_147_483_647) {
            throw new Error(
              "Unread message count is outside the supported range"
            );
          }
          // oxlint-disable-next-line no-await-in-loop -- ordered member updates share the conversation lock.
          await tx.orm.public.MessageConversationMembers.where((candidate) =>
            and(
              candidate.conversationId.eq(id),
              candidate.userId.eq(member.userId)
            )
          ).update({ unreadCount: member.unreadCount + 1 });
        }
      }
      const outbox = await tx.orm.public.MessageSearchOutbox.create({
        audienceUserIds: conversation.members
          .filter((member) => !member.leftAt)
          .map((member) => member.userId),
        changeSequence,
        conversationId: id,
        kind: "upsert",
        messageId: created.id,
        revision: created.revision,
      });
      searchOutboxId = outbox.id;
      await tx.orm.public.MessageConversationChanges.create({
        audienceUserIds: conversation.members
          .filter((member) => !member.leftAt)
          .map((member) => member.userId),
        conversationId: id,
        kind: "message.created",
        messageId: created.id,
        revision: created.revision,
        sequence: changeSequence,
      });

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

  if (searchOutboxId) {
    void (async () => {
      try {
        await enqueueMessageSearchOutbox(searchOutboxId);
      } catch {
        console.error("Failed to enqueue DM search update");
      }
    })();
  }

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
      conversation.members
        .filter((member) => !member.leftAt)
        .map((member) =>
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
