import {
  and,
  canManageDen,
  createDen,
  fromPrismaDateTime,
  getMessageConversationDataQuery,
  or,
  prisma,
  toPrismaDateTime,
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
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";
import {
  denCandidateFailureResponse,
  parseMemberIds,
  validateDenRoster,
} from "@/lib/messages/den-roster";
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
function mapConversation(
  conversation: ConversationQueryDataWithMessages,
  viewerId: string
): ConversationWithLastMessage {
  const canManage = conversation.messageConversationMembers.some(
    (member) => member.userId === viewerId && canManageDen(member.role)
  );
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
    messages: (conversation.messages ?? []).map((message) => ({
      ...message,
      createdAt: fromPrismaDateTime(message.createdAt),
      deletedAt: message.deletedAt
        ? fromPrismaDateTime(message.deletedAt)
        : null,
      editedAt: message.editedAt ? fromPrismaDateTime(message.editedAt) : null,
    })),
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
  // Bound, so the mapper's viewer is the session's and not a closure over
  // something that a later caller could get wrong. `map` passes (row, index), and
  // an index would silently become the viewer id if this were passed bare.
  const page = conversationRows.map((row) => mapConversation(row, user.id));
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
    return !isHiddenByBlock(
      conversation.type,
      other,
      other !== undefined && hiddenPartnerIds.has(other)
    );
  });

  // One grouped query for the whole page instead of a count round-trip per
  // conversation. Each member's own read watermark bounds its conversation's
  // unread set, so the query fetches only genuinely-unread rows rather than
  // every message since epoch 0 (a page-wide "earliest" bound would let one
  // never-read thread pull all messages across the page).
  const readAtByConversation = new Map<string, Date>();
  for (const conversation of visibleConversations) {
    const myMember = conversation.members.find(
      (member) => member.userId === user.id
    );
    readAtByConversation.set(
      conversation.id,
      myMember?.lastReadAt ?? new Date(0)
    );
  }
  const unreadRows =
    visibleConversations.length === 0
      ? []
      : await prisma.orm.public.Messages.select("conversationId")
          .where((message) =>
            and(
              // Per-conversation bound: each OR branch carries its own
              // watermark, so a never-read thread cannot drag in every message
              // on the page.
              or(
                ...visibleConversations.map((conversation) =>
                  and(
                    message.conversationId.eq(conversation.id),
                    message.createdAt.gt(
                      toPrismaDateTime(
                        readAtByConversation.get(conversation.id) ?? new Date(0)
                      )
                    )
                  )
                )
              ),
              message.deletedAt.isNull(),
              message.hiddenFor.none((hidden) => hidden.userId.eq(user.id)),
              message.senderId.notIn([user.id])
            )
          )
          .all();

  // Bucket the (already watermark-filtered) unread rows in one pass. No further
  // per-row compare is needed: every row cleared its own conversation's bound.
  const unreadCountByConversation = new Map<string, number>();
  for (const row of unreadRows) {
    unreadCountByConversation.set(
      row.conversationId,
      (unreadCountByConversation.get(row.conversationId) ?? 0) + 1
    );
  }

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
      return toListItem(
        conversation,
        lastMessage,
        myMember?.mutedAt ? 0 : unreadCount
      );
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
    return await createDenFromRequest(request, user.id);
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
      conversation: mapConversation(existingRow, user.id),
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
      return mapConversation(row, user.id);
    })
    .catch(async (error: unknown) => {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      const winner = await getMessageConversationDataQuery(prisma.orm)
        .where({ pairKey })
        .first();
      if (winner) {
        return mapConversation(winner, user.id);
      }
      throw error;
    });

  return Response.json({ conversation, isNew: true }, { status: 201 });
}

// Den creation. Shares this route so the client lands on the same conversation
// cache entry it would for a DM, and so the response shape is identical.
async function createDenFromRequest(
  request: Request,
  creatorId: string
): Promise<Response> {
  const body = objectOf(await parseJsonBody(request));

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

  // requireFollow: a direct add is the same deliberate act as starting a DM, so
  // the follow rule applies here exactly as it does for a DM. That is the only
  // relationship rule at this door: a den admits regardless of blocks, so there
  // is no incumbent roster to test anybody against and nothing to pass in for one.
  const failure = await validateDenRoster(
    creatorId,
    [creatorId, ...parsedIds.memberIds],
    { currentMemberCount: 0, requireFollow: true }
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
        conversation: mapConversation(row, creatorId),
        inviteCode: created.inviteCode,
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
