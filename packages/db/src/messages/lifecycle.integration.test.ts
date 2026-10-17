import { afterAll, beforeAll, describe, expect, test } from "bun:test";
// oxlint-disable no-await-in-loop -- Each bounded cleanup batch must commit before checking progress.

import { requireLifecycleValue, CHAT_DAY_MS } from "@asm/messages";

import { keys } from "../../keys";
import { toPrismaDateTime } from "../dates";
import prisma from "../prisma";
import { visibleToUser } from "./access/visibility";
import {
  chatLifecycleSnapshot,
  changeChatRetention,
  clearChatHistory,
  endIncognito,
  guardNormalChatSend,
  listIncognitoMessages,
  sendIncognitoMessage,
  startIncognito,
} from "./lifecycle";
import { eraseExpiredChatBatch } from "./lifecycle-cleanup";

const run = crypto.randomUUID();
const users = [`chat-owner-${run}`, `chat-peer-${run}`, `chat-outsider-${run}`];
const owner = requireLifecycleValue(users[0]);
const peer = requireLifecycleValue(users[1]);
const outsider = requireLifecycleValue(users[2]);
const dm = crypto.randomUUID();
const den = crypto.randomUUID();
const legacy = crypto.randomUUID();
const current = crypto.randomUUID();

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
      users.map((id) => ({
        displayName: id,
        email: `${id}@example.test`,
        id,
        username: id,
      }))
    );
    await tx.orm.public.MessageConversations.createAll([
      { changeSeq: 2, id: dm },
      { _type: "DEN", id: den, ownerId: owner },
    ]);
    await tx.orm.public.MessageConversationMembers.createAll([
      { conversationId: dm, userId: owner },
      { conversationId: dm, userId: peer },
      { conversationId: den, role: "OWNER", userId: owner },
      { conversationId: den, role: "MEMBER", userId: peer },
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
    await tx.orm.public.Messages.createAll([
      {
        ciphertext: "retained",
        conversationId: dm,
        createdAt: toPrismaDateTime(new Date(Date.now() - 10_000)),
        creationSequence: 0,
        id: legacy,
        iv: "fixture",
        ratchetIndex: 0,
        senderId: peer,
      },
      {
        ciphertext: "retained",
        conversationId: dm,
        creationSequence: 2,
        id: current,
        iv: "fixture",
        ratchetIndex: 1,
        senderId: peer,
      },
    ]);
  });
});
afterAll(async () => {
  await prisma.orm.public.MessageConversations.where((c) =>
    c.id.in([dm, den])
  ).deleteAndCount();
  await prisma.orm.public.Users.where((u) => u.id.in(users)).deleteAndCount();
});

describe("chat lifecycle persistence and concurrency", () => {
  test("existing messages stay permanent by default", async () => {
    const awaitedChatState0 = await prisma.orm.public.Messages.where({
      id: current,
    }).first();
    expect(awaitedChatState0?.expiresAt).toBeNull();
    const awaitedChatState1 = await chatLifecycleSnapshot(dm, owner);
    expect(awaitedChatState1.retentionSeconds).toBe(0);
    await expect(chatLifecycleSnapshot(dm, outsider)).rejects.toMatchObject({
      status: 404,
    });
  });
  test("clearing hides both sequence-zero and sequenced history only for its viewer", async () => {
    await clearChatHistory(dm, owner);
    const mine = await prisma.orm.public.Messages.where({ conversationId: dm })
      .where(visibleToUser(owner))
      .all();
    const theirs = await prisma.orm.public.Messages.where({
      conversationId: dm,
    })
      .where(visibleToUser(peer))
      .all();
    expect(mine).toHaveLength(0);
    expect(theirs).toHaveLength(2);
    const awaitedChatState2 = await prisma.orm.public.Messages.where({
      id: current,
    }).first();
    expect(awaitedChatState2?.ciphertext).toBe("retained");
  });
  test("new messages survive a previous clear and expired rows are denied without a worker", async () => {
    await prisma.orm.public.Messages.create({
      ciphertext: "new",
      conversationId: dm,
      creationSequence: 3,
      iv: "fixture",
      ratchetIndex: 2,
      senderId: peer,
    });
    await prisma.orm.public.Messages.create({
      ciphertext: "expired",
      conversationId: dm,
      creationSequence: 4,
      expiresAt: toPrismaDateTime(new Date(Date.now() - 1)),
      iv: "fixture",
      ratchetIndex: 3,
      senderId: peer,
    });
    const visible = await prisma.orm.public.Messages.where({
      conversationId: dm,
    })
      .where(visibleToUser(owner))
      .all();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.ciphertext).toBe("new");
  });
  test("den members cannot change shared retention or start incognito", async () => {
    await expect(
      changeChatRetention(den, peer, 86_400, 0)
    ).rejects.toMatchObject({ status: 403 });
    await expect(startIncognito(den, owner)).rejects.toMatchObject({
      status: 403,
    });
    await changeChatRetention(den, owner, 86_400, 0);
    const awaitedChatState3 = await chatLifecycleSnapshot(den, peer);
    expect(awaitedChatState3.retentionSeconds).toBe(86_400);
  });
  test("normal sends reject stale policy and carry a new fixed lifetime", async () => {
    await changeChatRetention(dm, owner, 86_400, 0);
    await expect(
      prisma.transaction((tx) => guardNormalChatSend(dm, owner, 0, tx))
    ).rejects.toMatchObject({ code: "CHAT_STATE_CHANGED" });
    const lifetime = await prisma.transaction((tx) =>
      guardNormalChatSend(dm, owner, 1, tx)
    );
    expect(
      Math.abs(
        requireLifecycleValue(lifetime.expiresAt).getTime() -
          Date.now() -
          CHAT_DAY_MS
      )
    ).toBeLessThan(1000);
  });
  test("concurrent starts create one shared session and one permanent card", async () => {
    await Promise.all([
      startIncognito(dm, owner),
      startIncognito(dm, peer),
      startIncognito(dm, owner),
    ]);
    const snapshot = await chatLifecycleSnapshot(dm, owner);
    expect(snapshot.notices).toHaveLength(1);
    expect(snapshot.activeSession).not.toBeNull();
    expect(snapshot.activeSession?.expiresAt).toBeNull();
    await expect(clearChatHistory(dm, owner)).rejects.toMatchObject({
      code: "END_INCOGNITO_FIRST",
    });
    await expect(
      prisma.transaction((tx) =>
        guardNormalChatSend(dm, owner, snapshot.retentionVersion, tx)
      )
    ).rejects.toMatchObject({ code: "INCOGNITO_ACTIVE" });
  });
  test("idempotent sends and concurrent end cannot leak into normal history", async () => {
    const snapshot = await chatLifecycleSnapshot(dm, peer);
    const session = requireLifecycleValue(snapshot.activeSession);
    const input = {
      ciphertext: "encrypted-session-body",
      conversationId: dm,
      id: crypto.randomUUID(),
      iv: "fixture",
      keyEpoch: 1,
      mediaIds: [],
      ratchetIndex: 0,
      senderId: owner,
      sessionId: session.id,
    };
    await Promise.all([
      sendIncognitoMessage(input),
      sendIncognitoMessage(input),
    ]);
    const awaitedChatState4 = await listIncognitoMessages(dm, peer, session.id);
    expect(awaitedChatState4.messages).toHaveLength(1);
    await endIncognito(dm, peer, session.id);
    await endIncognito(dm, peer, session.id);
    const awaitedChatState5 = await listIncognitoMessages(
      dm,
      owner,
      session.id
    );
    expect(awaitedChatState5.messages).toHaveLength(0);
    await expect(
      sendIncognitoMessage({
        ...input,
        id: crypto.randomUUID(),
        ratchetIndex: 1,
      })
    ).rejects.toMatchObject({ status: 410 });
    expect(
      await prisma.orm.public.Messages.where({ id: input.id }).first()
    ).toBeNull();
    await clearChatHistory(dm, owner);
    const ended = await chatLifecycleSnapshot(dm, owner);
    expect(ended.notices).toHaveLength(1);
    expect(ended.notices[0]?.endedById).toBe(peer);
    expect(ended.activeSession).toBeNull();
  });
  test("individual messages expire without ending incognito or erasing newer messages", async () => {
    await startIncognito(dm, owner);
    const initialSnapshot = await chatLifecycleSnapshot(dm, owner);
    const session = requireLifecycleValue(initialSnapshot.activeSession);
    const oldestId = crypto.randomUUID();
    const recentId = crypto.randomUUID();
    for (const [index, id] of [oldestId, recentId].entries()) {
      await sendIncognitoMessage({
        ciphertext: "temporary",
        conversationId: dm,
        id,
        iv: "fixture",
        keyEpoch: 1,
        mediaIds: [],
        ratchetIndex: index,
        senderId: owner,
        sessionId: session.id,
      });
    }
    await prisma.orm.public.MessageIncognitoMessages.where({
      id: oldestId,
    }).update({
      createdAt: toPrismaDateTime(new Date(Date.now() - CHAT_DAY_MS - 1000)),
    });
    // An old session deadline from a previous client must no longer end the mode.
    await prisma.orm.public.MessageIncognitoSessions.where({
      id: session.id,
    }).update({ expiresAt: toPrismaDateTime(new Date(Date.now() - 1)) });
    const retained = await listIncognitoMessages(dm, peer, session.id);
    expect(retained.messages.map((m) => m.id)).toEqual([recentId]);
    const activeBeforeCleanup = await chatLifecycleSnapshot(dm, peer);
    expect(activeBeforeCleanup.activeSession?.id).toBe(session.id);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await eraseExpiredChatBatch();
      if (
        !(await prisma.orm.public.MessageIncognitoMessages.where({
          id: oldestId,
        }).first())
      ) {
        break;
      }
    }
    expect(
      await prisma.orm.public.MessageIncognitoMessages.where({
        id: oldestId,
      }).first()
    ).toBeNull();
    expect(
      await prisma.orm.public.MessageIncognitoMessages.where({
        id: recentId,
      }).first()
    ).not.toBeNull();
    const activeAfterCleanup = await chatLifecycleSnapshot(dm, peer);
    expect(activeAfterCleanup.activeSession?.id).toBe(session.id);
    await endIncognito(dm, peer, session.id);
  });
});

test("session end racing a send denies further reads and cleanup erases content idempotently", async () => {
  await startIncognito(dm, owner);
  const snapshot = await chatLifecycleSnapshot(dm, owner);
  const session = requireLifecycleValue(snapshot.activeSession);
  const messageId = crypto.randomUUID();
  const outcomes = await Promise.allSettled([
    sendIncognitoMessage({
      ciphertext: "race-ciphertext",
      conversationId: dm,
      id: messageId,
      iv: "fixture",
      keyEpoch: 1,
      mediaIds: [],
      ratchetIndex: 0,
      senderId: owner,
      sessionId: session.id,
    }),
    endIncognito(dm, peer, session.id),
  ]);
  expect(outcomes[1]?.status).toBe("fulfilled");
  const [sendResult] = outcomes;
  if (sendResult?.status === "rejected") {
    expect(sendResult.reason).toMatchObject({ status: 410 });
  }
  const closed = await listIncognitoMessages(dm, peer, session.id);
  expect(closed.messages).toHaveLength(0);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await eraseExpiredChatBatch();
    const row = await prisma.orm.public.MessageIncognitoSessions.where({
      id: session.id,
    }).first();
    if (row?.purgedAt) {
      break;
    }
  }
  await eraseExpiredChatBatch();
  expect(
    await prisma.orm.public.MessageIncognitoMessages.where({
      id: messageId,
    }).first()
  ).toBeNull();
  const expired = await prisma.orm.public.Messages.where({ conversationId: dm })
    .where((message) => message.ratchetIndex.eq(3))
    .first();
  expect(expired?.ciphertext).toBe("");
  expect(expired?.iv).toBe("");
  expect(expired?.deletedAt).not.toBeNull();
  const permanent = await prisma.orm.public.Messages.where({
    id: legacy,
  }).first();
  expect(permanent?.ciphertext).toBe("retained");
  const finalSnapshot = await chatLifecycleSnapshot(dm, owner);
  expect(finalSnapshot.notices.some((notice) => notice.id === session.id)).toBe(
    true
  );
});
