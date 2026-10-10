import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  closeMessageSearchPool,
  hydrateSearchMessageCandidates,
  keys,
  prisma,
  toPrismaDateTime,
} from "@asm/db";

import { seedVerifiedMessageEpochFixture } from "./epoch-readability-fixture";

const RUN_ID = crypto.randomUUID();
const CONVERSATION_ID = crypto.randomUUID();
const OWNER_ID = `search-hydration-owner-${RUN_ID}`;
const PEER_ID = `search-hydration-peer-${RUN_ID}`;
const VISIBLE_ID = crypto.randomUUID();
const STALE_REVISION_ID = crypto.randomUUID();
const HIDDEN_ID = crypto.randomUUID();
const UNREADABLE_EPOCH_ID = crypto.randomUUID();
const OUTSIDE_WINDOW_ID = crypto.randomUUID();

function assertLocalTestDatabase(): void {
  const databaseUrl = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5433" ||
    databaseUrl.pathname.replace(/^\//, "") !== "asocialmedia"
  ) {
    throw new Error(
      "Refusing to run DM search hydration integration tests outside the local test database"
    );
  }
}

beforeAll(async () => {
  assertLocalTestDatabase();
  const firstDate = new Date("2026-10-08T00:00:00.000Z");
  const secondDate = new Date("2026-10-08T00:00:01.000Z");
  await prisma.transaction(async (tx) => {
    await tx.orm.public.Users.createAll([
      {
        displayName: OWNER_ID,
        email: `${OWNER_ID}@example.test`,
        id: OWNER_ID,
        username: OWNER_ID,
      },
      {
        displayName: PEER_ID,
        email: `${PEER_ID}@example.test`,
        id: PEER_ID,
        username: PEER_ID,
      },
    ]);
    await tx.orm.public.MessageConversations.create({
      id: CONVERSATION_ID,
      pairKey: [OWNER_ID, PEER_ID].toSorted().join(":"),
    });
    await tx.orm.public.MessageConversationMembers.createAll(
      [OWNER_ID, PEER_ID].map((userId) => ({
        conversationId: CONVERSATION_ID,
        userId,
      }))
    );
    await tx.orm.public.MessageConversationKeys.create({
      conversationId: CONVERSATION_ID,
      encryptedKey: "owner-readable-wrap",
      iv: "wrap-iv",
      ownerUserId: OWNER_ID,
      version: 1,
    });
    await tx.orm.public.Messages.createAll([
      {
        ciphertext: "visible-ciphertext",
        conversationId: CONVERSATION_ID,
        createdAt: toPrismaDateTime(firstDate),
        id: VISIBLE_ID,
        iv: "visible-iv",
        keyEpoch: 1,
        ratchetIndex: 1,
        revision: 1,
        senderId: PEER_ID,
      },
      {
        ciphertext: "newer-revision-ciphertext",
        conversationId: CONVERSATION_ID,
        createdAt: toPrismaDateTime(firstDate),
        id: STALE_REVISION_ID,
        iv: "stale-iv",
        keyEpoch: 1,
        ratchetIndex: 2,
        revision: 2,
        senderId: PEER_ID,
      },
      {
        ciphertext: "hidden-ciphertext",
        conversationId: CONVERSATION_ID,
        createdAt: toPrismaDateTime(firstDate),
        id: HIDDEN_ID,
        iv: "hidden-iv",
        keyEpoch: 1,
        ratchetIndex: 3,
        revision: 1,
        senderId: PEER_ID,
      },
      {
        ciphertext: "unreadable-epoch-ciphertext",
        conversationId: CONVERSATION_ID,
        createdAt: toPrismaDateTime(firstDate),
        id: UNREADABLE_EPOCH_ID,
        iv: "unreadable-iv",
        keyEpoch: 2,
        ratchetIndex: 4,
        revision: 1,
        senderId: PEER_ID,
      },
      {
        ciphertext: "outside-window-ciphertext",
        conversationId: CONVERSATION_ID,
        createdAt: toPrismaDateTime(secondDate),
        id: OUTSIDE_WINDOW_ID,
        iv: "outside-window-iv",
        keyEpoch: 1,
        ratchetIndex: 5,
        revision: 1,
        senderId: PEER_ID,
      },
    ]);
    await tx.orm.public.MessageHiddens.create({
      messageId: HIDDEN_ID,
      userId: OWNER_ID,
    });
  });
  await seedVerifiedMessageEpochFixture(CONVERSATION_ID);
});

afterAll(async () => {
  await prisma.orm.public.MessageConversations.where({
    id: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in([OWNER_ID, PEER_ID])
  ).deleteAndCount();
  await closeMessageSearchPool();
});

describe("hydrateSearchMessageCandidates", () => {
  test("rechecks revision, member wrap, private hides, and membership windows", async () => {
    const rows = await hydrateSearchMessageCandidates({
      conversationId: CONVERSATION_ID,
      membershipWindows: [
        {
          after: null,
          before: new Date("2026-10-08T00:00:00.500Z"),
        },
      ],
      messages: [
        { id: VISIBLE_ID, revision: 1 },
        { id: STALE_REVISION_ID, revision: 1 },
        { id: HIDDEN_ID, revision: 1 },
        { id: UNREADABLE_EPOCH_ID, revision: 1 },
        { id: OUTSIDE_WINDOW_ID, revision: 1 },
      ],
      userId: OWNER_ID,
    });

    expect(rows.map((row) => row.id)).toEqual([VISIBLE_ID]);
    expect(rows[0]).toMatchObject({
      ciphertext: "visible-ciphertext",
      id: VISIBLE_ID,
      keyEpoch: 1,
      revision: 1,
      senderId: PEER_ID,
    });
  });

  test("rejects malformed batches before querying", async () => {
    await expect(
      hydrateSearchMessageCandidates({
        conversationId: CONVERSATION_ID,
        membershipWindows: [],
        messages: [],
        userId: OWNER_ID,
      })
    ).rejects.toThrow("1 to 20 messages");
    await expect(
      hydrateSearchMessageCandidates({
        conversationId: CONVERSATION_ID,
        membershipWindows: [],
        messages: [{ id: VISIBLE_ID, revision: 0 }],
        userId: OWNER_ID,
      })
    ).rejects.toThrow("identifiers are invalid");
  });

  test("requires the requesting member to hold the message epoch wrap", async () => {
    const rows = await hydrateSearchMessageCandidates({
      conversationId: CONVERSATION_ID,
      membershipWindows: [{ after: null, before: null }],
      messages: [{ id: VISIBLE_ID, revision: 1 }],
      userId: PEER_ID,
    });

    expect(rows).toEqual([]);
  });
});
