import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import {
  createCommunityChatChannel,
  createCommunityChatThread,
  getCommunityChatMessage,
  getCommunityChatMessages,
  getCommunityChatRoomAccess,
  getCommunityChatRoomChanges,
  joinCommunity,
  leaveCommunity,
  listCommunityChatThreads,
  mutateCommunityChatMessage,
  prisma,
  searchCommunityChatMembers,
  sendCommunityChatMessage,
  setCommunityChatPin,
  setCommunityChatReaction,
  updateCommunityChatChannel,
} from "@asm/db";
import { and, or } from "@prisma/orm-postgres/orm-client";

// oxlint-disable no-await-in-loop, unicorn/no-await-expression-member -- Database fixtures and assertions deliberately exercise ordered service operations.

const run = randomUUID().slice(0, 8);
const owner = `chat-owner-${run}`;
const member = `chat-z-member-${run}`;
const moderator = `chat-mod-${run}`;
const pending = `chat-pending-${run}`;
const outsider = `chat-a-outsider-${run}`;
const slowSender = `chat-slow-${run}`;
const users = [owner, member, moderator, pending, outsider, slowSender];
const communityIds: string[] = [];
let publicCommunityId = "";
let channelId = "";

beforeAll(async () => {
  await Promise.all(
    users.map((id) =>
      prisma.orm.public.Users.create({
        displayName: `needle${run}`,
        email: `${id}@example.test`,
        id,
        username: id,
      })
    )
  );
  for (const type of ["PUBLIC", "RESTRICTED", "PRIVATE"] as const) {
    const community = await prisma.orm.public.Communities.create({
      _type: type,
      activeMemberCount: 4,
      description: "Community chat integration fixture",
      name: `Chat ${type}`,
      ownerId: owner,
      slug: `chat${type.toLowerCase()}${run}`,
    });
    communityIds.push(community.id);
    if (type === "PUBLIC") {
      publicCommunityId = community.id;
    }
    await Promise.all([
      prisma.orm.public.CommunityMembers.create({
        communityId: community.id,
        role: "OWNER",
        status: "ACTIVE",
        userId: owner,
      }),
      prisma.orm.public.CommunityMembers.create({
        communityId: community.id,
        role: "MODERATOR",
        status: "ACTIVE",
        userId: moderator,
      }),
      prisma.orm.public.CommunityMembers.create({
        communityId: community.id,
        role: "PARTICIPANT",
        status: "ACTIVE",
        userId: member,
      }),
      prisma.orm.public.CommunityMembers.create({
        communityId: community.id,
        role: "PARTICIPANT",
        status: "ACTIVE",
        userId: slowSender,
      }),
      prisma.orm.public.CommunityMembers.create({
        communityId: community.id,
        role: "PARTICIPANT",
        status: "PENDING",
        userId: pending,
      }),
    ]);
    const channel = await createCommunityChatChannel({
      channelType: "TEXT",
      communityId: community.id,
      creatorId: owner,
      name: "general",
    });
    if (type === "PUBLIC") {
      channelId = channel.id;
    }
  }
});

afterAll(async () => {
  await prisma.orm.public.AuraLogs.where((log) =>
    or(log.userId.in(users), log.issuerId.in(users))
  ).deleteAndCount();
  await prisma.orm.public.Communities.where((community) =>
    community.id.in(communityIds)
  ).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in(users)
  ).deleteAndCount();
});

function send(
  userId: string,
  content: string,
  roomId = channelId,
  clientId = randomUUID()
) {
  return sendCommunityChatMessage({ clientId, content, roomId, userId });
}

describe("community channel messaging", () => {
  test("enforces guest, pending, active, and staff access across community types", async () => {
    const channels = await prisma.orm.public.CommunityChatRooms.select(
      "id",
      "communityId"
    )
      .where((room) => room.communityId.in(communityIds))
      .all();
    for (const channel of channels) {
      if (channel.communityId === publicCommunityId) {
        expect(
          (await getCommunityChatRoomAccess(channel.id, "")).permissions.canSend
        ).toBe(false);
        expect(
          (await getCommunityChatRoomAccess(channel.id, pending)).permissions
            .writeRestriction
        ).toBe("PENDING");
      } else {
        await expect(
          getCommunityChatRoomAccess(channel.id, "")
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          getCommunityChatRoomAccess(channel.id, pending)
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      expect(
        (await getCommunityChatRoomAccess(channel.id, member)).permissions
          .canSend
      ).toBe(true);
      expect(
        (await getCommunityChatRoomAccess(channel.id, moderator)).permissions
          .canManage
      ).toBe(true);
    }
  });

  test("deduplicates concurrent retries and commits one timeline/outbox entry", async () => {
    const clientId = randomUUID();
    const results = await Promise.all([
      send(member, "Hello community", channelId, clientId),
      send(member, "Hello community", channelId, clientId),
    ]);
    expect(results[0]?.message.id).toBe(results[1]?.message.id);
    const rows = await prisma.orm.public.CommunityChatMessages.where((row) =>
      and(row.roomId.eq(channelId), row.clientId.eq(clientId))
    ).all();
    expect(rows).toHaveLength(1);
    const outbox = await prisma.orm.public.CommunityChatOutbox.where((row) =>
      row.messageId.eq(results[0]?.message.id ?? "")
    ).all();
    expect(outbox).toHaveLength(1);
  });

  test("hydrates reply context, app role badges, reaction summaries, and pins", async () => {
    const root = (await send(owner, "What are you making this week?")).message;
    const reply = (
      await sendCommunityChatMessage({
        clientId: randomUUID(),
        content: "A little garden",
        replyToId: root.id,
        roomId: channelId,
        userId: member,
      })
    ).message;
    await setCommunityChatReaction({
      actorId: member,
      emoji: "👍",
      messageId: root.id,
      reacted: true,
      roomId: channelId,
    });
    await setCommunityChatReaction({
      actorId: moderator,
      emoji: "👍",
      messageId: root.id,
      reacted: true,
      roomId: channelId,
    });
    await setCommunityChatPin({
      actorId: owner,
      messageId: root.id,
      pinned: true,
      roomId: channelId,
    });
    const hydrated = await getCommunityChatMessage({
      messageId: root.id,
      roomId: channelId,
      userId: member,
    });
    expect(hydrated.sender.role).toBe("OWNER");
    expect(hydrated.reactions).toEqual([
      { count: 2, emoji: "👍", reacted: true },
    ]);
    expect(hydrated.pinned).toBe(true);
    const hydratedReply = await getCommunityChatMessage({
      messageId: reply.id,
      roomId: channelId,
      userId: member,
    });
    expect(hydratedReply.replyTo?.content).toBe(
      "What are you making this week?"
    );
    await expect(
      setCommunityChatReaction({
        actorId: member,
        emoji: "arbitrary text",
        messageId: root.id,
        reacted: true,
        roomId: channelId,
      })
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  test("keeps private threads absent from unauthorized listings, changes, and history", async () => {
    const request = {
      channelId,
      clientId: randomUUID(),
      creatorId: member,
      inviteeUserIds: [slowSender],
      name: "Seed swap",
      starterContent: "Private starter",
      visibility: "PRIVATE" as const,
    };
    const [thread, retry] = await Promise.all([
      createCommunityChatThread(request),
      createCommunityChatThread(request),
    ]);
    expect(thread?.id).toBe(retry?.id);
    if (!thread) {throw new Error("Thread was not created");}
    expect(
      (await listCommunityChatThreads(channelId, outsider)).some(
        (entry) => entry.room.id === thread.id
      )
    ).toBe(false);
    expect(
      (await listCommunityChatThreads(channelId, pending)).some(
        (entry) => entry.room.id === thread.id
      )
    ).toBe(false);
    await expect(
      getCommunityChatMessages({ roomId: thread.id, userId: outsider })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await getCommunityChatRoomAccess(thread.id, moderator)).permissions
        .canRead
    ).toBe(true);
    expect(
      (await getCommunityChatRoomAccess(thread.id, slowSender)).permissions
        .canRead
    ).toBe(true);
    const changes = await getCommunityChatRoomChanges({
      afterChangeSequence: "0",
      roomId: channelId,
      userId: outsider,
    });
    expect(JSON.stringify(changes)).not.toContain(thread.id);
    await leaveCommunity(publicCommunityId, slowSender);
    await joinCommunity(publicCommunityId, slowSender);
    await expect(
      getCommunityChatRoomAccess(thread.id, slowSender)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("filters member suggestions before applying the cursor page limit", async () => {
    const page = await searchCommunityChatMembers({
      communityId: publicCommunityId,
      limit: 1,
      query: `needle${run}`,
      userId: member,
    });
    expect(page.members).toHaveLength(1);
    expect(page.members[0]?.id).not.toBe(outsider);
    expect(page.nextCursor).not.toBeNull();
  });

  test("serializes slow-mode sends and explains active timeouts in permissions", async () => {
    await updateCommunityChatChannel({
      actorId: owner,
      channelId,
      update: { slowModeSeconds: 60 },
    });
    const results = await Promise.allSettled([
      send(slowSender, "First"),
      send(slowSender, "Second"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    await updateCommunityChatChannel({
      actorId: owner,
      channelId,
      update: { slowModeSeconds: 0 },
    });
    const sanction = await prisma.orm.public.CommunityChatSanctions.create({
      actorId: owner,
      communityId: publicCommunityId,
      kind: "TIMEOUT",
      userId: member,
    });
    expect(
      (await getCommunityChatRoomAccess(channelId, member)).permissions
        .writeRestriction
    ).toBe("TIMEOUT");
    await expect(send(member, "Not allowed")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.orm.public.CommunityChatSanctions.where({
      id: sanction.id,
    }).deleteAndCount();
  });

  test("lands around a permalink and rejects stale edits or reactions to tombstones", async () => {
    const root = (await send(member, "A permalink target")).message;
    await send(owner, "A later message");
    const page = await getCommunityChatMessages({
      aroundMessageId: root.id,
      limit: 4,
      roomId: channelId,
      userId: member,
    });
    expect(page.messages.some((entry) => entry.id === root.id)).toBe(true);
    const deleted = await mutateCommunityChatMessage({
      actorId: owner,
      expectedRevision: root.revision,
      messageId: root.id,
      operation: "DELETE",
    });
    expect(deleted.payload).toBeNull();
    await expect(
      mutateCommunityChatMessage({
        actorId: member,
        content: "Stale",
        expectedRevision: root.revision,
        messageId: root.id,
        operation: "EDIT",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      setCommunityChatReaction({
        actorId: member,
        emoji: "👍",
        messageId: root.id,
        reacted: true,
        roomId: channelId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("caps UTF-8 history bytes and retains a usable pagination boundary", async () => {
    const channel = await createCommunityChatChannel({
      channelType: "TEXT",
      communityId: publicCommunityId,
      creatorId: owner,
      name: "long-history",
    });
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        prisma.orm.public.CommunityChatMessages.create({
          changeSequence: BigInt(index + 1),
          payload: { content: "界".repeat(4000), type: "text" },
          roomId: channel.id,
          senderId: owner,
          sequence: BigInt(index + 1),
        })
      )
    );
    await prisma.orm.public.CommunityChatRooms.where({ id: channel.id }).update(
      { changeSequence: 100n, nextSequence: 100n }
    );
    const page = await getCommunityChatMessages({
      limit: 100,
      roomId: channel.id,
      userId: member,
    });
    expect(
      new TextEncoder().encode(JSON.stringify(page)).byteLength
    ).toBeLessThanOrEqual(1024 * 1024);
    expect(page.messages.length).toBeLessThan(100);
    expect(page.nextBeforeSequence).not.toBeNull();
    const older = await getCommunityChatMessages({
      beforeSequence: page.nextBeforeSequence ?? "",
      limit: 100,
      roomId: channel.id,
      userId: member,
    });
    expect(BigInt(older.messages.at(-1)?.sequence ?? "0") + 1n).toBe(
      BigInt(page.messages[0]?.sequence ?? "0")
    );
    await expect(
      getCommunityChatMessages({
        beforeSequence: "99999999999999999999",
        roomId: channel.id,
        userId: member,
      })
    ).rejects.toMatchObject({ code: "INVALID" });
  });
});
