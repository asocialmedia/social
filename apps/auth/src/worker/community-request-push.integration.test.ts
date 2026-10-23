import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";

import {
  cancelCommunityMembershipRequest,
  decideCommunityMembershipRequest,
  joinCommunity,
  prisma,
  redis,
} from "@asm/db";
import type { PushDelivery } from "@asm/notifications/server";

const delivered: PushDelivery[] = [];
mock.module("@asm/notifications/server", () => ({
  dispatchNotificationPush: (notification: PushDelivery) => {
    delivered.push(notification);
    return Promise.resolve({
      device: { failed: 0, sent: 0, unregistered: [] },
      web: { expired: [], failed: 0, sent: 1 },
    });
  },
}));
const { processNotificationCreated } = await import("./jobs");

const communityId = randomUUID();
const owner = randomUUID();
const moderator = randomUUID();
const member = randomUUID();
const applicant = randomUUID();
const users = [owner, moderator, member, applicant];
let requestId = "";
let ownerNotification = "";
let moderatorNotification = "";

beforeAll(async () => {
  await prisma.orm.public.Users.createAll(
    users.map((id) => ({
      displayName: "Push test account",
      email: `${id}@example.invalid`,
      id,
      username: `push-${id}`,
    }))
  );
  await prisma.orm.public.Communities.create({
    _type: "PRIVATE",
    activeMemberCount: 3,
    description: "Private membership notification integration test",
    id: communityId,
    name: "Private push test",
    ownerId: owner,
    slug: `push${communityId.replaceAll("-", "")}`,
  });
  await prisma.orm.public.CommunityMembers.createAll([
    { communityId, role: "OWNER", status: "ACTIVE", userId: owner },
    { communityId, role: "MODERATOR", status: "ACTIVE", userId: moderator },
    { communityId, role: "PARTICIPANT", status: "ACTIVE", userId: member },
  ]);
  await joinCommunity(communityId, applicant);
  const request = await prisma.orm.public.CommunityMembers.where({
    communityId,
    userId: applicant,
  }).first();
  if (!request) {
    throw new Error("Request not created");
  }
  requestId = request.id;
  const notifications = await prisma.orm.public.Notifications.where({
    communityId,
    membershipRequestId: requestId,
  }).all();
  ownerNotification =
    notifications.find((row) => row.recipientId === owner)?.id ?? "";
  moderatorNotification =
    notifications.find((row) => row.recipientId === moderator)?.id ?? "";
  expect(notifications.map((row) => row.recipientId).toSorted()).toEqual(
    [owner, moderator].toSorted()
  );
}, 30_000);

beforeEach(async () => {
  delivered.length = 0;
  await prisma.orm.public.CommunityChatSanctions.where({
    communityId,
  }).deleteAndCount();
  await prisma.orm.public.CommunityMembers.where({
    communityId,
    userId: moderator,
  }).update({ role: "MODERATOR" });
  await prisma.orm.public.CommunityMembers.where({
    communityId,
    userId: applicant,
  }).deleteAndCount();
  await prisma.orm.public.CommunityMembers.create({
    communityId,
    id: requestId,
    role: "PARTICIPANT",
    status: "PENDING",
    userId: applicant,
  });
  await prisma.orm.public.Communities.where({ id: communityId }).update({
    activeMemberCount: 3,
  });
  await prisma.orm.public.Notifications.where({ communityId }).update({
    read: false,
  });
});

afterAll(async () => {
  const notifications = await prisma.orm.public.Notifications.select("id")
    .where({ communityId })
    .all();
  await prisma.orm.public.Communities.where({
    id: communityId,
  }).deleteAndCount();
  await prisma.orm.public.Users.where((row) =>
    row.id.in(users)
  ).deleteAndCount();
  await redis.del(
    ...users.map((id) => `unread:notif:${id}`),
    ...notifications.map((row) => `unread:notif:event:${row.id}`)
  );
});

test("a real application produces push deliveries for its owner and moderator only", async () => {
  await Promise.all([
    processNotificationCreated({
      notificationId: ownerNotification,
      recipientId: owner,
    }),
    processNotificationCreated({
      notificationId: moderatorNotification,
      recipientId: moderator,
    }),
  ]);
  expect(delivered.map((row) => row.recipientId).toSorted()).toEqual(
    [owner, moderator].toSorted()
  );
  for (const row of delivered) {
    expect(row).toMatchObject({
      membershipRequestId: requestId,
      type: "COMMUNITY_JOIN_REQUEST",
    });
  }
});

test("demotion and bans applied after submission suppress delivery", async () => {
  await prisma.orm.public.CommunityMembers.where({
    communityId,
    userId: moderator,
  }).update({ role: "PARTICIPANT" });
  await processNotificationCreated({
    notificationId: moderatorNotification,
    recipientId: moderator,
  });
  await prisma.orm.public.CommunityChatSanctions.create({
    actorId: owner,
    communityId,
    kind: "BAN",
    userId: owner,
  });
  await processNotificationCreated({
    notificationId: ownerNotification,
    recipientId: owner,
  });
  expect(delivered).toHaveLength(0);
});

test("cancel and re-request never send an obsolete request notification", async () => {
  await cancelCommunityMembershipRequest(communityId, applicant);
  await joinCommunity(communityId, applicant);
  await processNotificationCreated({
    notificationId: ownerNotification,
    recipientId: owner,
  });
  expect(delivered).toHaveLength(0);
  const current = await prisma.orm.public.CommunityMembers.where({
    communityId,
    userId: applicant,
  }).first();
  expect(current?.id).not.toBe(requestId);
  const notification = await prisma.orm.public.Notifications.where({
    communityId,
    membershipRequestId: current?.id ?? "",
    recipientId: owner,
  }).first();
  if (!notification) {
    throw new Error("New request notification missing");
  }
  await processNotificationCreated({
    notificationId: notification.id,
    recipientId: owner,
  });
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toMatchObject({ membershipRequestId: current?.id });
});

test("a decision completed before the worker runs suppresses the request push", async () => {
  await decideCommunityMembershipRequest(
    communityId,
    owner,
    requestId,
    "approve"
  );
  await processNotificationCreated({
    notificationId: ownerNotification,
    recipientId: owner,
  });
  expect(delivered).toHaveLength(0);
});
