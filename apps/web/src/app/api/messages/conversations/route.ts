import {
  and,
  canManageDen,
  createDen,
  fromPrismaDateTime,
  getMessageConversationDataQuery,
  listDenMembershipEventsForUser,
  prisma,
  unreadMessagesWhere,
  visibleToUser,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { dmPeerId, isHiddenByBlock } from "@/lib/messages/blocks";
import {
  denErrorResponse,
  objectOf,
  optionalStringField,
} from "@/lib/messages/den-api";
import {
  DEN_CREATE_RATE_LIMIT,
  DEN_DM_CREATE_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";
import {
  denCandidateFailureResponse,
  parseMemberIds,
  validateDenRoster,
} from "@/lib/messages/den-roster";
import {
  readerMessageWindows,
  readerWindowsContain,
} from "@/lib/messages/reader-window";
import type {
  ReaderMembershipEvent,
  ReaderMessageWindow,
} from "@/lib/messages/reader-window";
import {
  areBlocked,
  hasMessageIdentity,
  isUniqueConstraintViolation,
  parseJsonBody,
} from "@/lib/messages/server";
import type {
  MessageConversationData,
  MessageData,
} from "@/lib/messages/types";

const PAGE_SIZE = 20;

export interface ConversationListItem {
  conversation: MessageConversationData;
  isNew: boolean;
  lastMessage: {
    ciphertext: string;
    createdAt: string;
    deletedAt: string | null;
    id: string;
    iv: string;
    ratchetIndex: number;
    senderId: string;
  } | null;
  unreadCount: number;
}

interface ConversationListPage {
  conversations: MessageConversationData[];
  hasMore: boolean;
}

type ConversationWithLastMessage = MessageConversationData & {
  messages: MessageData[];
};

type ConversationQueryData = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof getMessageConversationDataQuery>["first"]>
  >
>;

// The conversation row as the query returns it, with the preview message
// included. The preview's element type comes from the caller's own query rather
// than a hand-written parallel type, so adding a column to the preview select
// cannot silently drop out of this shape.
// The preview row, as the query returns it: scalars plus the Prisma 8 temporal
// values for the three timestamp columns the select carries.
interface RawMessage {
  ciphertext: string;
  conversationId: string;
  createdAt: ConversationQueryData["createdAt"];
  deletedAt: ConversationQueryData["createdAt"] | null;
  editedAt: ConversationQueryData["createdAt"] | null;
  id: string;
  iv: string;
  ratchetIndex: number;
  senderId: string;
}

type ConversationQueryDataWithMessages = ConversationQueryData & {
  messages?: RawMessage[];
};

// Every conversation payload this module builds, for one viewer.
//
// The viewer id is a PARAMETER rather than something read from module state
// because the invite code is decided here and nowhere else on this surface: it is
// the ability to add strangers to a room, `GET /api/messages/dens/:id` withholds
// it from anybody who cannot manage, and this mapper used to hand it to every
// plain member through the list route. A detail gate is only a gate if the other
// route that returns the same object respects it too - and this one is the route
// every client fetches on load, so it is not a channel nobody gated, it is the
// one everybody walks through.
//
// `canManageDen`, not a written-out role comparison, so the list, the detail gate
// and the service's own authorization are one answer to "who may manage a den"
// rather than three.
//
// A DM carries no code, so redaction cannot change a DM's payload and the type
// does not have to be branched on.
// The viewer's own membership row for this conversation, in the shape the reader
// window takes. Null when there is no row, which the window answers as "no window".
function viewerMembership(
  conversation: ConversationQueryDataWithMessages,
  viewerId: string
) {
  const member = conversation.messageConversationMembers.find(
    (candidate) => candidate.userId === viewerId
  );
  if (!member) {
    return null;
  }
  return {
    createdAt: fromPrismaDateTime(member.createdAt),
    leftAt: member.leftAt ? fromPrismaDateTime(member.leftAt) : null,
  };
}

// Drops the preview rows that fall outside every one of the reader's windows.
//
// Only ever removes a row, and the input is the single newest message the query
// already limited, so this is at most one comparison per conversation on screen.
function previewInWindows<T extends { createdAt: unknown }>(
  messages: T[],
  windows: readonly ReaderMessageWindow[]
): T[] {
  if (
    windows.some((window) => window.after === null && window.before === null)
  ) {
    return messages;
  }
  return messages.filter((message) =>
    readerWindowsContain(windows, fromPrismaDateTime(message.createdAt))
  );
}

function mapConversation(
  conversation: ConversationQueryDataWithMessages,
  viewerId: string,
  // The viewer's own membership log lines for this conversation, oldest first.
  // A rejoin leaves the row unable to say which stretch the viewer missed, so the
  // stint boundaries come from the log; the create paths pass nothing because a
  // conversation being born has no stints to miss.
  membershipEvents: readonly ReaderMembershipEvent[]
): ConversationWithLastMessage {
  const canManage = conversation.messageConversationMembers.some(
    (member) => member.userId === viewerId && canManageDen(member.role)
  );
  const previewWindows = readerMessageWindows({
    conversationType: conversation._type,
    events: membershipEvents,
    membership: viewerMembership(conversation, viewerId),
    userId: viewerId,
  });
  return {
    // Den columns, null on a DM. `type` is never null, so a caller can branch on
    // it without a fallback.
    avatarMediaId: conversation.avatarMediaId,
    createdAt: fromPrismaDateTime(conversation.createdAt),
    createdById: conversation.createdById,
    description: conversation.description,
    id: conversation.id,
    inviteCode: canManage ? conversation.inviteCode : null,
    keys: conversation.messageConversationKeys.map((key) => ({
      ...key,
      createdAt: fromPrismaDateTime(key.createdAt),
    })),
    members: conversation.messageConversationMembers.flatMap((member) => {
      const memberUser = member.user;
      if (!memberUser) {
        return [];
      }
      return [
        {
          conversationId: member.conversationId,
          createdAt: fromPrismaDateTime(member.createdAt),
          lastReadAt: member.lastReadAt
            ? fromPrismaDateTime(member.lastReadAt)
            : null,
          // Den-only, and carried through for the same reason `mutedAt` is below:
          // the rail draws a "left" marker from it and the composer decides
          // read-only from it, so a mapper that omitted it left both reading
          // `undefined` and drawing a den somebody left as one they are in.
          leftAt: member.leftAt ? fromPrismaDateTime(member.leftAt) : null,
          // Carried through rather than dropped. The list route zeroes a muted
          // conversation's badge from this field and the rail draws its muted
          // marker from it, so a mapper that omitted it left both reading
          // `undefined` and quietly reporting an unmuted thread as unmuted.
          // Kept next to `lastReadAt` because it is the same kind of fact: this
          // member's own relationship with this conversation.
          mutedAt: member.mutedAt ? fromPrismaDateTime(member.mutedAt) : null,
          role: member.role,
          user: {
            avatarUrl: memberUser.avatarUrl,
            badge: memberUser.badge,
            badges: memberUser.badges ?? [],
            communityMemberships: memberUser.communityMembers.flatMap(
              (membership) =>
                membership.community
                  ? [
                      {
                        community: membership.community,
                        role: membership.role,
                      },
                    ]
                  : []
            ),
            displayName: memberUser.displayName,
            id: memberUser.id,
            messageIdentity: memberUser.messageIdentities,
            username: memberUser.username,
          },
          userId: member.userId,
        },
      ];
    }),
    // Carried through unchanged, like `inviteCode` above: the client's guard
    // compares the counter in this payload against the newest one the server has
    // reported to it, and a mapper that dropped it would leave the guard with
    // nothing to compare. It names nobody and describes no roster, so a plain
    // member reading it learns only how many changes they may have missed - the
    // same thing the stream tells them.
    membershipSeq: conversation.membershipSeq,
    // The preview is the newest message this viewer may see, and the transcript
    // route already floors that by the viewer's join - so without this the list row
    // could offer a pre-join message the transcript then refuses to open. Same
    // windows, same helper, applied here because this route cannot express a per
    // conversation floor inside the nested query: the bounds are facts about the
    // VIEWER's membership, and there is one of those per conversation on screen.
    // Filtering the already-limited single row costs nothing and keeps the list and
    // the thread from disagreeing about what this person has seen.
    messages: previewInWindows(conversation.messages ?? [], previewWindows).map(
      (message) => ({
        ...message,
        createdAt: fromPrismaDateTime(message.createdAt),
        deletedAt: message.deletedAt
          ? fromPrismaDateTime(message.deletedAt)
          : null,
        editedAt: message.editedAt
          ? fromPrismaDateTime(message.editedAt)
          : null,
      })
    ),
    pairKey: conversation.pairKey,
    type: conversation._type,
    updatedAt: fromPrismaDateTime(conversation.updatedAt),
  };
}

function toListItem(
  conversation: ConversationWithLastMessage,
  lastMessage: ConversationWithLastMessage["messages"][number] | undefined,
  unreadCount: number
): ConversationListItem {
  return {
    conversation,
    isNew: false,
    lastMessage: lastMessage
      ? {
          ciphertext: lastMessage.ciphertext,
          createdAt: lastMessage.createdAt.toISOString(),
          deletedAt: lastMessage.deletedAt
            ? lastMessage.deletedAt.toISOString()
            : null,
          id: lastMessage.id,
          iv: lastMessage.iv,
          ratchetIndex: lastMessage.ratchetIndex,
          senderId: lastMessage.senderId,
        }
      : null,
    unreadCount,
  };
}

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");

  let conversationQuery = getMessageConversationDataQuery(prisma.orm)
    .include("messages", (message) =>
      message
        .where(visibleToUser(user.id))
        .select(
          "ciphertext",
          "conversationId",
          "createdAt",
          "deletedAt",
          "editedAt",
          "id",
          "iv",
          "ratchetIndex",
          "senderId"
        )
        .orderBy([(row) => row.createdAt.desc(), (row) => row.id.desc()])
        .limit(1)
    )
    .where((conversation) =>
      conversation.messageConversationMembers.some((member) =>
        member.userId.eq(user.id)
      )
    )
    .orderBy([
      (conversation) => conversation.updatedAt.desc(),
      (conversation) => conversation.id.desc(),
    ])
    .limit(PAGE_SIZE + 1);
  if (cursor) {
    // Prisma 8 cursors are keyset seeks built from the values passed in, so
    // every orderBy column needs one: the anchor's updatedAt is read back here
    // because the page cursor only carries a conversation id. The seek is
    // exclusive, so no .offset(1) hop is needed. A vanished anchor restarts
    // from the top rather than 500ing the scroll.
    const anchor = await prisma.orm.public.MessageConversations.select(
      "updatedAt"
    )
      .where({ id: cursor })
      .first();
    if (anchor) {
      conversationQuery = conversationQuery.cursor({
        id: cursor,
        updatedAt: anchor.updatedAt,
      });
    }
  }
  const conversationRows = await conversationQuery.all();
  const readSequenceByConversation = new Map(
    conversationRows.map((row) => [
      row.id,
      row.messageConversationMembers.find((member) => member.userId === user.id)
        ?.lastReadSequence ?? null,
    ])
  );
  // The viewer's own stint boundaries for every den on the page, in one read.
  // A rejoin leaves the membership row unable to say which stretch of the
  // transcript the viewer was away for, and the preview below must not offer a
  // message from that stretch any more than the transcript route may serve it.
  const membershipEventsByDen = await listDenMembershipEventsForUser(
    conversationRows.filter((row) => row._type === "DEN").map((row) => row.id),
    user.id
  );
  // Bound, so the mapper's viewer is the session's and not a closure over
  // something that a later caller could get wrong. `map` passes (row, index), and
  // an index would silently become the viewer id if this were passed bare.
  const page = conversationRows.map((row) =>
    mapConversation(row, user.id, membershipEventsByDen.get(row.id) ?? [])
  );
  const hasMore = page.length > PAGE_SIZE;
  const visiblePage = hasMore ? page.slice(0, PAGE_SIZE) : page;

  const [iBlocked, blockedMe] = await Promise.all([
    prisma.orm.public.Blocks.select("blockedId")
      .where({ blockerId: user.id })
      .all(),
    prisma.orm.public.Blocks.select("blockerId")
      .where({ blockedId: user.id })
      .all(),
  ]);
  const hiddenPartnerIds = new Set<string>([
    ...iBlocked.map((row) => row.blockedId),
    ...blockedMe.map((row) => row.blockerId),
  ]);
  // Hiding a blocked peer is a DM-only rule, and this filter is the conversation
  // LIST half of it. The decision is delegated to the same predicate the detail
  // gate, the badge seed and the send path use rather than re-derived here; a den
  // passes it whatever the predicate says, because a den admits regardless of
  // blocks.
  const visibleConversations = visiblePage.filter((conversation) => {
    const other = dmPeerId(conversation.members, user.id);
    if (
      isHiddenByBlock(
        conversation.type,
        other,
        other !== undefined && hiddenPartnerIds.has(other)
      )
    ) {
      return false;
    }
    // An empty DM is not a conversation yet, so it is not on the rail either.
    // Starting a chat with somebody creates the row immediately (create-or-find),
    // and without this filter the list showed a silent, messageless row for every
    // person the reader had ever opened a thread with. Dens keep their place even
    // when quiet: membership is the fact a den row represents, and a room you
    // belong to is worth clicking into even before anybody speaks. The list
    // re-fetches on every arriving message (the client listens for that), so the
    // moment the DM has a message it appears - nothing is lost, only deferred
    // until there is something to show.
    if (conversation.type === "DM" && conversation.messages.length === 0) {
      return false;
    }
    return true;
  });

  // One grouped query for the whole page instead of a count round-trip per
  // conversation. PostgreSQL does the grouping, so this route never transfers
  // every unread message row just to count them in JavaScript. Each member's
  // own read watermark bounds its conversation's unread set; a page-wide
  // "earliest" bound would let one never-read thread pull every message across
  // the page.
  const unreadWatermarks = visibleConversations.map((conversation) => {
    const myMember = conversation.members.find(
      (member) => member.userId === user.id
    );
    const lastReadSequence = readSequenceByConversation.get(conversation.id);
    return {
      conversationId: conversation.id,
      lastReadAt: myMember?.lastReadAt ?? null,
      ...(lastReadSequence === null || lastReadSequence === undefined
        ? {}
        : { lastReadSequence }),
      windows:
        conversation.type === "DEN"
          ? readerMessageWindows({
              conversationType: "DEN",
              events: membershipEventsByDen.get(conversation.id) ?? [],
              membership: myMember
                ? {
                    createdAt: myMember.createdAt,
                    leftAt: myMember.leftAt ?? null,
                  }
                : null,
              userId: user.id,
            })
          : undefined,
    };
  });
  const unreadCounts =
    visibleConversations.length === 0
      ? []
      : await prisma.orm.public.Messages.where(
          unreadMessagesWhere({
            userId: user.id,
            watermarks: unreadWatermarks,
          })
        )
          .groupBy("conversationId")
          .aggregate((aggregate) => ({ count: aggregate.count() }));

  const unreadCountByConversation = new Map(
    unreadCounts.map((row) => [row.conversationId, row.count])
  );

  const items: ConversationListItem[] = visibleConversations.map(
    (conversation) => {
      const [lastMessage] = conversation.messages;
      const myMember = conversation.members.find(
        (member) => member.userId === user.id
      );
      const unreadCount = unreadCountByConversation.get(conversation.id) ?? 0;
      // A muted chat keeps its messages but loses its badge: mute is this
      // member's own preference, so it is applied here rather than by filtering
      // the query (which would also drop the thread from the rail).
      //
      // A den somebody left loses its badge for the same reason and a stronger
      // one: they cannot mark it read, because the read route refuses them, so a
      // badge here is a number that can only go up and never come down. It would
      // sit on the rail forever counting messages they will never be able to open.
      let badge = unreadCount;
      if (myMember?.leftAt || myMember?.mutedAt) {
        badge = 0;
      }
      return toListItem(conversation, lastMessage, badge);
    }
  );

  const last = visibleConversations.at(-1);
  const response: ConversationListPage & {
    items: ConversationListItem[];
    nextCursor: string | null;
  } = {
    conversations: items.map((item) => item.conversation),
    hasMore,
    items,
    nextCursor: hasMore && last ? last.id : null,
  };

  return Response.json(response);
}

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(request);
  const body = objectOf(parsed);

  // Two shapes share one route because they share one table and one client cache
  // entry. The discriminator is explicit (`type: "DEN"`) rather than inferred
  // from the presence of memberIds, so a malformed DM body can never be mistaken
  // for a request to create a group.
  if (body?.type === "DEN") {
    // The already-parsed body, not the Request. A Request body is a stream that
    // can be read once, and this route has read it; re-parsing here returned
    // null, so every den create answered "name is required" and - the reason
    // this is a correctness fix rather than a tidy-up - never reached the
    // limiter below it. A budget that cannot be reached is not a budget.
    return await createDenFromRequest(body, user.id);
  }

  // The DM half of this route. The den half has been metered since it was
  // written and this half was not, which is the oldest asymmetry on the surface.
  //
  // Charged on its own bucket rather than sharing the den's, because the two
  // cannot compete and a shared budget would only ever be the looser of the two:
  // somebody legitimately opening DMs all afternoon would spend the budget a den
  // create needs, and a script creating one den an hour would spend a DM's. It
  // sits before the recipient lookup and the four follow/identity/block queries,
  // since a limiter that runs after them has already paid for them.
  const limited = await consumeDenRateLimit(DEN_DM_CREATE_RATE_LIMIT, user.id);
  if (limited) {
    return limited;
  }

  const recipientId = body?.recipientId;
  if (typeof recipientId !== "string" || recipientId.length === 0) {
    return Response.json({ error: "recipientId is required" }, { status: 400 });
  }
  if (recipientId === user.id) {
    return Response.json({ error: "Cannot message yourself" }, { status: 400 });
  }

  const recipient = await prisma.orm.public.Users.select("id")
    .where({ id: recipientId })
    .first();
  if (!recipient) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // DMs are follow-gated: you can only start a conversation with someone you
  // follow, and both sides must have enabled messages (a public key to wrap
  // conversation keys for).
  const [iFollowThem, theyHaveIdentity, iHaveIdentity, blocked] =
    await Promise.all([
      prisma.orm.public.Follows.select("followerId")
        .where((follow) =>
          and(follow.followerId.eq(user.id), follow.followingId.eq(recipientId))
        )
        .first(),
      hasMessageIdentity(recipientId),
      hasMessageIdentity(user.id),
      areBlocked(user.id, recipientId),
    ]);

  if (blocked) {
    return Response.json(
      { error: "You cannot message this user" },
      { status: 403 }
    );
  }
  if (!iFollowThem) {
    return Response.json(
      { error: "You can only message people you follow" },
      { status: 403 }
    );
  }
  if (!theyHaveIdentity) {
    return Response.json(
      { error: "This user hasn't enabled Messages yet" },
      { status: 409 }
    );
  }
  if (!iHaveIdentity) {
    return Response.json(
      { error: "Enable Messages first to start a conversation" },
      { status: 409 }
    );
  }

  // create-or-find: a conversation between exactly these two users. The lookup
  // requires membership by BOTH ids and rejects any thread with a third
  // member, with a deterministic order so the result is stable.
  const existingRow = await getMessageConversationDataQuery(prisma.orm)
    .where((conversation) =>
      and(
        conversation.messageConversationMembers.some((member) =>
          member.userId.eq(user.id)
        ),
        conversation.messageConversationMembers.some((member) =>
          member.userId.eq(recipientId)
        ),
        conversation.messageConversationMembers.none((member) =>
          member.userId.notIn([user.id, recipientId])
        )
      )
    )
    .orderBy((conversation) => conversation.id.desc())
    .first();
  if (existingRow) {
    return Response.json({
      conversation: mapConversation(existingRow, user.id, []),
      isNew: false,
    });
  }

  // Deterministic key for the pair so two concurrent "start a chat" requests
  // for the same two users resolve to one conversation instead of racing into
  // two threads. The unique constraint turns the losing request into P2002,
  // which then returns the winner's conversation.
  const pairKey = [user.id, recipientId].toSorted().join(":");
  const conversation = await prisma
    .transaction(async (tx) => {
      const created = await tx.orm.public.MessageConversations.create({
        pairKey,
      });
      await tx.orm.public.MessageConversationMembers.create({
        conversationId: created.id,
        userId: recipientId,
      });
      await tx.orm.public.MessageConversationMembers.create({
        conversationId: created.id,
        userId: user.id,
      });
      const row = await getMessageConversationDataQuery(tx.orm)
        .where({ id: created.id })
        .first();
      if (!row) {
        throw new Error("Conversation not found after creation");
      }
      return mapConversation(row, user.id, []);
    })
    .catch(async (error: unknown) => {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      const winner = await getMessageConversationDataQuery(prisma.orm)
        .where({ pairKey })
        .first();
      if (winner) {
        return mapConversation(winner, user.id, []);
      }
      throw error;
    });

  return Response.json({ conversation, isNew: true }, { status: 201 });
}

// Binds a freshly-created den's avatar to the new conversation so the rest of
// the roster can load it. A den avatar is uploaded BEFORE the den exists (the
// creator picks it in the create sheet), so it cannot be conversation-bound at
// upload the way a message attachment is; it lands as an owner-readable unlinked
// row. This binds it after the fact.
//
// The binding is what `decideMediaAccess` reads to admit conversation members.
// Without it only the creator could fetch `/api/media/{id}`, and every other
// member's den would render a placeholder for a picture the creator can see.
// The same conservative guard as `message-link` runs here: the caller must own
// the row AND it must not already be bound elsewhere, so this can never re-point
// somebody else's media or move an existing attachment.
//
// Best-effort. The den exists either way, and an avatar the roster cannot see is
// a lesser outcome than a failed create; the creator's own copy still renders
// because an unlinked row is owner-readable.
async function bindDenAvatarToConversation(
  conversationId: string,
  avatarMediaId: string | null,
  creatorId: string
): Promise<void> {
  if (!avatarMediaId) {
    return;
  }
  try {
    await prisma.orm.public.PostMedia.where((media) =>
      and(
        media.id.eq(avatarMediaId),
        media.userId.eq(creatorId),
        media.status.in([
          "READY",
          "PROCESSING",
          "SCANNING",
          "QUARANTINED",
          "UPLOADING",
        ]),
        media.messageConversationId.isNull()
      )
    ).updateAndCount({ messageConversationId: conversationId });
  } catch (error) {
    console.error("Failed to bind den avatar to conversation:", error);
  }
}

// Den creation. Shares this route so the client lands on the same conversation
// cache entry it would for a DM, and so the response shape is identical.
async function createDenFromRequest(
  body: Record<string, unknown> | null,
  creatorId: string
): Promise<Response> {
  const name = body?.name;
  if (typeof name !== "string") {
    return Response.json({ error: "name is required" }, { status: 400 });
  }
  const parsedIds = parseMemberIds(body?.memberIds);
  if (parsedIds.failure) {
    return denCandidateFailureResponse(parsedIds.failure);
  }

  // The creator needs their own identity before anyone can be wrapped for them.
  if (!(await hasMessageIdentity(creatorId))) {
    return Response.json(
      { error: "Enable Messages first to start a conversation" },
      { status: 409 }
    );
  }

  const limited = await consumeDenRateLimit(DEN_CREATE_RATE_LIMIT, creatorId);
  if (limited) {
    return limited;
  }

  // Each candidate's own group-add policy decides, not the relationship between
  // the creator and the candidate: a den admits regardless of blocks, so there is
  // no incumbent roster to test anybody against, and the one relationship that
  // does matter is the one the candidate controls.
  const failure = await validateDenRoster(
    creatorId,
    [creatorId, ...parsedIds.memberIds],
    { currentMemberCount: 0 }
  );
  if (failure) {
    return denCandidateFailureResponse(failure);
  }

  const avatarMediaId = optionalStringField(body ?? null, "avatarMediaId");
  if (!avatarMediaId.ok) {
    return Response.json(
      { error: "avatarMediaId must be a string" },
      { status: 400 }
    );
  }
  const description = optionalStringField(body ?? null, "description");
  if (!description.ok) {
    return Response.json(
      { error: "description must be a string" },
      { status: 400 }
    );
  }

  try {
    const created = await createDen({
      avatarMediaId: avatarMediaId.value ?? null,
      creatorId,
      description: description.value ?? null,
      memberIds: parsedIds.memberIds,
      name,
    });
    // The avatar was picked before the den existed, so it is bound to the
    // conversation only now. Every member's client loads it through
    // `/api/media/{id}`, and that route admits conversation members off this link.
    await bindDenAvatarToConversation(
      created.id,
      avatarMediaId.value ?? null,
      creatorId
    );
    // Re-read through the same mapper the DM path uses, so the client receives
    // an identical conversation shape and does not need a second fetch before it
    // can fan the root key out to the new members.
    const row = await getMessageConversationDataQuery(prisma.orm)
      .where({ id: created.id })
      .first();
    if (!row) {
      return Response.json({ error: "Den not found" }, { status: 404 });
    }
    return Response.json(
      {
        conversation: mapConversation(row, creatorId, []),
        // Both doors come back at creation: the creator is the person most
        // likely to share immediately, and the details route would otherwise
        // be the only way to learn the short code exists. Manager-scoped
        // exactly like `inviteCode` - the creator is the only reader here.
        inviteCode: created.inviteCode,
        inviteShortCode: created.inviteShortCode,
        isNew: true,
      },
      { status: 201 }
    );
  } catch (error) {
    return denErrorResponse(error, {
      operation: "den.create",
      userId: creatorId,
    });
  }
}
