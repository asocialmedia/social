import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { getCommunityChatInbox, prisma, toPrismaDateTime } from "@asm/db";

const run = randomUUID().slice(0, 8);
const owner = `inbox-owner-${run}`;
const viewer = `inbox-viewer-${run}`;
const pending = `inbox-pending-${run}`;
const communities: string[] = [];

beforeAll(async () => {
  await Promise.all(
    [owner, viewer, pending].map((id) =>
      prisma.orm.public.Users.create({
        displayName: id,
        email: `${id}@example.test`,
        id,
        username: id,
      })
    )
  );
});

afterAll(async () => {
  await prisma.orm.public.Communities.where((c) =>
    c.id.in(communities)
  ).deleteAndCount();
  await prisma.orm.public.Users.where((u) =>
    u.id.in([owner, viewer, pending])
  ).deleteAndCount();
});

async function fixture() {
  const community = await prisma.orm.public.Communities.create({
    _type: "PRIVATE",
    activeMemberCount: 2,
    description: "Inbox privacy fixture",
    name: "Inbox fixture",
    ownerId: owner,
    slug: `inbox${randomUUID().replaceAll("-", "")}`,
  });
  communities.push(community.id);
  const [membership] = await Promise.all([
    prisma.orm.public.CommunityMembers.create({
      communityId: community.id,
      role: "PARTICIPANT",
      status: "ACTIVE",
      userId: viewer,
    }),
    prisma.orm.public.CommunityMembers.create({
      communityId: community.id,
      role: "OWNER",
      status: "ACTIVE",
      userId: owner,
    }),
    prisma.orm.public.CommunityMembers.create({
      communityId: community.id,
      role: "PARTICIPANT",
      status: "PENDING",
      userId: pending,
    }),
  ]);
  const room = await prisma.orm.public.CommunityChatRooms.create({
    channelType: "TEXT",
    communityId: community.id,
    creatorId: owner,
    kind: "CHANNEL",
    name: "general",
    nextSequence: 1n,
    slug: "general",
  });
  return { community, membership, room };
}

function message(roomId: string, senderId = owner, sequence = 1n) {
  return prisma.orm.public.CommunityChatMessages.create({
    changeSequence: sequence,
    payload: { text: "Fixture message", type: "text" },
    roomId,
    senderId,
    sequence,
  });
}

async function inboxEntry(communityId: string) {
  const entries = await getCommunityChatInbox(viewer);
  return entries.find((entry) => entry.community.id === communityId);
}

async function hasUnread(communityId: string) {
  const entry = await inboxEntry(communityId);
  return entry?.hasUnread;
}

test("unread dots follow 64-bit private read watermarks, without marking content read by listing", async () => {
  const { community, room } = await fixture();
  const sequence = 9_007_199_254_740_993n;
  await prisma.orm.public.CommunityChatRooms.where({ id: room.id }).update({
    nextSequence: sequence,
  });
  await message(room.id, owner, sequence);
  expect(await hasUnread(community.id)).toBe(true);
  expect(await hasUnread(community.id)).toBe(true);
  await prisma.orm.public.CommunityChatReadStates.create({
    readSequence: sequence,
    roomId: room.id,
    userId: viewer,
  });
  expect(await hasUnread(community.id)).toBe(false);
  const pendingInbox = await getCommunityChatInbox(pending);
  expect(
    pendingInbox.some((entry) => entry.community.id === community.id)
  ).toBe(false);
});

test("private-thread activity requires an invitation or staff role and respects parent archival", async () => {
  const { community, room, membership } = await fixture();
  const thread = await prisma.orm.public.CommunityChatRooms.create({
    communityId: community.id,
    creatorId: owner,
    kind: "THREAD",
    name: "Secret",
    nextSequence: 1n,
    parentRoomId: room.id,
    slug: "secret",
    visibility: "PRIVATE",
  });
  await message(thread.id);
  expect(await hasUnread(community.id)).toBe(false);
  await prisma.orm.public.CommunityChatRoomMembers.create({
    communityMemberId: membership.id,
    invitedById: owner,
    roomId: thread.id,
  });
  expect(await hasUnread(community.id)).toBe(true);
  await prisma.orm.public.CommunityChatRoomMembers.where({
    roomId: thread.id,
  }).deleteAndCount();
  expect(await hasUnread(community.id)).toBe(false);
  await prisma.orm.public.CommunityMembers.where({ id: membership.id }).update({
    role: "MODERATOR",
  });
  expect(await hasUnread(community.id)).toBe(true);
  await prisma.orm.public.CommunityChatRooms.where({ id: room.id }).update({
    archived: true,
  });
  expect(await hasUnread(community.id)).toBe(false);
});

test("own messages and tombstones do not produce unread dots", async () => {
  const { community, room } = await fixture();
  await message(room.id, viewer);
  expect(await hasUnread(community.id)).toBe(false);
  const deleted = await message(room.id, owner, 2n);
  await prisma.orm.public.CommunityChatRooms.where({ id: room.id }).update({
    nextSequence: 2n,
  });
  await prisma.orm.public.CommunityChatMessages.where({
    id: deleted.id,
  }).update({ deletedAt: toPrismaDateTime(new Date()) });
  expect(await hasUnread(community.id)).toBe(false);
});

test("mute suppresses the dot; bans and membership removal suppress the shortcut", async () => {
  const { community, room, membership } = await fixture();
  await message(room.id);
  expect(await hasUnread(community.id)).toBe(true);
  await prisma.orm.public.CommunityChatPreferences.create({
    communityId: community.id,
    mutedAt: toPrismaDateTime(new Date()),
    userId: viewer,
  });
  expect(await hasUnread(community.id)).toBe(false);
  await prisma.orm.public.CommunityChatSanctions.create({
    actorId: owner,
    communityId: community.id,
    kind: "BAN",
    userId: viewer,
  });
  expect(await inboxEntry(community.id)).toBeUndefined();
  await prisma.orm.public.CommunityChatSanctions.where({
    communityId: community.id,
  }).deleteAndCount();
  await prisma.orm.public.CommunityMembers.where({
    id: membership.id,
  }).deleteAndCount();
  expect(await inboxEntry(community.id)).toBeUndefined();
});
