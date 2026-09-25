import type { MessageData, MessagePage } from "@asm/db";
import {
  consumeRateLimit,
  prisma,
  publishMessageCreated,
  unreadMessageCache,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { MAX_MESSAGE_CIPHERTEXT_LENGTH } from "@/lib/messages/edit-window";
import {
  areBlocked,
  getConversationForUser,
  isUniqueConstraintViolation,
  messageSenderSelect,
  nextRatchetIndex,
  parseJsonBody,
  visibleToUser,
} from "@/lib/messages/server";

const DEFAULT_PAGE_SIZE = 30;
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
// pages — a 5k-message conversation needed two manual restarts and a 200k one
// needed 67. These are set above 240 with headroom for jitter and for several
// tabs, and their job is to catch a client that removed its pacing entirely.
const HISTORY_WALK_LIMIT = 400;
const HISTORY_WALK_WINDOW_SECONDS = 60;
// Higher than the walk budget on purpose: a client that omits walk=1 must not be
// penalised relative to one that declares itself, or every caller would simply
// stop declaring itself.
const CURSOR_PAGE_LIMIT = 600;
const CURSOR_PAGE_WINDOW_SECONDS = 60;

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
    : DEFAULT_PAGE_SIZE;

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
      prisma.message.findMany({
        include: messageSenderSelect(),
        orderBy: { id: "desc" },
        take: olderCount + 1,
        where: { conversationId: id, id: { lte: aroundParam }, ...visible },
      }),
      prisma.message.findMany({
        include: messageSenderSelect(),
        orderBy: { id: "asc" },
        take: newerCount + 1,
        where: { conversationId: id, id: { gt: aroundParam }, ...visible },
      }),
    ]);
    // One extra row on either side is the "is there more" probe, same as the
    // default read's take(pageSize + 1).
    const hasOlder = older.length > olderCount;
    const hasNewer = newer.length > newerCount;
    const olderPage = hasOlder ? older.slice(0, olderCount) : older;
    const newerPage = hasNewer ? newer.slice(0, newerCount) : newer;
    // Oldest-first, the one order the transcript renders in: the older half read
    // newest-first is reversed, then the newer half appends in ascending order.
    const messages = [...olderPage.toReversed(), ...newerPage];
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
    const messages = await prisma.message.findMany({
      include: messageSenderSelect(),
      orderBy: { id: "asc" },
      take: pageSize + 1,
      where: { conversationId: id, id: { gt: afterParam }, ...visible },
    });
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
  const messages = await prisma.message.findMany({
    include: messageSenderSelect(),
    orderBy: [{ id: "desc" }],
    take: pageSize + 1,
    where: {
      conversationId: id,
      ...(cursor ? { id: { lt: cursor } } : {}),
      // "Delete for me": a hidden message never appears in this user's thread,
      // even on a cursor page that predates the hide.
      ...visible,
    },
  });

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

  const otherMember = conversation.members.find(
    (member) => member.userId !== user.id
  );
  if (otherMember && (await areBlocked(user.id, otherMember.userId))) {
    return Response.json(
      { error: "You cannot message this user" },
      { status: 403 }
    );
  }

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
  try {
    await prisma.$transaction(async (tx) => {
      // The transaction client types the create without the include; the
      // runtime row does carry the sender (Prisma applies includes in
      // transactions too), so cast to the shape the client expects.
      message = (await tx.message.create({
        data: {
          ciphertext,
          conversationId: id,
          iv,
          ratchetIndex: expectedIndex,
          senderId: user.id,
        },
        include: messageSenderSelect(),
      })) as unknown as MessageData;

      // Advance the sender's atomic counter so the next index is fresh.
      // updateMany tolerates a missing key row (legacy conversation) instead
      // of throwing, keeping the dense count-based fallback consistent.
      await tx.messageConversationKey.updateMany({
        data: { ratchetCounter: { increment: 1 } },
        where: { conversationId: id, ownerUserId: user.id },
      });

      // Bump the conversation so the list page reorders this thread to the top
      // on activity. @updatedAt only fires when the row itself is updated.
      await tx.messageConversation.update({
        data: { updatedAt: new Date() },
        where: { id },
      });
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

  // The sender always reads their own messages; only the peer accrues unread.
  // Both Redis side effects are best-effort: once the message is committed,
  // a notification failure must not turn a successful send into an error.
  if (otherMember) {
    try {
      await unreadMessageCache.increment(otherMember.userId);
    } catch (error) {
      console.error("Failed to increment unread message count:", error);
    }
  }
  try {
    // The message is guaranteed present after a committed transaction.
    if (message) {
      await publishMessageCreated(id, message);
    }
  } catch (error) {
    console.error("Failed to publish message created:", error);
  }

  return Response.json({ message }, { status: 201 });
}
