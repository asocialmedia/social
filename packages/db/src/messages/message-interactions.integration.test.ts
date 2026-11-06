import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { keys } from "../../keys";
import { toPrismaDateTime } from "../dates";
import prisma from "../prisma";
import { messageInteractionAllowed } from "./access/interaction-access";
import {
  activateViewOnceGrant,
  closeViewOnceGrant,
  lifecycleMediaAllowed,
  linkLifecycleMedia,
  reserveViewOnceMedia,
} from "./lifecycle";
import { eraseExpiredChatBatch } from "./lifecycle-cleanup";
import { toggleMessageReaction } from "./reactions";
import {
  acknowledgeViewOnceSeen,
  getViewOnceReceipt,
} from "./view-once-receipts";

const owner = `interaction-owner-${crypto.randomUUID()}`;
const peer = `interaction-peer-${crypto.randomUUID()}`;
const third = `interaction-third-${crypto.randomUUID()}`;

beforeAll(async () => {
  const url = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.port !== "5433" ||
    url.pathname !== "/asocialmedia"
  ) {
    throw new Error("Local development database required");
  }
  await prisma.orm.public.Users.createAll(
    [owner, peer, third].map((id) => ({
      displayName: id,
      email: `${id}@example.test`,
      id,
      username: id,
    }))
  );
});

afterAll(async () => {
  await prisma.orm.public.Users.where((u) =>
    u.id.in([owner, peer, third])
  ).deleteAndCount();
});

async function withChat(
  run: (id: string) => Promise<void>,
  type: "DM" | "DEN" = "DM"
) {
  const id = crypto.randomUUID();
  await prisma.orm.public.MessageConversations.create({ _type: type, id });
  await prisma.orm.public.MessageConversationMembers.createAll(
    [owner, peer].map((userId) => ({
      conversationId: id,
      userId,
    }))
  );
  try {
    await run(id);
  } finally {
    await prisma.orm.public.PostMedia.where({
      messageConversationId: id,
    }).deleteAndCount();
    await prisma.orm.public.MessageConversations.where({ id }).deleteAndCount();
  }
}

function createMessage(conversationId: string) {
  return prisma.orm.public.Messages.create({
    ciphertext: "fixture",
    conversationId,
    creationSequence: 1,
    iv: "fixture",
    keyEpoch: 1,
    ratchetIndex: 0,
    senderId: owner,
  });
}

async function createPhoto(conversationId: string) {
  const message = await createMessage(conversationId);
  const mediaId = crypto.randomUUID();
  await prisma.orm.public.PostMedia.create({
    detectedMime: "image/png",
    id: mediaId,
    messageConversationId: conversationId,
    messageLifecycleProtected: true,
    messageViewOnce: true,
    mimeType: "image/png",
    publishedKey: `fixture/${mediaId}`,
    size: 4,
    status: "READY",
    url: `/api/media/${mediaId}`,
    userId: owner,
  });
  await prisma.transaction((tx) =>
    linkLifecycleMedia(
      {
        conversationId,
        mediaIds: [],
        messageId: message.id,
        protect: true,
        userId: owner,
        viewOnceMediaIds: [mediaId],
      },
      tx
    )
  );
  return { mediaId, messageId: message.id };
}

describe("message interaction authorization and lifecycle", () => {
  test("view-once seen receipts require display confirmation, survive byte cleanup, and enforce reader access", async () => {
    await withChat(async (conversationId) => {
      const { mediaId, messageId } = await createPhoto(conversationId);
      const grant = crypto.randomUUID();
      expect(await getViewOnceReceipt(conversationId, mediaId, owner)).toEqual({
        seenAt: null,
        unavailable: false,
      });
      await reserveViewOnceMedia(conversationId, mediaId, peer, grant);
      expect(await activateViewOnceGrant(conversationId, grant, peer)).toBe(
        true
      );
      const unopened = await getViewOnceReceipt(conversationId, mediaId, owner);
      expect(unopened.seenAt).toBeNull();
      await expect(
        acknowledgeViewOnceSeen(conversationId, mediaId, owner, grant)
      ).rejects.toThrow();
      await expect(
        acknowledgeViewOnceSeen(
          conversationId,
          mediaId,
          peer,
          crypto.randomUUID()
        )
      ).rejects.toThrow();
      await expect(
        getViewOnceReceipt(conversationId, mediaId, third)
      ).rejects.toThrow();
      const first = await acknowledgeViewOnceSeen(
        conversationId,
        mediaId,
        peer,
        grant
      );
      expect(first.changed).toBe(true);
      const repeated = await acknowledgeViewOnceSeen(
        conversationId,
        mediaId,
        peer,
        grant
      );
      expect(repeated).toEqual({ changed: false, seenAt: first.seenAt });
      await closeViewOnceGrant(grant, peer);
      await prisma.orm.public.MessageMediaLinks.where({
        mediaId,
      }).deleteAndCount();
      expect(await getViewOnceReceipt(conversationId, mediaId, owner)).toEqual({
        seenAt: first.seenAt,
        unavailable: true,
      });
      expect(await getViewOnceReceipt(conversationId, mediaId, peer)).toEqual({
        seenAt: first.seenAt,
        unavailable: true,
      });
      await prisma.orm.public.MessageHiddens.create({
        messageId,
        userId: peer,
      });
      await expect(
        getViewOnceReceipt(conversationId, mediaId, peer)
      ).rejects.toThrow();
    });
  });
  test("hidden, cleared, and blocked messages cannot be read or reacted to", async () => {
    await withChat(async (conversationId) => {
      const message = await createMessage(conversationId);
      const input = { conversationId, messageId: message.id, userId: peer };
      expect(await messageInteractionAllowed(input)).toBe(true);
      await prisma.orm.public.MessageHiddens.create({
        messageId: message.id,
        userId: peer,
      });
      expect(await messageInteractionAllowed(input)).toBe(false);
      await expect(
        toggleMessageReaction({ ...input, emoji: "❤️" })
      ).rejects.toMatchObject({ status: 404 });
      await prisma.orm.public.MessageHiddens.where({
        messageId: message.id,
        userId: peer,
      }).deleteAndCount();
      await prisma.orm.public.MessageConversationMembers.where({
        conversationId,
        userId: peer,
      }).update({ clearedThroughSequence: 1 });
      expect(await messageInteractionAllowed(input)).toBe(false);
      await prisma.orm.public.MessageConversationMembers.where({
        conversationId,
        userId: peer,
      }).update({ clearedThroughSequence: 0 });
      await prisma.orm.public.Blocks.create({
        blockedId: peer,
        blockerId: owner,
      });
      try {
        expect(await messageInteractionAllowed(input)).toBe(false);
        await expect(
          toggleMessageReaction({ ...input, emoji: "❤️" })
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        await prisma.orm.public.Blocks.where({
          blockedId: peer,
          blockerId: owner,
        }).deleteAndCount();
      }
    });
  });

  test("den interactions require a readable membership window and the viewer's epoch", async () => {
    await withChat(async (conversationId) => {
      const message = await createMessage(conversationId);
      const input = { conversationId, messageId: message.id, userId: peer };
      expect(await messageInteractionAllowed(input)).toBe(false);
      await prisma.orm.public.MessageConversationKeys.create({
        conversationId,
        encryptedKey: "fixture",
        iv: "fixture",
        ownerUserId: peer,
        version: 1,
      });
      expect(await messageInteractionAllowed(input)).toBe(true);
      await prisma.orm.public.Messages.where({ id: message.id }).update({
        createdAt: toPrismaDateTime(new Date(Date.now() - 60_000)),
      });
      expect(await messageInteractionAllowed(input)).toBe(false);
    }, "DEN");
  });

  test("concurrent reactions keep counts consistent", async () => {
    await withChat(async (conversationId) => {
      const message = await createMessage(conversationId);
      await Promise.all(
        [owner, peer].map((userId) =>
          toggleMessageReaction({
            conversationId,
            emoji: "❤️",
            messageId: message.id,
            userId,
          })
        )
      );
      const result = await toggleMessageReaction({
        conversationId,
        emoji: "👍",
        messageId: message.id,
        userId: peer,
      });
      expect(result).toEqual(
        expect.arrayContaining([
          { count: 1, emoji: "❤️", reactedByMe: false },
          { count: 1, emoji: "👍", reactedByMe: true },
        ])
      );
    });
  });

  test("view-once processing metadata is owner-only while every byte route stays denied", async () => {
    await withChat(async (conversationId) => {
      const id = crypto.randomUUID();
      await prisma.orm.public.PostMedia.create({
        id,
        messageConversationId: conversationId,
        messageLifecycleProtected: true,
        messageViewOnce: true,
        status: "QUARANTINED",
        url: "fixture",
        userId: owner,
      });
      expect(
        await lifecycleMediaAllowed(id, owner, { allowProcessing: true })
      ).toBe(true);
      expect(
        await lifecycleMediaAllowed(id, peer, { allowProcessing: true })
      ).toBe(false);
      expect(await lifecycleMediaAllowed(id, owner)).toBe(false);
      await prisma.orm.public.PostMedia.where({ id }).update({
        status: "REJECTED",
      });
      expect(
        await lifecycleMediaAllowed(id, owner, { allowProcessing: true })
      ).toBe(true);
    });
  });

  test("abandoned reservations are retryable and concurrent opens have one winner", async () => {
    await withChat(async (conversationId) => {
      const { mediaId } = await createPhoto(conversationId);
      const first = crypto.randomUUID();
      await reserveViewOnceMedia(conversationId, mediaId, peer, first);
      await prisma.orm.public.MessageViewOnceGrants.where({ id: first }).update(
        { expiresAt: toPrismaDateTime(new Date(Date.now() - 1000)) }
      );
      await eraseExpiredChatBatch();
      await reserveViewOnceMedia(conversationId, mediaId, peer, first);
      await closeViewOnceGrant(first, peer);
      await reserveViewOnceMedia(conversationId, mediaId, peer, first);
      await prisma.orm.public.MessageViewOnceGrants.where({ id: first }).update(
        { expiresAt: toPrismaDateTime(new Date(Date.now() - 1000)) }
      );
      await reserveViewOnceMedia(conversationId, mediaId, peer, first);
      await closeViewOnceGrant(first, peer);
      const grants = [crypto.randomUUID(), crypto.randomUUID()];
      const results = await Promise.allSettled(
        grants.map((grant) =>
          reserveViewOnceMedia(conversationId, mediaId, peer, grant)
        )
      );
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      const winner =
        grants[results.findIndex((result) => result.status === "fulfilled")];
      if (!winner) {
        throw new Error("Missing winning grant");
      }
      expect(await activateViewOnceGrant(conversationId, winner, peer)).toBe(
        true
      );
      await closeViewOnceGrant(winner, peer);
      await eraseExpiredChatBatch();
      const media = await prisma.orm.public.PostMedia.where({
        id: mediaId,
      }).first();
      expect(media?.status).toBe("DELETED");
    });
  });

  test("den cleanup preserves a photo until every recipient has finished", async () => {
    await withChat(async (conversationId) => {
      await prisma.orm.public.MessageConversationMembers.create({
        conversationId,
        userId: third,
      });
      await prisma.orm.public.MessageConversationKeys.createAll(
        [peer, third].map((userId) => ({
          conversationId,
          encryptedKey: "fixture",
          iv: "fixture",
          ownerUserId: userId,
          version: 1,
        }))
      );
      const { mediaId } = await createPhoto(conversationId);
      const firstGrant = crypto.randomUUID();
      await reserveViewOnceMedia(conversationId, mediaId, peer, firstGrant);
      expect(
        await activateViewOnceGrant(conversationId, firstGrant, peer)
      ).toBe(true);
      await closeViewOnceGrant(firstGrant, peer);
      await eraseExpiredChatBatch();
      const waiting = await prisma.orm.public.PostMedia.where({
        id: mediaId,
      }).first();
      expect(waiting?.status).toBe("READY");
      const lastGrant = crypto.randomUUID();
      await reserveViewOnceMedia(conversationId, mediaId, third, lastGrant);
      expect(
        await activateViewOnceGrant(conversationId, lastGrant, third)
      ).toBe(true);
      await closeViewOnceGrant(lastGrant, third);
      await eraseExpiredChatBatch();
      const erased = await prisma.orm.public.PostMedia.where({
        id: mediaId,
      }).first();
      expect(erased?.status).toBe("DELETED");
    }, "DEN");
  });

  test("hiding a photo between reservation and activation revokes access", async () => {
    await withChat(async (conversationId) => {
      const { mediaId, messageId } = await createPhoto(conversationId);
      const grant = crypto.randomUUID();
      await reserveViewOnceMedia(conversationId, mediaId, peer, grant);
      await prisma.orm.public.MessageHiddens.create({
        messageId,
        userId: peer,
      });
      expect(await activateViewOnceGrant(conversationId, grant, peer)).toBe(
        false
      );
      await expect(
        reserveViewOnceMedia(conversationId, mediaId, peer, crypto.randomUUID())
      ).rejects.toMatchObject({ status: 410 });
    });
  });
});
