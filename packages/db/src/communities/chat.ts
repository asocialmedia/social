import { createHash, randomUUID } from "node:crypto";

import { createLogger } from "@asm/logger";
import type {
  CommunityChatMessage,
  CommunityChatMessagePage,
  CommunityChatMemberPage,
  CommunityChatPermissions,
  CommunityChatRoom,
  CommunityChatThreadSummary,
} from "@asm/messages";
import {
  COMMUNITY_CHAT_HISTORY_BYTE_LIMIT,
  mergeCommunityChatTimeline,
  parseCommunityChatText,
} from "@asm/messages";
import { parseMessagePayload } from "@asm/messages/payload";
import type { ResultType } from "@prisma/orm-postgres/components/runtime";
import { and, or } from "@prisma/orm-postgres/orm-client";

import { rawQuery } from "../messages/infrastructure/raw-sql";
import { isMessageReactionEmoji } from "../messages/reactions";
import prisma, { fromPrismaDateTime, toPrismaDateTime } from "../prisma";
import type { PrismaOrm, PrismaTransaction } from "../prisma";
import { redis } from "../redis";

// oxlint-disable no-await-in-loop -- Bounded database retries and transaction writes preserve sequence and commit order.

const logger = createLogger({ serviceName: "community-chat" });
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_ROOM_CLAIMS = 16;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/u;

type ChatRole = "MEMBER" | "MODERATOR" | "OWNER" | "PARTICIPANT";

export class CommunityChatError extends Error {
  readonly code:
    | "CONFLICT"
    | "FORBIDDEN"
    | "INVALID"
    | "NOT_FOUND"
    | "SLOW_MODE";

  constructor(code: CommunityChatError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "CommunityChatError";
  }
}

export interface CommunityChatRoomAccess {
  communityId: string;
  permissions: CommunityChatPermissions;
  requiresLease: boolean;
  room: CommunityChatRoom;
}

interface RoomData {
  archived: boolean;
  channelType: "ANNOUNCEMENT" | "TEXT" | null;
  changeSequence: bigint;
  communityId: string;
  creatorId: string;
  id: string;
  kind: "CHANNEL" | "THREAD";
  locked: boolean;
  name: string;
  nextSequence: bigint;
  parentRoomId: string | null;
  sourceMessageId: string | null;
  slug: string;
  slowModeSeconds: number;
  sortOrder: number;
  topic: string | null;
  visibility: "PRIVATE" | "PUBLIC";
}

function mapRoom(room: RoomData): CommunityChatRoom {
  return {
    archived: room.archived,
    changeSequence: room.changeSequence.toString(),
    channelType: room.channelType,
    id: room.id,
    kind: room.kind,
    locked: room.locked,
    name: room.name,
    nextSequence: room.nextSequence.toString(),
    parentRoomId: room.parentRoomId,
    slowModeSeconds: room.slowModeSeconds,
    slug: room.slug,
    sortOrder: room.sortOrder,
    topic: room.topic,
    visibility: room.visibility,
  };
}

function isStaff(role: ChatRole | null | undefined): boolean {
  return role === "OWNER" || role === "MODERATOR";
}

function findMembership(orm: PrismaOrm, communityId: string, userId: string) {
  return orm.public.CommunityMembers.select("id", "role", "status", "userId")
    .where((member) =>
      and(member.communityId.eq(communityId), member.userId.eq(userId))
    )
    .first();
}

async function chatViewerContext(
  orm: PrismaOrm,
  communityId: string,
  userId: string
) {
  const now = toPrismaDateTime(new Date());
  const [community, membership, sanction] = await Promise.all([
    orm.public.Communities.select("_type").where({ id: communityId }).first(),
    userId ? findMembership(orm, communityId, userId) : null,
    userId
      ? orm.public.CommunityChatSanctions.select("kind")
          .where((row) =>
            and(
              row.communityId.eq(communityId),
              row.userId.eq(userId),
              row.kind.in(["BAN", "TIMEOUT"]),
              or(row.expiresAt.isNull(), row.expiresAt.gt(now))
            )
          )
          .orderBy((row) => row.kind.asc())
          .first()
      : null,
  ]);
  return { community, membership, sanction };
}

async function roomDataById(
  orm: PrismaOrm,
  roomId: string
): Promise<RoomData | null> {
  const room = await orm.public.CommunityChatRooms.select(
    "archived",
    "channelType",
    "changeSequence",
    "communityId",
    "creatorId",
    "id",
    "kind",
    "locked",
    "name",
    "nextSequence",
    "parentRoomId",
    "sourceMessageId",
    "slug",
    "slowModeSeconds",
    "sortOrder",
    "topic",
    "visibility"
  )
    .where({ id: roomId })
    .first();
  return room ? (room as RoomData) : null;
}

async function roomPermissions(
  orm: PrismaOrm,
  room: RoomData,
  userId: string,
  context?: Awaited<ReturnType<typeof chatViewerContext>>
): Promise<CommunityChatPermissions> {
  const { community, membership, sanction } =
    context ?? (await chatViewerContext(orm, room.communityId, userId));
  if (!community) {
    return {
      canManage: false,
      canRead: false,
      canSend: false,
      isMember: false,
    };
  }

  const active = membership?.status === "ACTIVE" && sanction?.kind !== "BAN";
  const staff = active && isStaff(membership.role);
  const communityReadable = community._type === "PUBLIC" || active;
  let threadReadable = true;

  if (room.kind === "THREAD" && room.visibility === "PRIVATE") {
    threadReadable = Boolean(
      staff ||
      (active &&
        membership &&
        (await orm.public.CommunityChatRoomMembers.where((participant) =>
          and(
            participant.roomId.eq(room.id),
            participant.communityMemberId.eq(membership.id)
          )
        ).first()))
    );
  }

  const canRead = communityReadable && threadReadable;
  const parent = room.parentRoomId
    ? await orm.public.CommunityChatRooms.select(
        "archived",
        "channelType",
        "locked"
      )
        .where({ id: room.parentRoomId })
        .first()
    : null;
  const canManage = Boolean(staff);
  let writeRestriction: CommunityChatPermissions["writeRestriction"] = null;
  if (sanction?.kind === "BAN") {
    writeRestriction = "BANNED";
  } else if (!active) {
    writeRestriction = membership?.status === "PENDING" ? "PENDING" : "JOIN";
  } else if (sanction?.kind === "TIMEOUT") {
    writeRestriction = "TIMEOUT";
  } else if (room.archived || parent?.archived) {
    writeRestriction = "ARCHIVED";
  } else if (room.locked || parent?.locked) {
    writeRestriction = "LOCKED";
  } else if (
    (room.channelType === "ANNOUNCEMENT" ||
      parent?.channelType === "ANNOUNCEMENT") &&
    !staff
  ) {
    writeRestriction = "ANNOUNCEMENT";
  }
  const canSend = Boolean(
    canRead &&
    active &&
    writeRestriction === null &&
    !room.locked &&
    !room.archived &&
    (room.channelType !== "ANNOUNCEMENT" || staff) &&
    (!parent ||
      (!parent.locked &&
        !parent.archived &&
        (parent.channelType !== "ANNOUNCEMENT" || staff)))
  );

  return {
    canManage,
    canRead,
    canSend,
    isMember: Boolean(active),
    writeRestriction,
  };
}

async function requireRoomAccess(
  roomId: string,
  userId: string
): Promise<CommunityChatRoomAccess> {
  const room = await roomDataById(prisma.orm, roomId);
  if (!room) {
    throw new CommunityChatError("NOT_FOUND", "Chat room not found");
  }
  const permissions = await roomPermissions(prisma.orm, room, userId);
  if (!permissions.canRead) {
    throw new CommunityChatError("NOT_FOUND", "Chat room not found");
  }
  const community = await prisma.orm.public.Communities.select("_type")
    .where({ id: room.communityId })
    .first();
  return {
    communityId: room.communityId,
    permissions,
    requiresLease:
      community?._type !== "PUBLIC" || room.visibility === "PRIVATE",
    room: mapRoom(room),
  };
}

function channelFromRow(row: RoomData): CommunityChatRoom {
  return mapRoom(row);
}

export async function listCommunityChatChannels(
  communityId: string,
  userId: string
): Promise<{
  channels: CommunityChatRoom[];
  permissions: CommunityChatPermissions;
}> {
  const viewer = await chatViewerContext(prisma.orm, communityId, userId);
  const rows = await prisma.orm.public.CommunityChatRooms.select(
    "archived",
    "channelType",
    "changeSequence",
    "communityId",
    "creatorId",
    "id",
    "kind",
    "locked",
    "name",
    "nextSequence",
    "parentRoomId",
    "sourceMessageId",
    "slug",
    "slowModeSeconds",
    "sortOrder",
    "topic",
    "visibility"
  )
    .where((room) =>
      and(
        room.communityId.eq(communityId),
        room.kind.eq("CHANNEL"),
        room.archived.eq(false)
      )
    )
    .orderBy([(room) => room.sortOrder.asc(), (room) => room.name.asc()])
    .all();

  const channels: CommunityChatRoom[] = [];
  let permissions: CommunityChatPermissions = {
    canManage: false,
    canRead: false,
    canSend: false,
    isMember: false,
  };
  for (const row of rows) {
    const room = row as RoomData;
    const access = await roomPermissions(prisma.orm, room, userId, viewer);
    if (!access.canRead) {
      continue;
    }
    channels.push(channelFromRow(room));
    if (channels.length === 1) {
      permissions = access;
    }
  }

  if (channels.length === 0) {
    const community = await prisma.orm.public.Communities.select("_type")
      .where({ id: communityId })
      .first();
    const membership = userId
      ? await findMembership(prisma.orm, communityId, userId)
      : null;
    const active = membership?.status === "ACTIVE";
    const canRead = community?._type === "PUBLIC" || active;
    permissions = {
      canManage: active && isStaff(membership.role),
      canRead: Boolean(canRead),
      canSend: false,
      isMember: Boolean(active),
    };
  }

  return { channels, permissions };
}

export function getCommunityChatRoomAccess(
  roomId: string,
  userId: string
): Promise<CommunityChatRoomAccess> {
  return requireRoomAccess(roomId, userId);
}

export async function getCommunityChatMessageRoomAccess(
  messageId: string,
  userId: string
): Promise<CommunityChatRoomAccess> {
  const message = await prisma.orm.public.CommunityChatMessages.select("roomId")
    .where({ id: messageId })
    .first();
  if (!message) {
    throw new CommunityChatError("NOT_FOUND", "Message not found");
  }
  return requireRoomAccess(message.roomId, userId);
}

function messageQuery(orm: PrismaOrm) {
  return orm.public.CommunityChatMessages.select(
    "changeSequence",
    "createdAt",
    "deletedAt",
    "editedAt",
    "id",
    "payload",
    "replyToId",
    "revision",
    "roomId",
    "senderId",
    "sequence"
  ).include("sender", (sender) =>
    sender.select("avatarUrl", "displayName", "id", "username")
  );
}

type ChatMessageRow = ResultType<ReturnType<typeof messageQuery>>;

function mapMessage(row: ChatMessageRow): CommunityChatMessage {
  if (!row.sender) {
    throw new Error("Community chat sender could not be read");
  }
  let payload: CommunityChatMessage["payload"] = null;
  if (!row.deletedAt) {
    try {
      payload = parseMessagePayload(JSON.stringify(row.payload));
    } catch {
      payload = null;
    }
  }
  return {
    changeSequence: row.changeSequence.toString(),
    createdAt: fromPrismaDateTime(row.createdAt).toISOString(),
    deletedAt: row.deletedAt
      ? fromPrismaDateTime(row.deletedAt).toISOString()
      : null,
    editedAt: row.editedAt
      ? fromPrismaDateTime(row.editedAt).toISOString()
      : null,
    id: row.id,
    payload,
    replyToId: row.replyToId,
    revision: row.revision,
    roomId: row.roomId,
    sender: {
      avatarUrl: row.sender.avatarUrl,
      displayName: row.sender.displayName,
      id: row.sender.id,
      username: row.sender.username,
    },
    senderId: row.senderId,
    sequence: row.sequence.toString(),
  };
}

async function hydrateChatMessages(
  messages: CommunityChatMessage[],
  communityId: string,
  userId: string
): Promise<CommunityChatMessage[]> {
  if (messages.length === 0) {
    return [];
  }
  const ids = messages.map((message) => message.id);
  const senderIds = [...new Set(messages.map((message) => message.senderId))];
  const replyIds = messages.flatMap((message) =>
    message.replyToId ? [message.replyToId] : []
  );
  const roomIds = [...new Set(messages.map((message) => message.roomId))];
  const [members, reactions, pins, replyRows] = await Promise.all([
    prisma.orm.public.CommunityMembers.select("role", "userId")
      .where((member) =>
        and(
          member.communityId.eq(communityId),
          member.status.eq("ACTIVE"),
          member.userId.in(senderIds)
        )
      )
      .all(),
    rawQuery<{
      messageId: string;
      emoji: string;
      count: number;
      reacted: boolean;
    }>(
      `SELECT "messageId", emoji, count(*)::integer AS count, bool_or("userId" = $2) AS reacted
       FROM public.community_chat_reactions WHERE "messageId" = ANY($1::text[])
       GROUP BY "messageId", emoji ORDER BY count DESC, emoji ASC`,
      [ids, userId],
      {
        count: "pg/int4@1",
        emoji: "pg/text@1",
        messageId: "pg/text@1",
        reacted: "pg/bool@1",
      }
    ),
    prisma.orm.public.CommunityChatPins.select("messageId")
      .where((pin) => pin.messageId.in(ids))
      .all(),
    replyIds.length
      ? messageQuery(prisma.orm)
          .where((message) =>
            and(message.id.in(replyIds), message.roomId.in(roomIds))
          )
          .all()
      : [],
  ]);
  const roleByUser = new Map(
    members.map((member) => [member.userId, member.role])
  );
  const pinnedIds = new Set(pins.map((pin) => pin.messageId));
  const replies = new Map(replyRows.map((row) => [row.id, mapMessage(row)]));
  const reactionsByMessage = new Map<
    string,
    NonNullable<CommunityChatMessage["reactions"]>
  >();
  for (const reaction of reactions.rows) {
    const summary = reactionsByMessage.get(reaction.messageId) ?? [];
    if (summary.length < 20) {
      summary.push({
        count: reaction.count,
        emoji: reaction.emoji,
        reacted: reaction.reacted,
      });
    }
    reactionsByMessage.set(reaction.messageId, summary);
  }
  return messages.map((message) => {
    const reply = message.replyToId ? replies.get(message.replyToId) : null;
    return {
      ...message,
      pinned: !message.deletedAt && pinnedIds.has(message.id),
      reactions: message.deletedAt
        ? []
        : (reactionsByMessage.get(message.id) ?? []),
      replyTo:
        reply && reply.roomId === message.roomId
          ? {
              content:
                reply.payload?.type === "text"
                  ? reply.payload.content.slice(0, 240)
                  : null,
              deleted: reply.deletedAt !== null,
              id: reply.id,
              senderName:
                reply.sender.displayName.trim() || reply.sender.username,
            }
          : null,
      sender: {
        ...message.sender,
        role: roleByUser.get(message.senderId) ?? null,
      },
    };
  });
}

export async function getCommunityChatMessage(input: {
  messageId: string;
  roomId: string;
  userId: string;
}): Promise<CommunityChatMessage> {
  const access = await requireRoomAccess(input.roomId, input.userId);
  const row = await messageQuery(prisma.orm)
    .where((message) =>
      and(message.id.eq(input.messageId), message.roomId.eq(access.room.id))
    )
    .first();
  if (!row) {
    throw new CommunityChatError("NOT_FOUND", "Message not found");
  }
  const [message] = await hydrateChatMessages(
    [mapMessage(row)],
    access.communityId,
    input.userId
  );
  if (!message) {
    throw new CommunityChatError("NOT_FOUND", "Message not found");
  }
  return message;
}

export async function listCommunityChatThreads(
  channelId: string,
  userId: string
): Promise<CommunityChatThreadSummary[]> {
  const access = await requireRoomAccess(channelId, userId);
  if (access.room.kind !== "CHANNEL") {
    throw new CommunityChatError("NOT_FOUND", "Chat channel not found");
  }
  const membership = userId
    ? await findMembership(prisma.orm, access.communityId, userId)
    : null;
  const memberId = membership?.status === "ACTIVE" ? membership.id : "";
  const rows = await prisma.orm.public.CommunityChatRooms.select(
    "archived",
    "channelType",
    "changeSequence",
    "communityId",
    "creatorId",
    "id",
    "kind",
    "locked",
    "name",
    "nextSequence",
    "parentRoomId",
    "sourceMessageId",
    "slug",
    "slowModeSeconds",
    "sortOrder",
    "topic",
    "visibility"
  )
    .where((room) =>
      and(
        room.parentRoomId.eq(channelId),
        room.kind.eq("THREAD"),
        room.archived.eq(false),
        access.permissions.canManage
          ? room.kind.eq("THREAD")
          : or(
              room.visibility.eq("PUBLIC"),
              room.members.some((participant) =>
                participant.communityMemberId.eq(memberId)
              )
            )
      )
    )
    .orderBy((room) => room.updatedAt.desc())
    .limit(100)
    .all();

  const sourceIds = rows.flatMap((row) =>
    row.sourceMessageId ? [row.sourceMessageId] : []
  );
  const sources = sourceIds.length
    ? await messageQuery(prisma.orm)
        .where((message) =>
          and(message.id.in(sourceIds), message.roomId.eq(channelId))
        )
        .all()
    : [];
  const sourceById = new Map(
    sources.map((source) => [source.id, mapMessage(source)])
  );
  return rows.map((candidate) => ({
    room: mapRoom(candidate as RoomData),
    sourceMessage: candidate.sourceMessageId
      ? (sourceById.get(candidate.sourceMessageId) ?? null)
      : null,
  }));
}

export async function searchCommunityChatMembers(input: {
  communityId: string;
  cursor?: string;
  limit?: number;
  query: string;
  userId: string;
}): Promise<CommunityChatMemberPage> {
  const membership = await findMembership(
    prisma.orm,
    input.communityId,
    input.userId
  );
  if (membership?.status !== "ACTIVE") {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Join this community to browse members"
    );
  }
  const search = input.query.trim().replaceAll(/[\\%_]/gu, "");
  if (search.length < 2 || search.length > 64) {
    throw new CommunityChatError("INVALID", "Search with 2 to 64 characters");
  }
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 20), 50));
  const pattern = `%${search}%`;
  let users = prisma.orm.public.Users.select(
    "avatarUrl",
    "displayName",
    "id",
    "username"
  ).where((user) =>
    and(
      or(user.username.ilike(pattern), user.displayName.ilike(pattern)),
      user.communityMembers.some((member) =>
        and(
          member.communityId.eq(input.communityId),
          member.status.eq("ACTIVE")
        )
      )
    )
  );
  const { cursor } = input;
  if (cursor) {
    users = users.where((user) => user.id.gt(cursor));
  }
  const candidates = await users
    .orderBy((user) => user.id.asc())
    .limit(limit + 1)
    .all();
  const pageCandidates = candidates.slice(0, limit);
  return {
    members: pageCandidates.map((user) => ({
      avatarUrl: user.avatarUrl,
      displayName: user.displayName?.trim() || user.username || "Member",
      id: user.id,
      username: user.username || user.id,
    })),
    nextCursor:
      candidates.length > limit ? (pageCandidates.at(-1)?.id ?? null) : null,
  };
}

function parseSequence(value: string | undefined): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^[0-9]{1,20}$/u.test(value)) {
    throw new CommunityChatError("INVALID", "Invalid sequence cursor");
  }
  const sequence = BigInt(value);
  if (sequence > 9_223_372_036_854_775_807n) {
    throw new CommunityChatError("INVALID", "Invalid sequence cursor");
  }
  return sequence;
}

export async function getCommunityChatMessages(input: {
  afterSequence?: string;
  aroundMessageId?: string;
  beforeSequence?: string;
  limit?: number;
  roomId: string;
  userId: string;
}): Promise<CommunityChatMessagePage> {
  const access = await requireRoomAccess(input.roomId, input.userId);
  const limit = Math.max(
    1,
    Math.min(Math.trunc(input.limit ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
  );
  const before = parseSequence(input.beforeSequence);
  const after = parseSequence(input.afterSequence);
  if (
    [
      before !== undefined,
      after !== undefined,
      Boolean(input.aroundMessageId),
    ].filter(Boolean).length > 1
  ) {
    throw new CommunityChatError(
      "INVALID",
      "Use one history boundary at a time"
    );
  }

  let query = messageQuery(prisma.orm).where((message) =>
    message.roomId.eq(access.room.id)
  );
  if (input.aroundMessageId) {
    const anchor = await messageQuery(prisma.orm)
      .where((message) =>
        and(
          message.id.eq(input.aroundMessageId ?? ""),
          message.roomId.eq(access.room.id)
        )
      )
      .first();
    if (!anchor) {
      throw new CommunityChatError("NOT_FOUND", "Message not found");
    }
    const olderLimit = Math.ceil(limit / 2);
    const newerLimit = limit - olderLimit;
    const [older, newer] = await Promise.all([
      query
        .where((message) => message.sequence.lte(anchor.sequence))
        .orderBy((message) => message.sequence.desc())
        .limit(olderLimit + 1)
        .all(),
      query
        .where((message) => message.sequence.gt(anchor.sequence))
        .orderBy((message) => message.sequence.asc())
        .limit(newerLimit + 1)
        .all(),
    ]);
    const hydrated = await hydrateChatMessages(
      [
        ...older.slice(0, olderLimit).toReversed(),
        ...newer.slice(0, newerLimit),
      ].map(mapMessage),
      access.communityId,
      input.userId
    );
    const bounded = mergeCommunityChatTimeline([], hydrated, {
      edge: "newer",
      maxBytes: COMMUNITY_CHAT_HISTORY_BYTE_LIMIT,
      maxMessages: limit,
    });
    return {
      messages: bounded.messages,
      nextAfterSequence:
        newer.length > newerLimit
          ? (bounded.messages.at(-1)?.sequence ?? null)
          : null,
      nextBeforeSequence:
        older.length > olderLimit || bounded.trimmedBefore
          ? (bounded.messages[0]?.sequence ?? null)
          : null,
    };
  }
  if (before !== undefined) {
    query = query.where((message) => message.sequence.lt(before));
  }
  if (after !== undefined) {
    query = query.where((message) => message.sequence.gt(after));
  }
  const descending = before !== undefined || after === undefined;
  const rows = await query
    .orderBy((message) =>
      descending ? message.sequence.desc() : message.sequence.asc()
    )
    .limit(limit + 1)
    .all();
  const hasMore = rows.length > limit;
  const selected = rows.slice(0, limit);
  if (descending) {
    selected.reverse();
  }
  const hydrated = await hydrateChatMessages(
    selected.map(mapMessage),
    access.communityId,
    input.userId
  );
  const bounded = mergeCommunityChatTimeline([], hydrated, {
    edge: descending ? "newer" : "older",
    maxBytes: COMMUNITY_CHAT_HISTORY_BYTE_LIMIT,
    maxMessages: limit,
  });
  const { messages } = bounded;
  const oldest = messages[0]?.sequence ?? null;
  const newest = messages.at(-1)?.sequence ?? null;
  const nextAfterSequence =
    after !== undefined && (hasMore || bounded.trimmedAfter) ? newest : null;
  let nextBeforeSequence: string | null = null;
  if (
    (before !== undefined || after === undefined) &&
    (hasMore || bounded.trimmedBefore)
  ) {
    nextBeforeSequence = oldest;
  }
  return {
    messages,
    nextAfterSequence,
    nextBeforeSequence,
  };
}

async function checkContributionPolicy(
  input: {
    communityId: string;
    room: RoomData;
    userId: string;
  },
  orm: PrismaOrm = prisma.orm
): Promise<void> {
  if (input.room.kind === "THREAD" && input.room.parentRoomId) {
    const parent = await roomDataById(orm, input.room.parentRoomId);
    if (!parent) {
      throw new CommunityChatError("NOT_FOUND", "Thread channel not found");
    }
    await checkContributionPolicy(
      {
        communityId: input.communityId,
        room: parent,
        userId: input.userId,
      },
      orm
    );
  }
  const membership = await findMembership(orm, input.communityId, input.userId);
  if (membership?.status !== "ACTIVE") {
    throw new CommunityChatError("FORBIDDEN", "Join this community to chat");
  }
  const now = toPrismaDateTime(new Date());
  const sanction = await orm.public.CommunityChatSanctions.where((row) =>
    and(
      row.communityId.eq(input.communityId),
      row.userId.eq(input.userId),
      row.kind.in(["BAN", "TIMEOUT"]),
      or(row.expiresAt.isNull(), row.expiresAt.gt(now))
    )
  ).first();
  if (sanction) {
    throw new CommunityChatError(
      "FORBIDDEN",
      sanction.kind === "BAN"
        ? "You are banned from this community"
        : "You are timed out from contributing"
    );
  }
  if (input.room.locked || input.room.archived) {
    throw new CommunityChatError("FORBIDDEN", "This channel is read-only");
  }
  if (input.room.channelType === "ANNOUNCEMENT" && !isStaff(membership.role)) {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Only community staff can post in this announcement channel"
    );
  }
}

function normalizeRoomSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKC")
    .replaceAll(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
}

export async function createCommunityChatThread(input: {
  channelId: string;
  clientId: string;
  creatorId: string;
  inviteeUserIds?: string[];
  name: string;
  sourceMessageId?: string;
  starterContent?: unknown;
  visibility: "PRIVATE" | "PUBLIC";
}): Promise<CommunityChatRoom> {
  const channelAccess = await requireRoomAccess(
    input.channelId,
    input.creatorId
  );
  if (channelAccess.room.kind !== "CHANNEL") {
    throw new CommunityChatError("NOT_FOUND", "Chat channel not found");
  }
  const channel = await roomDataById(prisma.orm, input.channelId);
  if (!channel) {
    throw new CommunityChatError("NOT_FOUND", "Chat channel not found");
  }
  await checkContributionPolicy({
    communityId: channel.communityId,
    room: channel,
    userId: input.creatorId,
  });
  const name = input.name.trim();
  if (name.length < 1 || name.length > 64) {
    throw new CommunityChatError(
      "INVALID",
      "Thread names must be 1 to 64 characters"
    );
  }
  if (!CLIENT_ID_PATTERN.test(input.clientId)) {
    throw new CommunityChatError("INVALID", "Invalid client message id");
  }
  const roomId = `thread_${createHash("sha256")
    .update(JSON.stringify([channel.id, input.creatorId, input.clientId]))
    .digest("hex")
    .slice(0, 48)}`;
  const previousThread = await roomDataById(prisma.orm, roomId);
  if (previousThread) {
    await requireRoomAccess(roomId, input.creatorId);
    if (previousThread.visibility !== input.visibility)
      {throw new CommunityChatError(
        "CONFLICT",
        "Thread privacy is fixed at creation"
      );}
    return mapRoom(previousThread);
  }

  let starterPayload: { content: string; type: "text" } | null = null;
  if (input.visibility === "PRIVATE") {
    const payload = parseCommunityChatText(input.starterContent);
    if (payload.type !== "text") {
      throw new CommunityChatError(
        "INVALID",
        "Private threads need a starter message"
      );
    }
    starterPayload = payload;
  } else {
    if (!input.sourceMessageId) {
      throw new CommunityChatError(
        "INVALID",
        "Public threads must start from a channel message"
      );
    }
    const { sourceMessageId } = input;
    if (!sourceMessageId) {
      throw new CommunityChatError(
        "INVALID",
        "Public threads must start from a channel message"
      );
    }
    const source = await prisma.orm.public.CommunityChatMessages.select("id")
      .where((message) =>
        and(
          message.id.eq(sourceMessageId),
          message.roomId.eq(channel.id),
          message.deletedAt.isNull()
        )
      )
      .first();
    if (!source) {
      throw new CommunityChatError("INVALID", "Thread starter was not found");
    }
    const existing = await prisma.orm.public.CommunityChatRooms.where((room) =>
      and(
        room.sourceMessageId.eq(sourceMessageId),
        room.kind.eq("THREAD"),
        room.archived.eq(false)
      )
    ).first();
    if (existing) {
      throw new CommunityChatError(
        "CONFLICT",
        "This message already has a public thread"
      );
    }
  }

  const inviteeIds = [...new Set(input.inviteeUserIds)].filter(
    (userId) => userId !== input.creatorId
  );
  if (input.visibility === "PUBLIC" && inviteeIds.length > 0) {
    throw new CommunityChatError(
      "INVALID",
      "Public threads do not use invitation lists"
    );
  }
  if (inviteeIds.length > 50) {
    throw new CommunityChatError(
      "INVALID",
      "Invite up to 50 community members at a time"
    );
  }
  const creatorMembership = await findMembership(
    prisma.orm,
    channel.communityId,
    input.creatorId
  );
  if (creatorMembership?.status !== "ACTIVE") {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Join this community to create a thread"
    );
  }
  const invitedMemberships = inviteeIds.length
    ? await prisma.orm.public.CommunityMembers.select("id", "userId")
        .where((member) =>
          and(
            member.communityId.eq(channel.communityId),
            member.status.eq("ACTIVE"),
            member.userId.in(inviteeIds)
          )
        )
        .all()
    : [];
  if (invitedMemberships.length !== inviteeIds.length) {
    throw new CommunityChatError(
      "INVALID",
      "Private thread invites must be active community members"
    );
  }

  const slug = `thread-${roomId}`;
  const threadSequence = starterPayload ? 1n : 0n;
  const threadChangeSequence = starterPayload ? 1n : 0n;
  let channelChangeSequence: bigint | null;
  try {
    channelChangeSequence = await prisma.transaction(async (transaction) => {
      await transaction.orm.public.CommunityChatRooms.create({
        changeSequence: threadChangeSequence,
        communityId: channel.communityId,
        creatorId: input.creatorId,
        id: roomId,
        kind: "THREAD",
        name,
        nextSequence: threadSequence,
        parentRoomId: channel.id,
        slug,
        sourceMessageId:
          input.visibility === "PUBLIC" ? input.sourceMessageId : null,
        visibility: input.visibility,
      });
      if (input.visibility === "PRIVATE") {
        for (const member of [creatorMembership, ...invitedMemberships]) {
          await transaction.orm.public.CommunityChatRoomMembers.create({
            communityMemberId: member.id,
            invitedById: input.creatorId,
            roomId,
          });
          await transaction.orm.public.CommunityChatSubscriptions.upsert({
            conflictOn: { roomId, userId: member.userId },
            create: { following: true, roomId, userId: member.userId },
            update: { following: true },
          });
        }
      } else {
        await transaction.orm.public.CommunityChatSubscriptions.upsert({
          conflictOn: { roomId, userId: input.creatorId },
          create: { following: true, roomId, userId: input.creatorId },
          update: { following: true },
        });
      }
      if (starterPayload) {
        const messageId = randomUUID();
        await transaction.orm.public.CommunityChatMessages.create({
          changeSequence: threadChangeSequence,
          clientId: input.clientId,
          id: messageId,
          payload: starterPayload,
          roomId,
          senderId: input.creatorId,
          sequence: threadSequence,
        });
        await transaction.orm.public.CommunityChatOutbox.create({
          id: randomUUID(),
          kind: "message.created",
          messageId,
          payload: { messageId, sequence: threadSequence.toString() },
          roomId,
          sequence: threadChangeSequence,
        });
      }
      if (input.visibility === "PUBLIC") {
        const sequence = await appendRoomChange(transaction, {
          kind: "thread.created",
          payload: {
            sourceMessageId: input.sourceMessageId ?? null,
            threadId: roomId,
          },
          roomId: channel.id,
        });
        const otherThread =
          await transaction.orm.public.CommunityChatRooms.select("id")
            .where((candidate) =>
              and(
                candidate.parentRoomId.eq(channel.id),
                candidate.sourceMessageId.eq(input.sourceMessageId ?? ""),
                candidate.id.neq(roomId),
                candidate.archived.eq(false)
              )
            )
            .first();
        if (otherThread)
          {throw new CommunityChatError(
            "CONFLICT",
            "This message already has a public thread"
          );}
        return sequence;
      }
      return null;
    });
  } catch (error) {
    if (isUniqueError(error)) {
      const previous = await roomDataById(prisma.orm, roomId);
      if (previous) {
        await requireRoomAccess(roomId, input.creatorId);
        return mapRoom(previous);
      }
    }
    throw error;
  }
  const created = await roomDataById(prisma.orm, roomId);
  if (!created) {
    throw new Error("Committed community thread could not be read");
  }
  if (starterPayload) {
    try {
      await redis.publish(
        communityChatRedisChannel(roomId),
        JSON.stringify({
          changeSequence: threadChangeSequence.toString(),
          kind: "message.created",
          roomId,
          sequence: threadSequence.toString(),
        })
      );
    } catch (error) {
      logger.warn(
        { error: String(error), roomId },
        "community thread realtime publish failed"
      );
    }
  }
  if (channelChangeSequence !== null) {
    try {
      await redis.publish(
        communityChatRedisChannel(channel.id),
        JSON.stringify({
          changeSequence: channelChangeSequence.toString(),
          kind: "thread.created",
          roomId: channel.id,
          threadId: roomId,
        })
      );
    } catch (error) {
      logger.warn(
        { error: String(error), roomId: channel.id },
        "community thread listing publish failed"
      );
    }
  }
  return mapRoom(created);
}

export async function updateCommunityChatThreadInvitations(input: {
  addUserIds?: string[];
  actorId: string;
  removeUserIds?: string[];
  roomId: string;
}): Promise<void> {
  const room = await roomDataById(prisma.orm, input.roomId);
  if (!room || room.kind !== "THREAD" || room.visibility !== "PRIVATE") {
    throw new CommunityChatError("NOT_FOUND", "Private thread not found");
  }
  const actor = await findMembership(
    prisma.orm,
    room.communityId,
    input.actorId
  );
  if (actor?.status !== "ACTIVE") {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Join this community to manage thread invitations"
    );
  }
  if (room.creatorId !== input.actorId && !isStaff(actor.role)) {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Only the thread creator or staff can manage invitations"
    );
  }
  const addUserIds = [...new Set(input.addUserIds)].filter(
    (userId) => userId !== room.creatorId
  );
  const removeUserIds = [...new Set(input.removeUserIds)].filter(
    (userId) => userId !== room.creatorId
  );
  if (addUserIds.length + removeUserIds.length > 50) {
    throw new CommunityChatError(
      "INVALID",
      "Update up to 50 invitations at a time"
    );
  }

  const addMemberships = addUserIds.length
    ? await prisma.orm.public.CommunityMembers.select("id", "userId")
        .where((member) =>
          and(
            member.communityId.eq(room.communityId),
            member.status.eq("ACTIVE"),
            member.userId.in(addUserIds)
          )
        )
        .all()
    : [];
  if (addMemberships.length !== addUserIds.length) {
    throw new CommunityChatError(
      "INVALID",
      "Invitations are limited to active community members"
    );
  }
  const removeMemberships = removeUserIds.length
    ? await prisma.orm.public.CommunityMembers.select("id", "userId")
        .where((member) =>
          and(
            member.communityId.eq(room.communityId),
            member.userId.in(removeUserIds)
          )
        )
        .all()
    : [];
  const invited = addMemberships.length
    ? await prisma.orm.public.CommunityChatRoomMembers.select(
        "communityMemberId"
      )
        .where((participant) =>
          and(
            participant.roomId.eq(room.id),
            participant.communityMemberId.in(
              addMemberships.map((member) => member.id)
            )
          )
        )
        .all()
    : [];
  const alreadyInvited = new Set(
    invited.map((participant) => participant.communityMemberId)
  );
  const newMemberships = addMemberships.filter(
    (member) => !alreadyInvited.has(member.id)
  );
  const removeIds = removeMemberships.map((member) => member.id);

  const changeSequence = await prisma.transaction(async (transaction) => {
    let changed = 0;
    if (removeIds.length > 0) {
      const removed =
        await transaction.orm.public.CommunityChatRoomMembers.where(
          (participant) =>
            and(
              participant.roomId.eq(room.id),
              participant.communityMemberId.in(removeIds)
            )
        ).deleteAndCount();
      changed += removed;
      await transaction.orm.public.CommunityChatSubscriptions.where((row) =>
        and(row.roomId.eq(room.id), row.userId.in(removeUserIds))
      ).update({ following: false, updatedAt: toPrismaDateTime(new Date()) });
    }
    for (const member of newMemberships) {
      await transaction.orm.public.CommunityChatRoomMembers.create({
        communityMemberId: member.id,
        invitedById: input.actorId,
        roomId: room.id,
      });
      await transaction.orm.public.CommunityChatSubscriptions.upsert({
        conflictOn: { roomId: room.id, userId: member.userId },
        create: { following: true, roomId: room.id, userId: member.userId },
        update: { following: true },
      });
      changed += 1;
    }
    if (changed === 0) {
      return null;
    }
    return appendRoomChange(transaction, {
      kind: "thread.members.changed",
      payload: { roomId: room.id },
      roomId: room.id,
    });
  });
  if (changeSequence !== null) {
    try {
      await redis.publish(
        communityChatRedisChannel(room.id),
        JSON.stringify({
          changeSequence: changeSequence.toString(),
          kind: "thread.members.changed",
          roomId: room.id,
        })
      );
    } catch (error) {
      logger.warn(
        { error: String(error), roomId: room.id },
        "private thread membership publish failed"
      );
    }
  }
}

function isUniqueError(error: unknown): boolean {
  const databaseError = error as { code?: unknown; sqlState?: unknown } | null;
  return (
    databaseError?.sqlState === "23505" ||
    databaseError?.code === "23505" ||
    databaseError?.code === "P2002"
  );
}

async function findIdempotentMessage(
  roomId: string,
  senderId: string,
  clientId: string
): Promise<CommunityChatMessage | null> {
  const row = await messageQuery(prisma.orm)
    .where((message) =>
      and(
        message.roomId.eq(roomId),
        message.senderId.eq(senderId),
        message.clientId.eq(clientId)
      )
    )
    .first();
  return row ? mapMessage(row) : null;
}

export async function sendCommunityChatMessage(input: {
  clientId: string;
  content: unknown;
  replyToId?: string;
  roomId: string;
  userId: string;
}): Promise<{ message: CommunityChatMessage; replayed: boolean }> {
  const access = await requireRoomAccess(input.roomId, input.userId);
  const room = await roomDataById(prisma.orm, input.roomId);
  if (!room) {
    throw new CommunityChatError("NOT_FOUND", "Chat room not found");
  }
  await checkContributionPolicy({
    communityId: access.communityId,
    room,
    userId: input.userId,
  });
  if (!CLIENT_ID_PATTERN.test(input.clientId)) {
    throw new CommunityChatError("INVALID", "Invalid client message id");
  }
  const payload = parseCommunityChatText(input.content);
  if (payload.type !== "text") {
    throw new CommunityChatError(
      "INVALID",
      "Only text messages are supported here"
    );
  }
  const storedPayload = { content: payload.content, type: "text" as const };

  const previous = await findIdempotentMessage(
    input.roomId,
    input.userId,
    input.clientId
  );
  if (previous) {
    return { message: previous, replayed: true };
  }

  const { replyToId } = input;
  if (replyToId) {
    const replyTarget = await prisma.orm.public.CommunityChatMessages.select(
      "id"
    )
      .where((message) =>
        and(
          message.id.eq(replyToId),
          message.roomId.eq(input.roomId),
          message.deletedAt.isNull()
        )
      )
      .first();
    if (!replyTarget) {
      throw new CommunityChatError("INVALID", "Reply target was not found");
    }
  }

  const messageId = randomUUID();
  let replayed = false;
  let messageSequence = 0n;
  let changeSequence = 0n;
  try {
    await prisma.transaction(async (transaction) => {
      const existing =
        await transaction.orm.public.CommunityChatMessages.select(
          "id",
          "sequence",
          "changeSequence"
        )
          .where((message) =>
            and(
              message.roomId.eq(room.id),
              message.senderId.eq(input.userId),
              message.clientId.eq(input.clientId)
            )
          )
          .first();
      if (existing) {
        replayed = true;
        messageSequence = existing.sequence;
        ({ sequence: messageSequence, changeSequence } = existing);
        return;
      }

      let claimed: { nextSequence: bigint; changeSequence: bigint } | null =
        null;
      for (let attempt = 0; attempt < MAX_ROOM_CLAIMS; attempt += 1) {
        const state = await transaction.orm.public.CommunityChatRooms.select(
          "changeSequence",
          "nextSequence"
        )
          .where({ id: room.id })
          .first();
        if (!state) {
          throw new CommunityChatError("NOT_FOUND", "Chat room not found");
        }
        const nextSequence = state.nextSequence + 1n;
        const nextChangeSequence = state.changeSequence + 1n;
        const updated = await transaction.orm.public.CommunityChatRooms.where(
          (candidate) =>
            and(
              candidate.id.eq(room.id),
              candidate.nextSequence.eq(state.nextSequence),
              candidate.changeSequence.eq(state.changeSequence)
            )
        ).updateAndCount({
          changeSequence: nextChangeSequence,
          nextSequence,
          updatedAt: toPrismaDateTime(new Date()),
        });
        if (updated === 1) {
          claimed = {
            changeSequence: nextChangeSequence,
            nextSequence,
          };
          break;
        }
      }
      if (!claimed) {
        throw new CommunityChatError(
          "CONFLICT",
          "The channel is busy. Retry your message"
        );
      }

      ({ nextSequence: messageSequence, changeSequence } = claimed);
      const currentRoom = await roomDataById(transaction.orm, room.id);
      if (!currentRoom) {
        throw new CommunityChatError("NOT_FOUND", "Channel not found");
      }
      await checkContributionPolicy(
        {
          communityId: access.communityId,
          room: currentRoom,
          userId: input.userId,
        },
        transaction.orm
      );
      if (currentRoom.slowModeSeconds > 0) {
        const lastMessage =
          await transaction.orm.public.CommunityChatMessages.select("createdAt")
            .where((message) =>
              and(message.roomId.eq(room.id), message.senderId.eq(input.userId))
            )
            .orderBy((message) => message.sequence.desc())
            .first();
        if (
          lastMessage &&
          Date.now() - fromPrismaDateTime(lastMessage.createdAt).getTime() <
            currentRoom.slowModeSeconds * 1000
        ) {
          throw new CommunityChatError(
            "SLOW_MODE",
            `Slow mode allows one message every ${currentRoom.slowModeSeconds} seconds`
          );
        }
      }
      await transaction.orm.public.CommunityChatMessages.create({
        changeSequence,
        clientId: input.clientId,
        id: messageId,
        payload: storedPayload,
        replyToId: replyToId ?? null,
        roomId: room.id,
        senderId: input.userId,
        sequence: messageSequence,
      });
      if (room.kind === "THREAD") {
        await transaction.orm.public.CommunityChatSubscriptions.upsert({
          conflictOn: { roomId: room.id, userId: input.userId },
          create: { following: true, roomId: room.id, userId: input.userId },
          update: { following: true },
        });
      }
      await transaction.orm.public.CommunityChatOutbox.create({
        id: randomUUID(),
        kind: "message.created",
        messageId,
        payload: {
          messageId,
          sequence: messageSequence.toString(),
        },
        roomId: room.id,
        sequence: changeSequence,
      });
    });
  } catch (error) {
    if (isUniqueError(error)) {
      const existingMessage = await findIdempotentMessage(
        input.roomId,
        input.userId,
        input.clientId
      );
      if (existingMessage) {
        return { message: existingMessage, replayed: true };
      }
    }
    throw error;
  }

  const row = await messageQuery(prisma.orm)
    .where((message) =>
      and(
        message.roomId.eq(room.id),
        message.senderId.eq(input.userId),
        message.clientId.eq(input.clientId)
      )
    )
    .first();
  if (!row) {
    throw new Error("Committed community chat message could not be read");
  }
  const [message] = await hydrateChatMessages(
    [mapMessage(row)],
    access.communityId,
    input.userId
  );
  if (!message) {
    throw new Error("Committed community chat message could not be hydrated");
  }
  if (replayed) {
    return { message, replayed: true };
  }
  const event = {
    changeSequence: changeSequence.toString(),
    kind: "message.created",
    message: {
      ...message,
      reactions: message.reactions?.map((reaction) => ({
        ...reaction,
        reacted: false,
      })),
    },
    messageId: message.id,
    roomId: room.id,
    sequence: messageSequence.toString(),
  };
  try {
    await redis.publish(
      communityChatRedisChannel(room.id),
      JSON.stringify(event)
    );
  } catch (error) {
    logger.warn(
      {
        error: String(error),
        roomId: room.id,
        sequence: messageSequence.toString(),
      },
      "community chat realtime publish failed"
    );
  }
  return { message, replayed: false };
}

async function appendRoomChange(
  transaction: PrismaTransaction,
  input: {
    kind: string;
    messageId?: string | null;
    payload: Record<string, string | number | boolean | null>;
    roomId: string;
  }
): Promise<bigint> {
  for (let attempt = 0; attempt < MAX_ROOM_CLAIMS; attempt += 1) {
    const current = await transaction.orm.public.CommunityChatRooms.select(
      "changeSequence"
    )
      .where({ id: input.roomId })
      .first();
    if (!current) {
      throw new CommunityChatError("NOT_FOUND", "Chat room not found");
    }
    const sequence = current.changeSequence + 1n;
    const changed = await transaction.orm.public.CommunityChatRooms.where(
      (room) =>
        and(
          room.id.eq(input.roomId),
          room.changeSequence.eq(current.changeSequence)
        )
    ).updateAndCount({
      changeSequence: sequence,
      updatedAt: toPrismaDateTime(new Date()),
    });
    if (changed !== 1) {
      continue;
    }
    await transaction.orm.public.CommunityChatOutbox.create({
      id: randomUUID(),
      kind: input.kind,
      messageId: input.messageId ?? null,
      payload: input.payload,
      roomId: input.roomId,
      sequence,
    });
    return sequence;
  }
  throw new CommunityChatError(
    "CONFLICT",
    "This room is busy. Retry the action"
  );
}

export async function mutateCommunityChatMessage(input: {
  actorId: string;
  content?: unknown;
  expectedRevision: number;
  messageId: string;
  operation: "DELETE" | "EDIT";
}): Promise<CommunityChatMessage> {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new CommunityChatError("INVALID", "Invalid message revision");
  }
  const existing = await messageQuery(prisma.orm)
    .where((message) => message.id.eq(input.messageId))
    .first();
  if (!existing) {
    throw new CommunityChatError("NOT_FOUND", "Message not found");
  }
  const room = await roomDataById(prisma.orm, existing.roomId);
  if (!room) {
    throw new CommunityChatError("NOT_FOUND", "Message not found");
  }
  const access = await requireRoomAccess(room.id, input.actorId);
  const membership = await findMembership(
    prisma.orm,
    access.communityId,
    input.actorId
  );
  const staff = membership?.status === "ACTIVE" && isStaff(membership.role);
  if (membership?.status !== "ACTIVE") {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Join this community to manage messages"
    );
  }
  if (input.operation === "EDIT" && existing.senderId !== input.actorId) {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Only the message author can edit this message"
    );
  }
  if (input.operation === "EDIT") {
    await checkContributionPolicy({
      communityId: access.communityId,
      room,
      userId: input.actorId,
    });
  }
  if (
    input.operation === "DELETE" &&
    existing.senderId !== input.actorId &&
    !staff
  ) {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Only the author or community staff can remove this message"
    );
  }
  if (existing.deletedAt) {
    throw new CommunityChatError(
      "CONFLICT",
      "This message was already removed"
    );
  }
  if (existing.revision !== input.expectedRevision) {
    throw new CommunityChatError(
      "CONFLICT",
      "This message changed. Refresh before trying again"
    );
  }
  const payload =
    input.operation === "EDIT" ? parseCommunityChatText(input.content) : null;
  if (payload && payload.type !== "text") {
    throw new CommunityChatError(
      "INVALID",
      "Only text messages are supported here"
    );
  }
  const nextRevision = existing.revision + 1;
  const messageKind =
    input.operation === "EDIT" ? "message.edited" : "message.deleted";
  let changeSequence = 0n;
  await prisma.transaction(async (transaction) => {
    const current = await transaction.orm.public.CommunityChatMessages.select(
      "deletedAt",
      "revision"
    )
      .where({ id: input.messageId })
      .first();
    if (
      !current ||
      current.deletedAt ||
      current.revision !== input.expectedRevision
    ) {
      throw new CommunityChatError(
        "CONFLICT",
        "This message changed. Refresh before trying again"
      );
    }
    changeSequence = await appendRoomChange(transaction, {
      kind: messageKind,
      messageId: input.messageId,
      payload: { messageId: input.messageId, revision: nextRevision },
      roomId: room.id,
    });
    const updated = await transaction.orm.public.CommunityChatMessages.where(
      (message) =>
        and(
          message.id.eq(input.messageId),
          message.revision.eq(input.expectedRevision),
          message.deletedAt.isNull()
        )
    ).updateAndCount({
      ...(payload ? { payload } : {}),
      ...(input.operation === "DELETE"
        ? { deletedAt: toPrismaDateTime(new Date()) }
        : { editedAt: toPrismaDateTime(new Date()) }),
      changeSequence,
      revision: nextRevision,
    });
    if (updated !== 1) {
      throw new CommunityChatError(
        "CONFLICT",
        "This message changed. Refresh before trying again"
      );
    }
  });
  const updated = await messageQuery(prisma.orm)
    .where((message) => message.id.eq(input.messageId))
    .first();
  if (!updated) {
    throw new Error("Committed community message update could not be read");
  }
  const [message] = await hydrateChatMessages(
    [mapMessage(updated)],
    room.communityId,
    input.actorId
  );
  if (!message) {
    throw new Error("Committed community chat message could not be hydrated");
  }
  try {
    await redis.publish(
      communityChatRedisChannel(room.id),
      JSON.stringify({
        changeSequence: changeSequence.toString(),
        kind: messageKind,
        messageId: message.id,
        roomId: room.id,
        sequence: message.sequence,
      })
    );
  } catch (error) {
    logger.warn(
      { error: String(error), messageId: message.id, roomId: room.id },
      "community chat message update publish failed"
    );
  }
  return message;
}

export async function setCommunityChatReaction(input: {
  actorId: string;
  emoji: string;
  messageId: string;
  reacted: boolean;
  roomId: string;
}): Promise<{ changed: boolean }> {
  const emoji = input.emoji.trim();
  if (!(await isMessageReactionEmoji(emoji))) {
    throw new CommunityChatError(
      "INVALID",
      "Choose a supported emoji reaction"
    );
  }
  const message = await prisma.orm.public.CommunityChatMessages.select("roomId")
    .where((row) =>
      and(
        row.id.eq(input.messageId),
        row.roomId.eq(input.roomId),
        row.deletedAt.isNull()
      )
    )
    .first();
  if (!message) {
    throw new CommunityChatError("NOT_FOUND", "Message not found");
  }
  const access = await requireRoomAccess(message.roomId, input.actorId);
  const room = await roomDataById(prisma.orm, message.roomId);
  if (!room) {
    throw new CommunityChatError("NOT_FOUND", "Message not found");
  }
  await checkContributionPolicy({
    communityId: access.communityId,
    room,
    userId: input.actorId,
  });
  const existing = await prisma.orm.public.CommunityChatReactions.where(
    (reaction) =>
      and(
        reaction.messageId.eq(input.messageId),
        reaction.userId.eq(input.actorId),
        reaction.emoji.eq(emoji)
      )
  ).first();
  if (input.reacted === Boolean(existing)) {
    return { changed: false };
  }

  let changeSequence: bigint | null;
  try {
    changeSequence = await prisma.transaction(async (transaction) => {
      if (input.reacted) {
        await transaction.orm.public.CommunityChatReactions.create({
          emoji,
          messageId: input.messageId,
          userId: input.actorId,
        });
      } else {
        const removed =
          await transaction.orm.public.CommunityChatReactions.where(
            (reaction) =>
              and(
                reaction.messageId.eq(input.messageId),
                reaction.userId.eq(input.actorId),
                reaction.emoji.eq(emoji)
              )
          ).deleteAndCount();
        if (removed === 0) {
          return null;
        }
      }
      const sequence = await appendRoomChange(transaction, {
        kind: "message.reacted",
        messageId: input.messageId,
        payload: {
          emoji,
          messageId: input.messageId,
          reacted: input.reacted,
          userId: input.actorId,
        },
        roomId: message.roomId,
      });
      const distinct = await rawQuery<{ count: number }>(
        'SELECT count(DISTINCT emoji)::integer AS count FROM public.community_chat_reactions WHERE "messageId" = $1',
        [input.messageId],
        { count: "pg/int4@1" },
        transaction
      );
      if ((distinct.rows[0]?.count ?? 0) > 20) {
        throw new CommunityChatError(
          "INVALID",
          "This message already has 20 different reactions"
        );
      }
      const updated = await transaction.orm.public.CommunityChatMessages.where(
        (row) => and(row.id.eq(input.messageId), row.deletedAt.isNull())
      ).updateAndCount({ changeSequence: sequence });
      if (updated !== 1) {
        throw new CommunityChatError("NOT_FOUND", "Message not found");
      }
      return sequence;
    });
  } catch (error) {
    if (input.reacted && isUniqueError(error)) {
      return { changed: false };
    }
    throw error;
  }
  if (changeSequence === null) {
    return { changed: false };
  }
  try {
    await redis.publish(
      communityChatRedisChannel(message.roomId),
      JSON.stringify({
        changeSequence: changeSequence.toString(),
        emoji,
        kind: "message.reacted",
        messageId: input.messageId,
        reacted: input.reacted,
        roomId: message.roomId,
        userId: input.actorId,
      })
    );
  } catch (error) {
    logger.warn(
      { error: String(error), roomId: message.roomId },
      "community reaction publish failed"
    );
  }
  return { changed: true };
}

export async function setCommunityChatPin(input: {
  actorId: string;
  messageId: string;
  pinned: boolean;
  roomId: string;
}): Promise<{ pinned: boolean }> {
  const access = await requireRoomAccess(input.roomId, input.actorId);
  const membership = await findMembership(
    prisma.orm,
    access.communityId,
    input.actorId
  );
  if (membership?.status !== "ACTIVE" || !isStaff(membership.role)) {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Only community staff can manage pins"
    );
  }
  const message = await prisma.orm.public.CommunityChatMessages.select("id")
    .where((row) =>
      and(
        row.id.eq(input.messageId),
        row.roomId.eq(input.roomId),
        row.deletedAt.isNull()
      )
    )
    .first();
  if (!message) {
    throw new CommunityChatError("NOT_FOUND", "Message not found");
  }
  const existing = await prisma.orm.public.CommunityChatPins.where((pin) =>
    and(pin.roomId.eq(input.roomId), pin.messageId.eq(input.messageId))
  ).first();
  if (input.pinned === Boolean(existing)) {
    return { pinned: input.pinned };
  }

  let changeSequence: bigint | null;
  try {
    changeSequence = await prisma.transaction(async (transaction) => {
      if (input.pinned) {
        await transaction.orm.public.CommunityChatPins.create({
          messageId: input.messageId,
          pinnedById: input.actorId,
          roomId: input.roomId,
        });
      } else {
        const removed = await transaction.orm.public.CommunityChatPins.where(
          (pin) =>
            and(pin.roomId.eq(input.roomId), pin.messageId.eq(input.messageId))
        ).deleteAndCount();
        if (removed === 0) {
          return null;
        }
      }
      const sequence = await appendRoomChange(transaction, {
        kind: input.pinned ? "message.pinned" : "message.unpinned",
        messageId: input.messageId,
        payload: { messageId: input.messageId, pinned: input.pinned },
        roomId: input.roomId,
      });
      const updated = await transaction.orm.public.CommunityChatMessages.where(
        (row) => and(row.id.eq(input.messageId), row.deletedAt.isNull())
      ).updateAndCount({ changeSequence: sequence });
      if (updated !== 1) {
        throw new CommunityChatError("NOT_FOUND", "Message not found");
      }
      return sequence;
    });
  } catch (error) {
    if (input.pinned && isUniqueError(error)) {
      return { pinned: true };
    }
    throw error;
  }
  if (changeSequence === null) {
    return { pinned: false };
  }
  try {
    await redis.publish(
      communityChatRedisChannel(input.roomId),
      JSON.stringify({
        changeSequence: changeSequence.toString(),
        kind: input.pinned ? "message.pinned" : "message.unpinned",
        messageId: input.messageId,
        roomId: input.roomId,
      })
    );
  } catch (error) {
    logger.warn(
      { error: String(error), roomId: input.roomId },
      "community pin publish failed"
    );
  }
  return { pinned: input.pinned };
}

export async function listCommunityChatPins(input: {
  limit?: number;
  roomId: string;
  userId: string;
}): Promise<CommunityChatMessage[]> {
  const access = await requireRoomAccess(input.roomId, input.userId);
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 50), 50));
  const pins = await prisma.orm.public.CommunityChatPins.select("messageId")
    .where({ roomId: input.roomId })
    .orderBy((pin) => pin.createdAt.desc())
    .limit(limit)
    .all();
  const messageIds = pins.map((pin) => pin.messageId);
  if (messageIds.length === 0) {
    return [];
  }
  const rows = await messageQuery(prisma.orm)
    .where((message) =>
      and(
        message.id.in(messageIds),
        message.roomId.eq(input.roomId),
        message.deletedAt.isNull()
      )
    )
    .all();
  const hydrated = await hydrateChatMessages(
    rows.map(mapMessage),
    access.communityId,
    input.userId
  );
  const byId = new Map(hydrated.map((message) => [message.id, message]));
  return pins.flatMap(({ messageId }) => {
    const message = byId.get(messageId);
    return message ? [message] : [];
  });
}

export async function advanceCommunityChatReadState(input: {
  readSequence: string;
  roomId: string;
  userId: string;
}): Promise<{ readSequence: string }> {
  const access = await requireRoomAccess(input.roomId, input.userId);
  if (!access.permissions.isMember) {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Join this community to save read state"
    );
  }
  const sequence = parseSequence(input.readSequence) ?? 0n;
  const room = await roomDataById(prisma.orm, input.roomId);
  if (!room || sequence > room.nextSequence) {
    throw new CommunityChatError(
      "INVALID",
      "Read position is outside this room"
    );
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await prisma.orm.public.CommunityChatReadStates.select(
      "readSequence"
    )
      .where((state) =>
        and(state.roomId.eq(input.roomId), state.userId.eq(input.userId))
      )
      .first();
    if (existing && existing.readSequence >= sequence) {
      return { readSequence: existing.readSequence.toString() };
    }
    try {
      if (existing) {
        const updated = await prisma.orm.public.CommunityChatReadStates.where(
          (state) =>
            and(
              state.roomId.eq(input.roomId),
              state.userId.eq(input.userId),
              state.readSequence.eq(existing.readSequence)
            )
        ).updateAndCount({
          readSequence: sequence,
          updatedAt: toPrismaDateTime(new Date()),
        });
        if (updated !== 1) {
          continue;
        }
      } else {
        await prisma.orm.public.CommunityChatReadStates.create({
          readSequence: sequence,
          roomId: input.roomId,
          userId: input.userId,
        });
      }
      return { readSequence: sequence.toString() };
    } catch (error) {
      if (!isUniqueError(error) || attempt === 2) {
        throw error;
      }
    }
  }
  const latest = await prisma.orm.public.CommunityChatReadStates.select(
    "readSequence"
  )
    .where((state) =>
      and(state.roomId.eq(input.roomId), state.userId.eq(input.userId))
    )
    .first();
  return {
    readSequence: latest?.readSequence.toString() ?? sequence.toString(),
  };
}

export async function setCommunityChatMuted(input: {
  communityId: string;
  muted: boolean;
  userId: string;
}): Promise<{ muted: boolean }> {
  const membership = await findMembership(
    prisma.orm,
    input.communityId,
    input.userId
  );
  if (membership?.status !== "ACTIVE") {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Join this community to change chat preferences"
    );
  }
  const mutedAt = input.muted ? toPrismaDateTime(new Date()) : null;
  await prisma.orm.public.CommunityChatPreferences.upsert({
    conflictOn: { communityId: input.communityId, userId: input.userId },
    create: {
      communityId: input.communityId,
      mutedAt,
      userId: input.userId,
    },
    update: { mutedAt, updatedAt: toPrismaDateTime(new Date()) },
  });
  return { muted: input.muted };
}

export async function getCommunityChatThreadFollowing(input: {
  actorId: string;
  threadId: string;
}): Promise<{ following: boolean }> {
  const access = await requireRoomAccess(input.threadId, input.actorId);
  if (access.room.kind !== "THREAD" || !access.permissions.isMember) {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Join the community to follow threads"
    );
  }
  const subscription =
    await prisma.orm.public.CommunityChatSubscriptions.select("following")
      .where((row) =>
        and(row.roomId.eq(input.threadId), row.userId.eq(input.actorId))
      )
      .first();
  return { following: Boolean(subscription?.following) };
}

export async function setCommunityChatThreadFollowing(input: {
  actorId: string;
  following: boolean;
  threadId: string;
}): Promise<{ following: boolean }> {
  const access = await requireRoomAccess(input.threadId, input.actorId);
  if (access.room.kind !== "THREAD" || !access.permissions.isMember) {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Join the community to follow threads"
    );
  }
  await prisma.orm.public.CommunityChatSubscriptions.upsert({
    conflictOn: { roomId: input.threadId, userId: input.actorId },
    create: {
      following: input.following,
      roomId: input.threadId,
      userId: input.actorId,
    },
    update: {
      following: input.following,
      updatedAt: toPrismaDateTime(new Date()),
    },
  });
  return { following: input.following };
}

export async function getCommunityChatMuted(input: {
  communityId: string;
  userId: string;
}): Promise<{ muted: boolean }> {
  const membership = await findMembership(
    prisma.orm,
    input.communityId,
    input.userId
  );
  if (membership?.status !== "ACTIVE") {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Join this community to view chat preferences"
    );
  }
  const preference = await prisma.orm.public.CommunityChatPreferences.select(
    "mutedAt"
  )
    .where((row) =>
      and(row.communityId.eq(input.communityId), row.userId.eq(input.userId))
    )
    .first();
  return { muted: Boolean(preference?.mutedAt) };
}

export async function createCommunityChatChannel(input: {
  channelType: "ANNOUNCEMENT" | "TEXT";
  communityId: string;
  creatorId: string;
  name: string;
  topic?: string;
}): Promise<CommunityChatRoom> {
  const membership = await findMembership(
    prisma.orm,
    input.communityId,
    input.creatorId
  );
  if (membership?.status !== "ACTIVE" || !isStaff(membership.role)) {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Only community staff can manage channels"
    );
  }
  const name = input.name.trim();
  if (name.length < 1 || name.length > 64) {
    throw new CommunityChatError(
      "INVALID",
      "Channel names must be 1 to 64 characters"
    );
  }
  const slug = normalizeRoomSlug(name);
  if (!slug) {
    throw new CommunityChatError(
      "INVALID",
      "Choose a channel name with letters or numbers"
    );
  }
  const existing = await prisma.orm.public.CommunityChatRooms.where((room) =>
    and(room.communityId.eq(input.communityId), room.slug.eq(slug))
  ).first();
  if (existing) {
    throw new CommunityChatError(
      "CONFLICT",
      "A channel with that name already exists"
    );
  }
  const sort = await prisma.orm.public.CommunityChatRooms.where((room) =>
    and(room.communityId.eq(input.communityId), room.kind.eq("CHANNEL"))
  ).aggregate((aggregate) => ({ count: aggregate.count() }));
  const created = await prisma.orm.public.CommunityChatRooms.create({
    channelType: input.channelType,
    communityId: input.communityId,
    creatorId: input.creatorId,
    kind: "CHANNEL",
    name,
    slug,
    sortOrder: sort.count,
    topic: input.topic?.trim().slice(0, 160) || null,
    visibility: "PUBLIC",
  });
  return mapRoom(created as RoomData);
}

export async function updateCommunityChatChannel(input: {
  actorId: string;
  channelId: string;
  update: {
    archived?: boolean;
    channelType?: "ANNOUNCEMENT" | "TEXT";
    locked?: boolean;
    name?: string;
    slowModeSeconds?: number;
    sortOrder?: number;
    topic?: string | null;
  };
}): Promise<CommunityChatRoom> {
  const room = await roomDataById(prisma.orm, input.channelId);
  if (!room || room.kind !== "CHANNEL") {
    throw new CommunityChatError("NOT_FOUND", "Chat channel not found");
  }
  const actor = await findMembership(
    prisma.orm,
    room.communityId,
    input.actorId
  );
  if (actor?.status !== "ACTIVE" || !isStaff(actor.role)) {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Only community staff can manage channels"
    );
  }
  const update: {
    archived?: boolean;
    channelType?: "ANNOUNCEMENT" | "TEXT";
    locked?: boolean;
    name?: string;
    slug?: string;
    slowModeSeconds?: number;
    sortOrder?: number;
    topic?: string | null;
  } = {};
  if (input.update.name !== undefined) {
    const name = input.update.name.trim();
    const slug = normalizeRoomSlug(name);
    if (name.length < 1 || name.length > 64 || !slug) {
      throw new CommunityChatError(
        "INVALID",
        "Channel names must be 1 to 64 characters"
      );
    }
    const collision = await prisma.orm.public.CommunityChatRooms.where(
      (candidate) =>
        and(
          candidate.communityId.eq(room.communityId),
          candidate.slug.eq(slug),
          candidate.id.neq(room.id)
        )
    ).first();
    if (collision) {
      throw new CommunityChatError(
        "CONFLICT",
        "A room with that name already exists"
      );
    }
    update.name = name;
    update.slug = slug;
  }
  if (input.update.topic !== undefined) {
    if (input.update.topic !== null && input.update.topic.length > 160) {
      throw new CommunityChatError(
        "INVALID",
        "Room topics can be at most 160 characters"
      );
    }
    update.topic = input.update.topic?.trim() || null;
  }
  if (input.update.channelType !== undefined) {
    update.channelType = input.update.channelType;
  }
  if (input.update.locked !== undefined) {
    update.locked = input.update.locked;
  }
  if (input.update.archived !== undefined) {
    update.archived = input.update.archived;
  }
  if (input.update.sortOrder !== undefined) {
    if (
      !Number.isInteger(input.update.sortOrder) ||
      input.update.sortOrder < 0 ||
      input.update.sortOrder > 10_000
    ) {
      throw new CommunityChatError("INVALID", "Channel order is out of range");
    }
    update.sortOrder = input.update.sortOrder;
  }
  if (input.update.slowModeSeconds !== undefined) {
    if (
      !Number.isInteger(input.update.slowModeSeconds) ||
      input.update.slowModeSeconds < 0 ||
      input.update.slowModeSeconds > 21_600
    ) {
      throw new CommunityChatError(
        "INVALID",
        "Slow mode must be between 0 and 21,600 seconds"
      );
    }
    update.slowModeSeconds = input.update.slowModeSeconds;
  }
  if (Object.keys(update).length === 0) {
    throw new CommunityChatError(
      "INVALID",
      "Choose a channel setting to update"
    );
  }
  const changeSequence = await prisma.transaction(async (transaction) => {
    await transaction.orm.public.CommunityChatRooms.where({
      id: room.id,
    }).update(update);
    return appendRoomChange(transaction, {
      kind: "room.updated",
      payload: { roomId: room.id },
      roomId: room.id,
    });
  });
  const updated = await roomDataById(prisma.orm, room.id);
  if (!updated) {
    throw new CommunityChatError("NOT_FOUND", "Chat channel not found");
  }
  try {
    await redis.publish(
      communityChatRedisChannel(room.id),
      JSON.stringify({
        changeSequence: changeSequence.toString(),
        kind: "room.updated",
        roomId: room.id,
      })
    );
  } catch (error) {
    logger.warn(
      { error: String(error), roomId: room.id },
      "community channel update publish failed"
    );
  }
  return mapRoom(updated);
}

export async function updateCommunityChatThreadState(input: {
  actorId: string;
  archived?: boolean;
  locked?: boolean;
  threadId: string;
}): Promise<CommunityChatRoom> {
  const room = await roomDataById(prisma.orm, input.threadId);
  if (!room || room.kind !== "THREAD") {
    throw new CommunityChatError("NOT_FOUND", "Thread not found");
  }
  const membership = await findMembership(
    prisma.orm,
    room.communityId,
    input.actorId
  );
  if (membership?.status !== "ACTIVE" || !isStaff(membership.role)) {
    throw new CommunityChatError(
      "FORBIDDEN",
      "Only community staff can lock or archive threads"
    );
  }
  const update: { archived?: boolean; locked?: boolean } = {};
  if (input.locked !== undefined) {
    update.locked = input.locked;
  }
  if (input.archived !== undefined) {
    update.archived = input.archived;
  }
  if (Object.keys(update).length === 0) {
    throw new CommunityChatError(
      "INVALID",
      "Choose a thread setting to update"
    );
  }
  const changeSequence = await prisma.transaction(async (transaction) => {
    await transaction.orm.public.CommunityChatRooms.where({
      id: room.id,
    }).update(update);
    return appendRoomChange(transaction, {
      kind: "thread.updated",
      payload: { roomId: room.id },
      roomId: room.id,
    });
  });
  const updated = await roomDataById(prisma.orm, room.id);
  if (!updated) {
    throw new CommunityChatError("NOT_FOUND", "Thread not found");
  }
  try {
    await redis.publish(
      communityChatRedisChannel(room.id),
      JSON.stringify({
        changeSequence: changeSequence.toString(),
        kind: "thread.updated",
        roomId: room.id,
      })
    );
  } catch (error) {
    logger.warn(
      { error: String(error), roomId: room.id },
      "community thread update publish failed"
    );
  }
  return mapRoom(updated);
}

export async function getCommunityChatRoomChanges(input: {
  afterChangeSequence: string;
  limit?: number;
  roomId: string;
  userId: string;
}) {
  const access = await requireRoomAccess(input.roomId, input.userId);
  const after = parseSequence(input.afterChangeSequence) ?? 0n;
  const limit = Math.max(
    1,
    Math.min(input.limit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE)
  );
  const rows = await prisma.orm.public.CommunityChatOutbox.select(
    "createdAt",
    "id",
    "kind",
    "messageId",
    "payload",
    "roomId",
    "sequence"
  )
    .where((change) =>
      and(change.roomId.eq(access.room.id), change.sequence.gt(after))
    )
    .orderBy((change) => change.sequence.asc())
    .limit(limit + 1)
    .all();
  const selected = rows.slice(0, limit);
  const ids = [
    ...new Set(
      selected.flatMap((row) => (row.messageId ? [row.messageId] : []))
    ),
  ];
  const messageRows = ids.length
    ? await messageQuery(prisma.orm)
        .where((message) =>
          and(message.roomId.eq(input.roomId), message.id.in(ids))
        )
        .all()
    : [];
  const hydrated = await hydrateChatMessages(
    messageRows.map(mapMessage),
    access.communityId,
    input.userId
  );
  const messagesById = new Map(
    hydrated.map((message) => [message.id, message])
  );
  const candidates = selected.map((row) => ({
    changeSequence: row.sequence.toString(),
    kind: row.kind,
    message: row.messageId ? (messagesById.get(row.messageId) ?? null) : null,
    messageId: row.messageId,
    payload: row.payload,
    roomId: row.roomId,
  }));
  const changes: typeof candidates = [];
  let bytes = 0;
  for (const change of candidates) {
    const size = new TextEncoder().encode(JSON.stringify(change)).byteLength;
    if (bytes + size > COMMUNITY_CHAT_HISTORY_BYTE_LIMIT) {
      break;
    }
    changes.push(change);
    bytes += size;
  }
  const hasMore = rows.length > changes.length;
  return {
    changes,
    hasMore,
    nextChangeSequence: changes.at(-1)?.changeSequence ?? after.toString(),
  };
}

export function communityChatRedisChannel(roomId: string): string {
  return `community-chat:room:${roomId}`;
}
