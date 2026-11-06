import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// oxlint-disable no-await-in-loop -- Sequential cryptography, database mutations and bounded streams preserve ordering and memory limits.
import { requireLifecycleValue, CHAT_DAY_MS } from "@asm/messages";

import { keys } from "../../keys";
import { toPrismaDateTime } from "../dates";
import prisma from "../prisma";
import { visibleToUser } from "./access/visibility";
import {
  activateViewOnceGrant,
  clearChatHistory,
  closeViewOnceGrant,
  endIncognito,
  lifecycleMediaAllowed,
  linkLifecycleMedia,
  reserveViewOnceMedia,
  startIncognito,
} from "./lifecycle";
import { eraseExpiredChatBatch } from "./lifecycle-cleanup";

const run = crypto.randomUUID();
const owner = `lifecycle-media-owner-${run}`;
const peer = `lifecycle-media-peer-${run}`;
const dm = crypto.randomUUID();
const den = crypto.randomUUID();
function readyMedia(
  id: string,
  userId: string,
  extra: Record<string, unknown> = {}
) {
  return prisma.orm.public.PostMedia.create({
    id,
    messageConversationId: dm,
    mimeType: "image/png",
    status: "READY",
    url: `https://example.test/${id}.png`,
    userId,
    ...extra,
  });
}
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
  await prisma.transaction(async (tx) => {
    await tx.orm.public.Users.createAll(
      [owner, peer].map((id) => ({
        displayName: id,
        email: `${id}@example.test`,
        id,
        username: id,
      }))
    );
    await tx.orm.public.MessageConversations.create({ changeSeq: 0, id: dm });
    await tx.orm.public.MessageConversationMembers.createAll([
      { conversationId: dm, userId: owner },
      { conversationId: dm, userId: peer },
    ]);
    await tx.orm.public.MessageConversationKeys.createAll(
      [owner, peer].map((userId) => ({
        conversationId: dm,
        encryptedKey: "fixture",
        iv: "fixture",
        ownerUserId: userId,
        version: 1,
      }))
    );
  });
});
afterAll(async () => {
  await prisma.orm.public.MessageConversations.where((c) =>
    c.id.in([dm, den])
  ).deleteAndCount();
  await prisma.orm.public.Users.where((u) =>
    u.id.in([owner, peer])
  ).deleteAndCount();
});
describe("lifecycle media binding and erasure", () => {
  test("processing status remains visible only to the uploader while bytes stay denied", async () => {
    const id = crypto.randomUUID();
    await readyMedia(id, owner, {
      messageLifecycleProtected: true,
      status: "QUARANTINED",
    });
    expect(await lifecycleMediaAllowed(id, owner)).toBe(false);
    expect(
      await lifecycleMediaAllowed(id, owner, { allowProcessing: true })
    ).toBe(true);
    expect(
      await lifecycleMediaAllowed(id, peer, { allowProcessing: true })
    ).toBe(false);
    await prisma.orm.public.PostMedia.where({ id }).deleteAndCount();
  });

  test("a delayed clear cannot lower the cutoff or hide messages after the snapshot", async () => {
    await prisma.orm.public.MessageConversations.where({ id: dm }).update({
      changeSeq: 3,
    });
    await clearChatHistory(dm, owner, 2);
    const pending = await prisma.orm.public.MessageConversationMembers.where({
      conversationId: dm,
      userId: owner,
    }).first();
    expect(pending?.inboxHiddenAt).toBeNull();
    expect(pending?.unreadCount).toBeNull();
    await clearChatHistory(dm, owner, 3);
    await clearChatHistory(dm, owner, 2);
    const retried = await prisma.orm.public.MessageConversationMembers.where({
      conversationId: dm,
      userId: owner,
    }).first();
    expect(retried?.clearedThroughSequence).toBe(3);
  });

  test("unscanned uploads cannot be linked", async () => {
    const mediaId = crypto.randomUUID();
    await readyMedia(mediaId, owner, { status: "QUARANTINED" });
    const message = await prisma.orm.public.Messages.create({
      ciphertext: "body",
      conversationId: dm,
      creationSequence: 50,
      iv: "fixture",
      ratchetIndex: 500,
      senderId: owner,
    });
    await expect(
      prisma.transaction((tx) =>
        linkLifecycleMedia(
          {
            conversationId: dm,
            mediaIds: [mediaId],
            messageId: message.id,
            protect: false,
            userId: owner,
          },
          tx
        )
      )
    ).rejects.toMatchObject({ code: "INVALID_ATTACHMENT" });
    await prisma.orm.public.PostMedia.where({ id: mediaId }).deleteAndCount();
    await prisma.orm.public.Messages.where({ id: message.id }).deleteAndCount();
  });
  test("incognito assets cannot enter the normal transcript", async () => {
    await startIncognito(dm, owner, crypto.randomUUID());
    const session = requireLifecycleValue(
      await prisma.orm.public.MessageIncognitoSessions.where({
        conversationId: dm,
      })
        .where((s) => s.endedAt.isNull())
        .first()
    );
    const stagedId = crypto.randomUUID();
    await readyMedia(stagedId, owner, {
      incognitoSessionId: session.id,
      messageLifecycleProtected: true,
    });
    const normal = await prisma.orm.public.Messages.create({
      ciphertext: "normal",
      conversationId: dm,
      creationSequence: 51,
      iv: "fixture",
      ratchetIndex: 501,
      senderId: owner,
    });
    await expect(
      prisma.transaction((tx) =>
        linkLifecycleMedia(
          {
            conversationId: dm,
            mediaIds: [stagedId],
            messageId: normal.id,
            protect: true,
            userId: owner,
          },
          tx
        )
      )
    ).rejects.toMatchObject({ code: "INVALID_ATTACHMENT" });
    // Staged incognito upload is previewable by its uploader while the session is active.
    expect(await lifecycleMediaAllowed(stagedId, owner)).toBe(true);
    expect(await lifecycleMediaAllowed(stagedId, peer)).toBe(false);
    await endIncognito(dm, peer, session.id);
    // After end the staged URL is denied even to the uploader, before any worker runs.
    expect(await lifecycleMediaAllowed(stagedId, owner)).toBe(false);
    await prisma.orm.public.PostMedia.where({ id: stagedId }).deleteAndCount();
    await prisma.orm.public.Messages.where({ id: normal.id }).deleteAndCount();
  });
  test("session end erases staged uploads and marks purged only when clean", async () => {
    const actionId = crypto.randomUUID();
    await startIncognito(dm, owner, actionId);
    // Idempotent retry with the same action ID does not duplicate the session.
    await startIncognito(dm, peer, actionId);
    const sessions = await prisma.orm.public.MessageIncognitoSessions.where({
      conversationId: dm,
    }).all();
    expect(sessions.filter((s) => s.id === actionId)).toHaveLength(1);
    const stagedId = crypto.randomUUID();
    await readyMedia(stagedId, owner, {
      altText: "private description",
      incognitoSessionId: actionId,
      messageLifecycleProtected: true,
      ocrText: "private OCR",
      originalName: "private-file.png",
    });
    // A delayed retry after end must not start an unintended new session.
    await endIncognito(dm, peer, actionId);
    await startIncognito(dm, owner, actionId);
    const awaitedChatState0 =
      await prisma.orm.public.MessageIncognitoSessions.where({
        id: actionId,
      }).first();
    expect(awaitedChatState0?.endedAt).not.toBeNull();
    expect(
      await prisma.orm.public.MessageIncognitoSessions.where({
        conversationId: dm,
      })
        .where((s) => s.endedAt.isNull())
        .first()
    ).toBeNull();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await eraseExpiredChatBatch();
      const current = await prisma.orm.public.PostMedia.where({
        id: stagedId,
      }).first();
      if (current?.status === "DELETED") {
        break;
      }
    }
    const staged = await prisma.orm.public.PostMedia.where({
      id: stagedId,
    }).first();
    expect(staged?.status).toBe("DELETED");
    expect(staged?.failureCode).toBe("CHAT_LIFECYCLE_ERASURE");
    expect(staged?.originalName).toBeNull();
    expect(staged?.ocrText).toBeNull();
    expect(staged?.altText).toBeNull();
    await prisma.orm.public.PostMedia.where({ id: stagedId }).deleteAndCount();
  });
  test("snapshot-bounded clear preserves messages that arrived after confirmation", async () => {
    const first = await prisma.orm.public.Messages.create({
      ciphertext: "first",
      conversationId: dm,
      creationSequence: 52,
      iv: "fixture",
      ratchetIndex: 502,
      senderId: peer,
    });
    const member = requireLifecycleValue(
      await prisma.orm.public.MessageConversationMembers.where({
        conversationId: dm,
        userId: owner,
      }).first()
    );
    const boundary = member.clearedThroughSequence;
    const second = await prisma.orm.public.Messages.create({
      ciphertext: "second",
      conversationId: dm,
      creationSequence: 99,
      iv: "fixture",
      ratchetIndex: 503,
      senderId: peer,
    });
    // Simulate a retry replaying the original boundary after a new message arrived.
    await prisma.transaction(async (tx) => {
      const current = requireLifecycleValue(
        await tx.orm.public.MessageConversationMembers.where({
          conversationId: dm,
          userId: owner,
        }).first()
      );
      void current;
    });
    void first;
    await clearChatHistory(dm, owner, boundary);
    const visible = await prisma.orm.public.Messages.where({
      conversationId: dm,
    })
      .where(visibleToUser(owner))
      .all();
    expect(visible.map((m) => m.id)).toContain(second.id);
    await prisma.orm.public.Messages.where((m) =>
      m.id.in([first.id, second.id])
    ).deleteAndCount();
    await clearChatHistory(dm, owner);
  });
  test("den media honors leave/rejoin gaps and the viewer's own key epoch", async () => {
    const base = Date.now() - 100_000;
    await prisma.orm.public.MessageConversations.create({
      _type: "DEN",
      id: den,
      ownerId: owner,
    });
    await prisma.orm.public.MessageConversationMembers.createAll(
      [owner, peer].map((userId) => ({
        conversationId: den,
        createdAt: toPrismaDateTime(new Date(base)),
        userId,
      }))
    );
    await prisma.orm.public.MessageConversationKeys.create({
      conversationId: den,
      encryptedKey: "fixture",
      iv: "fixture",
      ownerUserId: peer,
      version: 1,
    });
    await prisma.orm.public.MessageConversationMembershipEvents.createAll(
      [
        { action: "JOINED" as const, offset: 0 },
        { action: "LEFT" as const, offset: 20_000 },
        { action: "JOINED" as const, offset: 40_000 },
      ].map(({ action, offset }) => ({
        action,
        actorId: peer,
        conversationId: den,
        createdAt: toPrismaDateTime(new Date(base + offset)),
      }))
    );
    const mediaIds: string[] = [];
    for (const [index, offset] of [10_000, 30_000, 50_000].entries()) {
      const mediaId = crypto.randomUUID();
      mediaIds.push(mediaId);
      await readyMedia(mediaId, owner, {
        messageConversationId: den,
        messageLifecycleProtected: true,
      });
      const message = await prisma.orm.public.Messages.create({
        ciphertext: "fixture",
        conversationId: den,
        createdAt: toPrismaDateTime(new Date(base + offset)),
        creationSequence: index + 1,
        iv: "fixture",
        keyEpoch: 1,
        ratchetIndex: index,
        senderId: owner,
      });
      await prisma.transaction((tx) =>
        linkLifecycleMedia(
          {
            conversationId: den,
            mediaIds: [mediaId],
            messageId: message.id,
            protect: true,
            userId: owner,
          },
          tx
        )
      );
    }
    expect(
      await lifecycleMediaAllowed(requireLifecycleValue(mediaIds[0]), peer)
    ).toBe(true);
    expect(
      await lifecycleMediaAllowed(requireLifecycleValue(mediaIds[1]), peer)
    ).toBe(false);
    expect(
      await lifecycleMediaAllowed(requireLifecycleValue(mediaIds[2]), peer)
    ).toBe(true);
    await prisma.orm.public.MessageConversationKeys.where({
      conversationId: den,
      ownerUserId: peer,
    }).deleteAndCount();
    expect(
      await lifecycleMediaAllowed(requireLifecycleValue(mediaIds[2]), peer)
    ).toBe(false);
    await prisma.orm.public.PostMedia.where((media) =>
      media.id.in(mediaIds)
    ).deleteAndCount();
  });
  test("incognito attachments expire with their message while the session stays open", async () => {
    await startIncognito(dm, owner);
    const session = requireLifecycleValue(
      await prisma.orm.public.MessageIncognitoSessions.where({
        conversationId: dm,
      })
        .where((s) => s.endedAt.isNull())
        .first()
    );
    const mediaId = crypto.randomUUID();
    await readyMedia(mediaId, owner, {
      incognitoSessionId: session.id,
      messageLifecycleProtected: true,
    });
    const message = await prisma.orm.public.MessageIncognitoMessages.create({
      ciphertext: "media",
      id: crypto.randomUUID(),
      iv: "fixture",
      keyEpoch: 1,
      ratchetIndex: 0,
      senderId: owner,
      sequence: 0,
      sessionId: session.id,
    });
    await prisma.transaction((tx) =>
      linkLifecycleMedia(
        {
          conversationId: dm,
          incognitoMessageId: message.id,
          mediaIds: [mediaId],
          protect: true,
          userId: owner,
        },
        tx
      )
    );
    expect(await lifecycleMediaAllowed(mediaId, peer)).toBe(true);
    await prisma.orm.public.MessageIncognitoMessages.where({
      id: message.id,
    }).update({
      createdAt: toPrismaDateTime(new Date(Date.now() - CHAT_DAY_MS - 1000)),
    });
    expect(await lifecycleMediaAllowed(mediaId, owner)).toBe(false);
    expect(await lifecycleMediaAllowed(mediaId, peer)).toBe(false);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await eraseExpiredChatBatch();
      const media = await prisma.orm.public.PostMedia.where({
        id: mediaId,
      }).first();
      if (media?.status === "DELETED") {
        break;
      }
    }
    const erasedMedia = await prisma.orm.public.PostMedia.where({
      id: mediaId,
    }).first();
    expect(erasedMedia?.status).toBe("DELETED");
    const active = await prisma.orm.public.MessageIncognitoSessions.where({
      id: session.id,
    }).first();
    expect(active?.endedAt).toBeNull();
    await endIncognito(dm, owner, session.id);
    await prisma.orm.public.PostMedia.where({ id: mediaId }).deleteAndCount();
  });
  test("expired normal media is denied without a worker", async () => {
    const mediaId = crypto.randomUUID();
    await readyMedia(mediaId, owner, { messageLifecycleProtected: true });
    const message = await prisma.orm.public.Messages.create({
      ciphertext: "timed",
      conversationId: dm,
      creationSequence: 100,
      expiresAt: toPrismaDateTime(new Date(Date.now() + 60_000)),
      iv: "fixture",
      ratchetIndex: 504,
      senderId: owner,
    });
    await prisma.transaction((tx) =>
      linkLifecycleMedia(
        {
          conversationId: dm,
          mediaIds: [mediaId],
          messageId: message.id,
          protect: true,
          userId: owner,
        },
        tx
      )
    );
    expect(await lifecycleMediaAllowed(mediaId, peer)).toBe(true);
    await prisma.orm.public.Messages.where({ id: message.id }).update({
      expiresAt: toPrismaDateTime(new Date(Date.now() - 1)),
    });
    expect(await lifecycleMediaAllowed(mediaId, peer)).toBe(false);
    await prisma.orm.public.MessageMediaLinks.where({
      mediaId,
    }).deleteAndCount();
    await prisma.orm.public.Messages.where({ id: message.id }).deleteAndCount();
    await prisma.orm.public.PostMedia.where({ id: mediaId }).deleteAndCount();
  });

  test("view-once media is recipient-scoped and consumed after one open", async () => {
    const mediaId = crypto.randomUUID();
    const message = await prisma.orm.public.Messages.create({
      ciphertext: "view-once",
      conversationId: dm,
      creationSequence: 101,
      iv: "fixture",
      ratchetIndex: 505,
      senderId: owner,
    });
    await readyMedia(mediaId, owner, {
      detectedMime: "image/png",
      key: `view-once/${mediaId}`,
      messageLifecycleProtected: true,
      messageViewOnce: true,
      publishedKey: `view-once/${mediaId}`,
      size: 123,
    });

    try {
      await prisma.transaction((tx) =>
        linkLifecycleMedia(
          {
            conversationId: dm,
            mediaIds: [],
            messageId: message.id,
            protect: true,
            userId: owner,
            viewOnceMediaIds: [mediaId],
          },
          tx
        )
      );

      expect(await lifecycleMediaAllowed(mediaId, owner)).toBe(false);
      expect(await lifecycleMediaAllowed(mediaId, peer)).toBe(false);
      await expect(
        reserveViewOnceMedia(dm, mediaId, owner, crypto.randomUUID())
      ).rejects.toMatchObject({ code: "VIEW_ONCE_UNAVAILABLE" });

      const grantId = crypto.randomUUID();
      const reservation = await reserveViewOnceMedia(
        dm,
        mediaId,
        peer,
        grantId
      );
      expect(reservation).toEqual({
        mimeType: "image/png",
        objectKey: `view-once/${mediaId}`,
        size: 123,
      });
      expect(await reserveViewOnceMedia(dm, mediaId, peer, grantId)).toEqual(
        reservation
      );
      expect(await activateViewOnceGrant(dm, grantId, peer)).toBe(true);
      await expect(
        reserveViewOnceMedia(dm, mediaId, peer, crypto.randomUUID())
      ).rejects.toMatchObject({ code: "VIEW_ONCE_OPENING" });

      await closeViewOnceGrant(grantId, peer);
      await expect(
        reserveViewOnceMedia(dm, mediaId, peer, crypto.randomUUID())
      ).rejects.toMatchObject({ code: "VIEW_ONCE_CONSUMED" });
    } finally {
      await prisma.orm.public.MessageMediaLinks.where({
        mediaId,
      }).deleteAndCount();
      await prisma.orm.public.Messages.where({
        id: message.id,
      }).deleteAndCount();
      await prisma.orm.public.PostMedia.where({ id: mediaId }).deleteAndCount();
    }
  });
});
