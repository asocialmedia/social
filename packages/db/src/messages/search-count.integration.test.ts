import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  claimMessageSearchCountRequest,
  closeMessageSearchPool,
  commitMessageSearchMutation,
  completeMessageSearchCountRequest,
  countMessageSearchCandidates,
  getMessageSearchCountRequestStatus,
  keys,
  listMessageSearchReferences,
  listRunnableMessageSearchCounts,
  prisma,
  persistSearchDocument,
  releaseMessageSearchCountRequest,
  requestMessageSearchCount,
  toPrismaDateTime,
} from "@asm/db";
import { Client } from "pg";

const RUN_ID = crypto.randomUUID();
const CONVERSATION_ID = crypto.randomUUID();
const OWNER_ID = `search-count-owner-${RUN_ID}`;
const PEER_ID = `search-count-peer-${RUN_ID}`;
const VISIBLE_MESSAGE_ID = crypto.randomUUID();
const HIDDEN_MESSAGE_ID = crypto.randomUUID();
const COUNT_REQUEST_IDS: string[] = [];
const OUTBOX_IDS: string[] = [];

function searchGrams(value: string): string[] {
  const points = [...value];
  const grams = new Set<string>();
  for (let width = 1; width <= 3; width += 1) {
    for (let index = 0; index + width <= points.length; index += 1) {
      grams.add(`${width}:${points.slice(index, index + width).join("")}`);
    }
  }
  return [...grams];
}

function assertLocalTestDatabase(): void {
  const databaseUrl = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5433" ||
    databaseUrl.pathname.replace(/^\//, "") !== "asocialmedia"
  ) {
    throw new Error(
      "Refusing to run DM search count integration tests outside the local test database"
    );
  }
}

beforeAll(async () => {
  assertLocalTestDatabase();
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
      changeSeq: 2,
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
      encryptedKey: "ciphertext-under-test",
      iv: "iv-under-test",
      ownerUserId: OWNER_ID,
      version: 1,
    });
    await tx.orm.public.Messages.createAll([
      {
        ciphertext: "ciphertext-visible",
        conversationId: CONVERSATION_ID,
        creationSequence: 1,
        id: VISIBLE_MESSAGE_ID,
        iv: "iv-visible",
        keyEpoch: 1,
        ratchetIndex: 1,
        senderId: OWNER_ID,
      },
      {
        ciphertext: "ciphertext-hidden",
        conversationId: CONVERSATION_ID,
        creationSequence: 2,
        id: HIDDEN_MESSAGE_ID,
        iv: "iv-hidden",
        keyEpoch: 1,
        ratchetIndex: 2,
        senderId: PEER_ID,
      },
    ]);
    await tx.orm.public.MessageHiddens.create({
      messageId: HIDDEN_MESSAGE_ID,
      userId: OWNER_ID,
    });
    const term = await tx.orm.public.MessageSearchTerms.create({
      conversationId: CONVERSATION_ID,
      gramKeys: searchGrams("needle"),
      normalized: "needle",
    });
    await tx.orm.public.MessageSearchDocuments.createAll([
      {
        conversationId: CONVERSATION_ID,
        createdAt: toPrismaDateTime(new Date("2026-10-08T00:00:00.000Z")),
        messageId: VISIBLE_MESSAGE_ID,
        revision: 1,
        termIds: [term.id],
      },
      {
        conversationId: CONVERSATION_ID,
        createdAt: toPrismaDateTime(new Date("2026-10-08T00:00:01.000Z")),
        messageId: HIDDEN_MESSAGE_ID,
        revision: 1,
        termIds: [term.id],
      },
    ]);
  });
  const client = new Client({ connectionString: keys.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO public.message_search_coverage
         ("conversationId", "rowsTraversed", "artifactsCommitted",
          "unrecoverableEpochs", "completedChangeSeq", "backfillCompletedAt")
       VALUES ($1, 2, 2, 0, 2, now())`,
      [CONVERSATION_ID]
    );
    await client.query(
      `INSERT INTO public.message_search_references
         ("messageId", "conversationId", kind, ordinal, "createdAt", revision, "mediaKind", "requiredId")
       VALUES
         ($1, $2, 'media', 0, '2026-10-08 00:00:00', 1, 'image', 'visible-media-0'),
         ($1, $2, 'media', 1, '2026-10-08 00:00:00', 1, 'image', 'visible-media-1'),
         ($3, $2, 'media', 0, '2026-10-08 00:00:01', 1, 'image', 'hidden-media')`,
      [VISIBLE_MESSAGE_ID, CONVERSATION_ID, HIDDEN_MESSAGE_ID]
    );
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  if (OUTBOX_IDS.length > 0) {
    await prisma.orm.public.MessageSearchOutbox.where((outbox) =>
      outbox.id.in(OUTBOX_IDS)
    ).deleteAndCount();
  }
  if (COUNT_REQUEST_IDS.length > 0) {
    await prisma.orm.public.MessageSearchCountRequests.where((row) =>
      row.id.in(COUNT_REQUEST_IDS)
    ).deleteAndCount();
  }
  await prisma.orm.public.MessageSearchReferences.where({
    conversationId: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageSearchDocuments.where({
    conversationId: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageSearchTerms.where({
    conversationId: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageSearchCoverage.where({
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

describe("durable DM search counts", () => {
  test("pages current shared references after applying hide and key visibility", async () => {
    const first = await listMessageSearchReferences({
      conversationId: CONVERSATION_ID,
      kind: "media",
      limit: 1,
      membershipWindows: [{ after: null, before: null }],
      snapshotSequence: 2,
      userId: OWNER_ID,
    });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      messageId: VISIBLE_MESSAGE_ID,
      ordinal: 0,
      requiredId: "visible-media-0",
    });
    const second = await listMessageSearchReferences({
      after: first[0],
      conversationId: CONVERSATION_ID,
      kind: "media",
      limit: 10,
      membershipWindows: [{ after: null, before: null }],
      snapshotSequence: 2,
      userId: OWNER_ID,
    });
    expect(second).toHaveLength(1);
    const [secondRow] = second;
    if (!secondRow) {
      throw new Error("expected a second shared reference");
    }
    expect(secondRow).toMatchObject({
      messageId: VISIBLE_MESSAGE_ID,
      ordinal: 1,
      requiredId: "visible-media-1",
    });
    const newer = await listMessageSearchReferences({
      before: secondRow,
      conversationId: CONVERSATION_ID,
      kind: "media",
      limit: 10,
      membershipWindows: [{ after: null, before: null }],
      snapshotSequence: 2,
      userId: OWNER_ID,
    });
    expect(newer).toHaveLength(1);
    expect(newer[0]).toMatchObject({
      messageId: VISIBLE_MESSAGE_ID,
      ordinal: 0,
      requiredId: "visible-media-0",
    });
  });

  test("counts exact authorized results and drops query material after completion", async () => {
    const fragments = [{ grams: searchGrams("needle"), text: "needle" }];
    const request = await requestMessageSearchCount({
      conversationId: CONVERSATION_ID,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      fragments,
      membershipSequence: 0,
      membershipWindows: [{ after: null, before: null }],
      normalizationVersion: 1,
      queryHash: "count-test-query",
      recoveryGeneration: 0,
      snapshotSequence: 2,
      userId: OWNER_ID,
    });
    COUNT_REQUEST_IDS.push(request.id);
    expect(request.state).toBe("pending");
    expect(await listRunnableMessageSearchCounts(20)).toContain(request.id);

    const claimed = await claimMessageSearchCountRequest(request.id);
    expect(claimed?.attempts).toBe(1);
    if (!claimed) {
      throw new Error("expected the durable count request to be claimed");
    }
    expect(claimed.createdAt).toBeInstanceOf(Date);
    expect(claimed.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
    const exactCount = await countMessageSearchCandidates({
      conversationId: CONVERSATION_ID,
      fragments: claimed.fragments,
      membershipWindows: claimed.membershipWindows,
      snapshotSequence: claimed.snapshotSequence,
      userId: claimed.userId,
    });
    expect(exactCount).toBe(1);
    await completeMessageSearchCountRequest(request.id, exactCount);
    await expect(
      getMessageSearchCountRequestStatus({
        conversationId: CONVERSATION_ID,
        id: request.id,
        userId: OWNER_ID,
      })
    ).resolves.toMatchObject({ exactCount: 1, state: "exact" });
    const persisted = await prisma.orm.public.MessageSearchCountRequests.select(
      "fragments",
      "membershipWindows"
    )
      .where({ id: request.id })
      .first();
    expect(persisted?.fragments).toBeNull();
    expect(persisted?.membershipWindows).toBeNull();

    const edited = await commitMessageSearchMutation({
      ciphertext: "ciphertext-edited",
      conversationId: CONVERSATION_ID,
      editWindowStart: new Date(Date.now() - 60 * 60 * 1000),
      editedAt: new Date(),
      expectedRevision: 1,
      iv: "iv-edited",
      kind: "upsert",
      messageId: VISIBLE_MESSAGE_ID,
      senderId: OWNER_ID,
    });
    if (edited.status !== "updated") {
      throw new Error("expected the search fixture edit to commit");
    }
    OUTBOX_IDS.push(edited.outboxId);
    await persistSearchDocument({
      conversationId: CONVERSATION_ID,
      keyEpoch: 1,
      messageId: VISIBLE_MESSAGE_ID,
      outboxId: edited.outboxId,
      references: [],
      revision: edited.revision,
      terms: [{ gramKeys: searchGrams("needle"), normalized: "needle" }],
    });
    await expect(
      getMessageSearchCountRequestStatus({
        conversationId: CONVERSATION_ID,
        id: request.id,
        userId: OWNER_ID,
      })
    ).resolves.toMatchObject({ exactCount: null, state: "unavailable" });
    await expect(
      persistSearchDocument({
        conversationId: CONVERSATION_ID,
        keyEpoch: 1,
        messageId: VISIBLE_MESSAGE_ID,
        outboxId: edited.outboxId,
        references: [
          {
            kind: "media",
            mediaKind: "image",
            ordinal: 0,
            requiredId: "stale-media",
          },
        ],
        revision: 1,
        terms: [{ gramKeys: searchGrams("needle"), normalized: "needle" }],
      })
    ).resolves.toEqual({ status: "superseded" });
    await expect(
      listMessageSearchReferences({
        conversationId: CONVERSATION_ID,
        kind: "media",
        limit: 10,
        membershipWindows: [{ after: null, before: null }],
        snapshotSequence: 3,
        userId: OWNER_ID,
      })
    ).resolves.toEqual([]);
    expect(
      await countMessageSearchCandidates({
        conversationId: CONVERSATION_ID,
        fragments,
        membershipWindows: [{ after: null, before: null }],
        snapshotSequence: 2,
        userId: OWNER_ID,
      })
    ).toBe(0);
    expect(
      await countMessageSearchCandidates({
        conversationId: CONVERSATION_ID,
        fragments,
        membershipWindows: [{ after: null, before: null }],
        snapshotSequence: 3,
        userId: OWNER_ID,
      })
    ).toBe(1);
  });

  test("deduplicates identical requests and supersedes older pending work", async () => {
    const base = {
      conversationId: CONVERSATION_ID,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      fragments: [{ grams: searchGrams("needle"), text: "needle" }],
      membershipSequence: 0,
      membershipWindows: [{ after: null, before: null }],
      normalizationVersion: 1,
      recoveryGeneration: 0,
      snapshotSequence: 3,
      userId: OWNER_ID,
    };
    const first = await requestMessageSearchCount({
      ...base,
      queryHash: "superseded-query",
    });
    COUNT_REQUEST_IDS.push(first.id);
    const duplicate = await requestMessageSearchCount({
      ...base,
      queryHash: "superseded-query",
    });
    expect(duplicate.id).toBe(first.id);
    const latest = await requestMessageSearchCount({
      ...base,
      queryHash: "latest-query",
    });
    COUNT_REQUEST_IDS.push(latest.id);
    expect(latest.id).not.toBe(first.id);
    await expect(
      getMessageSearchCountRequestStatus({
        conversationId: CONVERSATION_ID,
        id: first.id,
        userId: OWNER_ID,
      })
    ).resolves.toMatchObject({ state: "cancelled" });
    const claimed = await claimMessageSearchCountRequest(latest.id);
    expect(claimed?.attempts).toBe(1);
    await releaseMessageSearchCountRequest(latest.id);
    await expect(
      getMessageSearchCountRequestStatus({
        conversationId: CONVERSATION_ID,
        id: latest.id,
        userId: OWNER_ID,
      })
    ).resolves.toMatchObject({ state: "pending" });
  });

  test("does not commit an exact count after its source snapshot changes", async () => {
    const conversation = await prisma.orm.public.MessageConversations.select(
      "changeSeq",
      "membershipSeq"
    )
      .where({ id: CONVERSATION_ID })
      .first();
    if (!conversation) {
      throw new Error("expected the count fixture conversation to exist");
    }
    const request = await requestMessageSearchCount({
      conversationId: CONVERSATION_ID,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      fragments: [{ grams: searchGrams("needle"), text: "needle" }],
      membershipSequence: conversation.membershipSeq,
      membershipWindows: [{ after: null, before: null }],
      normalizationVersion: 1,
      queryHash: "count-source-race-query",
      recoveryGeneration: 0,
      snapshotSequence: conversation.changeSeq,
      userId: OWNER_ID,
    });
    COUNT_REQUEST_IDS.push(request.id);
    const claimed = await claimMessageSearchCountRequest(request.id);
    expect(claimed?.id).toBe(request.id);

    const edited = await commitMessageSearchMutation({
      ciphertext: "count-source-race-edit",
      conversationId: CONVERSATION_ID,
      editWindowStart: new Date(Date.now() - 60 * 60 * 1000),
      editedAt: new Date(),
      expectedRevision: 2,
      iv: "count-source-race-iv",
      kind: "upsert",
      messageId: VISIBLE_MESSAGE_ID,
      senderId: OWNER_ID,
    });
    if (edited.status !== "updated") {
      throw new Error("expected the count source edit to commit");
    }
    OUTBOX_IDS.push(edited.outboxId);

    await completeMessageSearchCountRequest(request.id, 1);
    await expect(
      getMessageSearchCountRequestStatus({
        conversationId: CONVERSATION_ID,
        id: request.id,
        userId: OWNER_ID,
      })
    ).resolves.toMatchObject({ exactCount: null, state: "unavailable" });
  });
});
