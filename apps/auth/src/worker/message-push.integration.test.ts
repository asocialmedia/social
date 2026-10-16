import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { randomUUID } from "node:crypto";

import { and, prisma, toPrismaDateTime } from "@asm/db";

import { loadMessagePush } from "./message-push";

const senderId = randomUUID();
const recipientId = randomUUID();
const conversationId = randomUUID();
const messageId = randomUUID();
const job = { messageId, recipientId };

describe("DM push eligibility against stored message state", () => {
  beforeAll(async () => {
    await Promise.all(
      [senderId, recipientId].map((id) =>
        prisma.orm.public.Users.create({
          displayName: "DM Push QA",
          email: `${id}@example.invalid`,
          id,
          username: `qa-${id}`,
        })
      )
    );
    await prisma.orm.public.MessageConversations.create({ id: conversationId });
    await Promise.all(
      [senderId, recipientId].map((userId) =>
        prisma.orm.public.MessageConversationMembers.create({
          conversationId,
          userId,
        })
      )
    );
    await prisma.orm.public.Messages.create({
      ciphertext: "private-ciphertext-must-not-be-pushed",
      conversationId,
      id: messageId,
      iv: "fixture",
      senderId,
    });
  });

  beforeEach(async () => {
    await prisma.orm.public.Messages.where({ id: messageId }).update({
      createdAt: toPrismaDateTime(new Date()),
      deletedAt: null,
    });
    await prisma.orm.public.MessageConversationMembers.where((member) =>
      and(
        member.conversationId.eq(conversationId),
        member.userId.eq(recipientId)
      )
    ).update({ lastReadAt: null, mutedAt: null });
    await prisma.orm.public.Blocks.where((block) =>
      block.blockerId.in([senderId, recipientId])
    ).deleteAndCount();
    await prisma.orm.public.MessageHiddens.where({
      messageId,
    }).deleteAndCount();
  });

  afterAll(async () => {
    await prisma.orm.public.MessageConversations.where({
      id: conversationId,
    }).deleteAndCount();
    await prisma.orm.public.Users.where((user) =>
      user.id.in([senderId, recipientId])
    ).deleteAndCount();
  });

  test("an unread DM creates a private, conversation-scoped alert", async () => {
    const delivery = await loadMessagePush(job);
    expect(delivery).toEqual({
      id: messageId,
      payload: {
        body: "Sent you a message",
        path: `/messages?c=${conversationId}`,
        tag: `message:${conversationId}`,
        title: "DM Push QA",
      },
      recipientId,
    });
    expect(JSON.stringify(delivery)).not.toContain("private-ciphertext");
  });

  test("the sender and non-members cannot receive the alert", async () => {
    expect(
      await loadMessagePush({ messageId, recipientId: senderId })
    ).toBeNull();
    expect(
      await loadMessagePush({ messageId, recipientId: randomUUID() })
    ).toBeNull();
  });

  test("a mute applied after sending suppresses the queued alert", async () => {
    await prisma.orm.public.MessageConversationMembers.where((member) =>
      and(
        member.conversationId.eq(conversationId),
        member.userId.eq(recipientId)
      )
    ).update({ mutedAt: toPrismaDateTime(new Date()) });
    expect(await loadMessagePush(job)).toBeNull();
  });

  test("already read messages do not alert", async () => {
    await prisma.orm.public.MessageConversationMembers.where((member) =>
      and(
        member.conversationId.eq(conversationId),
        member.userId.eq(recipientId)
      )
    ).update({ lastReadAt: toPrismaDateTime(new Date(Date.now() + 1000)) });
    expect(await loadMessagePush(job)).toBeNull();
  });

  test("either direction of a new block suppresses the queued alert", async () => {
    await prisma.orm.public.Blocks.create({
      blockedId: senderId,
      blockerId: recipientId,
    });
    expect(await loadMessagePush(job)).toBeNull();
    await prisma.orm.public.Blocks.where({
      blockedId: senderId,
      blockerId: recipientId,
    }).deleteAndCount();
    await prisma.orm.public.Blocks.create({
      blockedId: recipientId,
      blockerId: senderId,
    });
    expect(await loadMessagePush(job)).toBeNull();
  });

  test("deleted, hidden and expired messages do not alert", async () => {
    await prisma.orm.public.Messages.where({ id: messageId }).update({
      deletedAt: toPrismaDateTime(new Date()),
    });
    expect(await loadMessagePush(job)).toBeNull();
    await prisma.orm.public.Messages.where({ id: messageId }).update({
      deletedAt: null,
    });
    await prisma.orm.public.MessageHiddens.create({
      messageId,
      userId: recipientId,
    });
    expect(await loadMessagePush(job)).toBeNull();
    await prisma.orm.public.MessageHiddens.where({
      messageId,
    }).deleteAndCount();
    await prisma.orm.public.Messages.where({ id: messageId }).update({
      createdAt: toPrismaDateTime(new Date(Date.now() - 25 * 60 * 60 * 1000)),
    });
    expect(await loadMessagePush(job)).toBeNull();
  });
});
