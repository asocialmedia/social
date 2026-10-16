import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  closeMessageSearchPool,
  commitMessageSearchMutation,
  keys,
  persistSearchDocument,
  prisma,
} from "@asm/db";

const RUN_ID = crypto.randomUUID();
const CONVERSATION_ID = crypto.randomUUID();
const OWNER_ID = `search-frequency-owner-${RUN_ID}`;
const PEER_ID = `search-frequency-peer-${RUN_ID}`;
const MESSAGE_ID = `search-frequency-message-${RUN_ID}`;
const OUTBOX_IDS: string[] = [];

function assertLocalTestDatabase(): void {
  const databaseUrl = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5433" ||
    databaseUrl.pathname.replace(/^\//u, "") !== "asocialmedia"
  ) {
    throw new Error(
      "Refusing to run DM search frequency integration tests outside the local test database"
    );
  }
}

function gramKeys(value: string): string[] {
  const points = [
    ...value.normalize("NFD").replaceAll(/\p{M}/gu, "").toLowerCase(),
  ];
  const grams = new Set<string>();
  for (let width = 1; width <= 3; width += 1) {
    for (let start = 0; start + width <= points.length; start += 1) {
      grams.add(`${width}:${points.slice(start, start + width).join("")}`);
    }
  }
  return [...grams];
}

async function termFrequencies() {
  return await prisma.orm.public.MessageSearchTerms.select(
    "documentFrequency",
    "normalized"
  )
    .where({ conversationId: CONVERSATION_ID })
    .orderBy((term) => term.normalized.asc())
    .all();
}

beforeAll(async () => {
  assertLocalTestDatabase();
  await prisma.transaction(async (tx) => {
    await tx.orm.public.Users.createAll(
      [OWNER_ID, PEER_ID].map((id) => ({
        displayName: id,
        email: `${id}@example.test`,
        id,
        username: id,
      }))
    );
    await tx.orm.public.MessageConversations.create({
      _type: "DM",
      id: CONVERSATION_ID,
      pairKey: [OWNER_ID, PEER_ID].toSorted().join(":"),
    });
    await tx.orm.public.MessageConversationMembers.createAll(
      [OWNER_ID, PEER_ID].map((userId) => ({
        conversationId: CONVERSATION_ID,
        userId,
      }))
    );
    await tx.orm.public.Messages.create({
      ciphertext: "initial-ciphertext",
      conversationId: CONVERSATION_ID,
      creationSequence: 1,
      id: MESSAGE_ID,
      iv: "initial-iv",
      keyEpoch: 1,
      ratchetIndex: 0,
      revision: 1,
      senderId: OWNER_ID,
    });
  });
});

afterAll(async () => {
  await prisma.orm.public.MessageSearchDocuments.where({
    conversationId: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageSearchReferences.where({
    conversationId: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageSearchTerms.where({
    conversationId: CONVERSATION_ID,
  }).deleteAndCount();
  if (OUTBOX_IDS.length > 0) {
    await prisma.orm.public.MessageSearchOutbox.where((outbox) =>
      outbox.id.in(OUTBOX_IDS)
    ).deleteAndCount();
  }
  await prisma.orm.public.MessageConversationChanges.where({
    conversationId: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageConversations.where({
    id: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in([OWNER_ID, PEER_ID])
  ).deleteAndCount();
  await closeMessageSearchPool();
});

describe("search term document frequency", () => {
  test("tracks bulk document changes, retries, and deletion cleanup exactly", async () => {
    const firstEdit = await commitMessageSearchMutation({
      ciphertext: "revision-two-ciphertext",
      conversationId: CONVERSATION_ID,
      editWindowStart: new Date(Date.now() - 12 * 60 * 60 * 1000),
      editedAt: new Date(),
      expectedRevision: 1,
      iv: "revision-two-iv",
      kind: "upsert",
      messageId: MESSAGE_ID,
      senderId: OWNER_ID,
    });
    if (firstEdit.status !== "updated") {
      throw new Error("expected the initial search frequency edit to commit");
    }
    OUTBOX_IDS.push(firstEdit.outboxId);

    const firstArtifact = {
      conversationId: CONVERSATION_ID,
      keyEpoch: 1,
      messageId: MESSAGE_ID,
      outboxId: firstEdit.outboxId,
      references: [],
      revision: firstEdit.revision,
      terms: ["alpha", "beta"].map((normalized) => ({
        gramKeys: gramKeys(normalized),
        normalized,
      })),
    };
    await expect(persistSearchDocument(firstArtifact)).resolves.toEqual({
      status: "indexed",
    });
    expect(await termFrequencies()).toEqual([
      { documentFrequency: 1, normalized: "alpha" },
      { documentFrequency: 1, normalized: "beta" },
    ]);

    await expect(persistSearchDocument(firstArtifact)).resolves.toEqual({
      status: "indexed",
    });
    expect(await termFrequencies()).toEqual([
      { documentFrequency: 1, normalized: "alpha" },
      { documentFrequency: 1, normalized: "beta" },
    ]);

    const secondEdit = await commitMessageSearchMutation({
      ciphertext: "revision-three-ciphertext",
      conversationId: CONVERSATION_ID,
      editWindowStart: new Date(Date.now() - 12 * 60 * 60 * 1000),
      editedAt: new Date(),
      expectedRevision: 2,
      iv: "revision-three-iv",
      kind: "upsert",
      messageId: MESSAGE_ID,
      senderId: OWNER_ID,
    });
    if (secondEdit.status !== "updated") {
      throw new Error("expected the second search frequency edit to commit");
    }
    OUTBOX_IDS.push(secondEdit.outboxId);
    await persistSearchDocument({
      ...firstArtifact,
      outboxId: secondEdit.outboxId,
      revision: secondEdit.revision,
      terms: ["beta", "gamma"].map((normalized) => ({
        gramKeys: gramKeys(normalized),
        normalized,
      })),
    });
    expect(await termFrequencies()).toEqual([
      { documentFrequency: 0, normalized: "alpha" },
      { documentFrequency: 1, normalized: "beta" },
      { documentFrequency: 1, normalized: "gamma" },
    ]);

    const deletion = await commitMessageSearchMutation({
      conversationId: CONVERSATION_ID,
      deletedAt: new Date(),
      expectedRevision: 3,
      kind: "delete",
      messageId: MESSAGE_ID,
      senderId: OWNER_ID,
    });
    if (deletion.status !== "updated") {
      throw new Error("expected the global message deletion to commit");
    }
    OUTBOX_IDS.push(deletion.outboxId);
    await persistSearchDocument({
      ...firstArtifact,
      outboxId: deletion.outboxId,
      revision: deletion.revision,
    });
    expect(await termFrequencies()).toEqual([]);
  });
});
