import { expect, test } from "bun:test";

import {
  closeMessageSearchPool,
  countMessageSearchCandidates,
  keys,
  prisma,
  searchMessageCandidates,
  toPrismaDateTime,
} from "@asm/db";

const MESSAGE_COUNT = 200_000;
const MESSAGE_BATCH_SIZE = 100;
const TRANSACTION_BATCH_SIZE = 10_000;
const CONCURRENT_SEARCHES = 50;
const RUN_ID = crypto.randomUUID();
const CONVERSATION_ID = crypto.randomUUID();
const OWNER_ID = `search-scale-owner-${RUN_ID}`;
const PEER_ID = `search-scale-peer-${RUN_ID}`;
const BASE_TIME = new Date("2026-01-01T00:00:00.000Z");
const COMMON_TERM = "common";
const RARE_TERM = "rare";

function assertLocalTestDatabase(): void {
  const databaseUrl = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5433" ||
    databaseUrl.pathname.replace(/^\//u, "") !== "asocialmedia"
  ) {
    throw new Error(
      "Refusing to run the DM search scale test outside the local test database"
    );
  }
}

function messageId(sequence: number): string {
  return `dm-search-scale-${RUN_ID}-${String(sequence).padStart(6, "0")}`;
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

async function search(query: string) {
  return await searchMessageCandidates({
    conversationId: CONVERSATION_ID,
    fragments: [{ grams: gramKeys(query), text: query }],
    limit: 20,
    membershipWindows: [{ after: null, before: null }],
    snapshotSequence: MESSAGE_COUNT,
    userId: OWNER_ID,
  });
}

async function seedConversation(): Promise<void> {
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
      changeSeq: MESSAGE_COUNT,
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
      encryptedKey: "scale-test-wrap",
      iv: "scale-test-iv",
      ownerUserId: OWNER_ID,
      version: 1,
    });
    await tx.orm.public.MessageSearchTerms.createAll(
      [COMMON_TERM, RARE_TERM].map((normalized) => ({
        conversationId: CONVERSATION_ID,
        gramKeys: gramKeys(normalized),
        normalized,
      }))
    );
  });

  const terms = await prisma.orm.public.MessageSearchTerms.select(
    "id",
    "normalized"
  )
    .where({ conversationId: CONVERSATION_ID })
    .all();
  const termIds = new Map(terms.map((term) => [term.normalized, term.id]));
  const commonTermId = termIds.get(COMMON_TERM);
  const rareTermId = termIds.get(RARE_TERM);
  if (commonTermId === undefined || rareTermId === undefined) {
    throw new Error("DM search scale fixture terms were not created");
  }

  // Sequential bounded transactions avoid turning fixture setup into a write burst.
  // oxlint-disable no-await-in-loop -- Preserve the fixture's database batch and transaction bounds.
  for (
    let transactionStart = 1;
    transactionStart <= MESSAGE_COUNT;
    transactionStart += TRANSACTION_BATCH_SIZE
  ) {
    const transactionEnd = Math.min(
      transactionStart + TRANSACTION_BATCH_SIZE,
      MESSAGE_COUNT + 1
    );
    await prisma.transaction(async (tx) => {
      for (
        let batchStart = transactionStart;
        batchStart < transactionEnd;
        batchStart += MESSAGE_BATCH_SIZE
      ) {
        const batchEnd = Math.min(
          batchStart + MESSAGE_BATCH_SIZE,
          transactionEnd
        );
        const messages = Array.from(
          { length: batchEnd - batchStart },
          (_, offset) => {
            const sequence = batchStart + offset;
            return {
              ciphertext: "synthetic-encrypted-payload",
              conversationId: CONVERSATION_ID,
              createdAt: toPrismaDateTime(
                new Date(BASE_TIME.getTime() + sequence)
              ),
              creationSequence: sequence,
              id: messageId(sequence),
              iv: "synthetic-iv",
              keyEpoch: 1,
              ratchetIndex: sequence,
              revision: 1,
              senderId: PEER_ID,
            };
          }
        );
        const documents = messages.map((message) => ({
          conversationId: CONVERSATION_ID,
          createdAt: message.createdAt,
          messageId: message.id,
          revision: 1,
          termIds:
            message.creationSequence === MESSAGE_COUNT
              ? [commonTermId, rareTermId]
              : [commonTermId],
        }));
        await tx.orm.public.Messages.createAll(messages);
        await tx.orm.public.MessageSearchDocuments.createAll(documents);
      }
    });
  }
  // oxlint-enable no-await-in-loop
}

test.skipIf(process.env.RUN_MESSAGE_SEARCH_SCALE !== "1")(
  "searches a 200k-message DM under broad and concurrent query load",
  async () => {
    assertLocalTestDatabase();
    try {
      await seedConversation();

      const newestId = messageId(MESSAGE_COUNT);
      const rareHits = await search(RARE_TERM);
      expect(rareHits.map((row) => row.id)).toEqual([newestId]);

      const broadHits = await search(COMMON_TERM);
      expect(broadHits).toHaveLength(20);
      expect(broadHits[0]?.id).toBe(newestId);
      expect(broadHits[19]?.id).toBe(messageId(MESSAGE_COUNT - 19));

      const countStartedAt = performance.now();
      const broadCount = await countMessageSearchCandidates({
        conversationId: CONVERSATION_ID,
        fragments: [{ grams: gramKeys(COMMON_TERM), text: COMMON_TERM }],
        membershipWindows: [{ after: null, before: null }],
        snapshotSequence: MESSAGE_COUNT,
        userId: OWNER_ID,
      });
      const exactCountDurationMs = performance.now() - countStartedAt;
      expect(broadCount).toBe(MESSAGE_COUNT);

      const durations: number[] = [];
      const concurrentPages = await Promise.all(
        Array.from({ length: CONCURRENT_SEARCHES }, async () => {
          const startedAt = performance.now();
          const rows = await search(COMMON_TERM);
          durations.push(performance.now() - startedAt);
          return rows;
        })
      );
      const sortedDurations = durations.toSorted((left, right) => left - right);
      const p95DurationMs =
        sortedDurations[Math.ceil(sortedDurations.length * 0.95) - 1];
      console.info(
        JSON.stringify({
          concurrentSearches: CONCURRENT_SEARCHES,
          exactCountMs: exactCountDurationMs,
          messages: MESSAGE_COUNT,
          p95BroadSearchMs: p95DurationMs,
          test: "dm-search-scale",
        })
      );
      expect(concurrentPages).toHaveLength(CONCURRENT_SEARCHES);
      expect(concurrentPages.every((page) => page.length === 20)).toBe(true);
      expect(p95DurationMs).toBeDefined();
      expect(p95DurationMs).toBeLessThan(5000);
    } finally {
      await prisma.orm.public.MessageSearchDocuments.where({
        conversationId: CONVERSATION_ID,
      }).deleteAndCount();
      await prisma.orm.public.MessageSearchTerms.where({
        conversationId: CONVERSATION_ID,
      }).deleteAndCount();
      await prisma.orm.public.MessageConversations.where({
        id: CONVERSATION_ID,
      }).deleteAndCount();
      await prisma.orm.public.Users.where((user) =>
        user.id.in([OWNER_ID, PEER_ID])
      ).deleteAndCount();
      await closeMessageSearchPool();
    }
  },
  600_000
);
