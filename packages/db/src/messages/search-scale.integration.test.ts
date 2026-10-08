import { expect, test } from "bun:test";

import {
  closeMessageSearchPool,
  commitMessageSearchBackfillBatch,
  countMessageSearchCandidates,
  keys,
  persistSearchDocument,
  prisma,
  readNextMessageSearchBackfillBatch,
  searchMessageCandidates,
  startMessageSearchBackfill,
  toPrismaDateTime,
} from "@asm/db";
import { Pool } from "pg";

import { explainSearchMessageCandidatesForDiagnostics } from "./search-index";

const SCALE_PROFILES = {
  "1m": { conversations: 1, messagesPerConversation: 1_000_000 },
  "200k": { conversations: 1, messagesPerConversation: 200_000 },
  "20x100k": { conversations: 20, messagesPerConversation: 100_000 },
  "20x200k": { conversations: 20, messagesPerConversation: 200_000 },
} as const;
const SCALE_PROFILE =
  process.env.MESSAGE_SEARCH_SCALE_PROFILE === "1m" ||
  process.env.MESSAGE_SEARCH_SCALE_PROFILE === "20x100k" ||
  process.env.MESSAGE_SEARCH_SCALE_PROFILE === "20x200k"
    ? process.env.MESSAGE_SEARCH_SCALE_PROFILE
    : "200k";
const {
  conversations: CONVERSATION_COUNT,
  messagesPerConversation: MESSAGE_COUNT,
} = SCALE_PROFILES[SCALE_PROFILE];
const MESSAGE_BATCH_SIZE = 100;
const TRANSACTION_BATCH_SIZE = 10_000;
const CONCURRENT_SEARCHES = 50;
const CONCURRENT_LIVE_INDEX_WRITES = 40;
const LIVE_INDEX_CONCURRENCY = 2;
const HIDDEN_NEWEST_MESSAGE_COUNT = 10;
const RUN_ID = crypto.randomUUID();
const CONVERSATION_IDS = Array.from({ length: CONVERSATION_COUNT }, () =>
  crypto.randomUUID()
);
const OWNER_ID = `search-scale-owner-${RUN_ID}`;
const PEER_IDS = CONVERSATION_IDS.map(
  (_, index) => `search-scale-peer-${RUN_ID}-${index}`
);
const [CONVERSATION_ID] = CONVERSATION_IDS;

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

function messageId(conversationIndex: number, sequence: number): string {
  return `dm-search-scale-${RUN_ID}-${String(conversationIndex).padStart(2, "0")}-${String(sequence).padStart(7, "0")}`;
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

async function search(
  query: string,
  conversationId = CONVERSATION_ID,
  before?: { createdAt: Date; messageId: string }
) {
  return await searchMessageCandidates({
    ...(before ? { before } : {}),
    conversationId,
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
      [OWNER_ID, ...PEER_IDS].map((id) => ({
        displayName: id,
        email: `${id}@example.test`,
        id,
        username: id,
      }))
    );
    await tx.orm.public.MessageConversations.createAll(
      CONVERSATION_IDS.map((id, index) => ({
        _type: "DM" as const,
        changeSeq: MESSAGE_COUNT,
        id,
        pairKey: [OWNER_ID, PEER_IDS[index]].toSorted().join(":"),
      }))
    );
    await tx.orm.public.MessageConversationMembers.createAll(
      CONVERSATION_IDS.flatMap((conversationId, index) =>
        [OWNER_ID, PEER_IDS[index]].map((userId) => ({
          conversationId,
          userId,
        }))
      )
    );
    await tx.orm.public.MessageConversationKeys.createAll(
      CONVERSATION_IDS.map((conversationId) => ({
        conversationId,
        encryptedKey: "scale-test-wrap",
        iv: "scale-test-iv",
        ownerUserId: OWNER_ID,
        version: 1,
      }))
    );
    await tx.orm.public.MessageSearchTerms.createAll(
      CONVERSATION_IDS.flatMap((conversationId) =>
        [COMMON_TERM, RARE_TERM].map((normalized) => ({
          conversationId,
          gramKeys: gramKeys(normalized),
          normalized,
        }))
      )
    );
  });

  // oxlint-disable no-await-in-loop -- Keep large fixture conversations sequential to bound write pressure.
  for (
    let conversationIndex = 0;
    conversationIndex < CONVERSATION_COUNT;
    conversationIndex += 1
  ) {
    const conversationId = CONVERSATION_IDS[conversationIndex];
    const peerId = PEER_IDS[conversationIndex];
    if (!conversationId || !peerId) {
      throw new Error("DM search scale fixture conversation was not created");
    }
    const terms = await prisma.orm.public.MessageSearchTerms.select(
      "id",
      "normalized"
    )
      .where({ conversationId })
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
                conversationId,
                createdAt: toPrismaDateTime(
                  new Date(BASE_TIME.getTime() + sequence)
                ),
                creationSequence: sequence,
                id: messageId(conversationIndex, sequence),
                iv: "synthetic-iv",
                keyEpoch: 1,
                ratchetIndex: sequence,
                revision: 1,
                senderId: peerId,
              };
            }
          );
          const documents = messages.map((message) => ({
            conversationId,
            createdAt: message.createdAt,
            messageId: message.id,
            revision: 1,
            termIds:
              message.creationSequence === 1
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
  // oxlint-enable no-await-in-loop
  const statisticsPool = new Pool({
    connectionString: keys.DATABASE_URL,
    max: 1,
  });
  try {
    await statisticsPool.query("ANALYZE public.message_search_documents");
  } finally {
    await statisticsPool.end();
  }
}

async function seedPendingLiveIndexWrites(): Promise<
  {
    conversationId: string;
    messageId: string;
    outboxId: string;
    revision: number;
  }[]
> {
  const pending = Array.from(
    { length: CONCURRENT_LIVE_INDEX_WRITES },
    (_, offset) => {
      const conversationIndex = offset % CONVERSATION_COUNT;
      const conversationId = CONVERSATION_IDS[conversationIndex];
      const peerId = PEER_IDS[conversationIndex];
      if (!conversationId || !peerId) {
        throw new Error("DM search scale fixture conversation was not created");
      }
      const sequence =
        MESSAGE_COUNT + Math.floor(offset / CONVERSATION_COUNT) + 1;
      return {
        audienceUserIds: [OWNER_ID, peerId],
        changeSequence: sequence,
        conversationId,
        conversationIndex,
        createdAt: toPrismaDateTime(new Date(BASE_TIME.getTime() + sequence)),
        id: messageId(conversationIndex, sequence),
        outboxId: crypto.randomUUID(),
        peerId,
        sequence,
      };
    }
  );

  await prisma.transaction(async (tx) => {
    const finalSequenceByConversation = new Map<number, number>();
    for (const row of pending) {
      finalSequenceByConversation.set(row.conversationIndex, row.sequence);
    }
    for (const [conversationIndex, changeSeq] of finalSequenceByConversation) {
      const conversationId = CONVERSATION_IDS[conversationIndex];
      if (!conversationId) {
        throw new Error("DM search scale fixture conversation was not created");
      }
      // oxlint-disable-next-line no-await-in-loop -- Keep fixture sequence updates inside one transaction.
      await tx.orm.public.MessageConversations.where({
        id: conversationId,
      }).update({
        changeSeq,
      });
    }
    await tx.orm.public.Messages.createAll(
      pending.map((row) => ({
        ciphertext: "synthetic-live-encrypted-payload",
        conversationId: row.conversationId,
        createdAt: row.createdAt,
        creationSequence: row.sequence,
        id: row.id,
        iv: "synthetic-live-iv",
        keyEpoch: 1,
        ratchetIndex: row.sequence,
        revision: 1,
        senderId: row.peerId,
      }))
    );
    await tx.orm.public.MessageSearchOutbox.createAll(
      pending.map((row) => ({
        audienceUserIds: row.audienceUserIds,
        changeSequence: row.changeSequence,
        conversationId: row.conversationId,
        id: row.outboxId,
        kind: "upsert",
        messageId: row.id,
        revision: 1,
      }))
    );
    await tx.orm.public.MessageConversationChanges.createAll(
      pending.map((row) => ({
        audienceUserIds: row.audienceUserIds,
        conversationId: row.conversationId,
        kind: "message.created",
        messageId: row.id,
        revision: 1,
        sequence: row.changeSequence,
      }))
    );
  });

  return pending.map(({ conversationId, id, outboxId }) => ({
    conversationId,
    messageId: id,
    outboxId,
    revision: 1,
  }));
}

async function processPendingLiveIndexWrites(
  pending: Awaited<ReturnType<typeof seedPendingLiveIndexWrites>>
): Promise<void> {
  let nextIndex = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(LIVE_INDEX_CONCURRENCY, pending.length) },
      async () => {
        while (nextIndex < pending.length) {
          const write = pending[nextIndex];
          nextIndex += 1;
          if (!write) {
            throw new Error(
              "DM search scale fixture lost a pending index write"
            );
          }
          // oxlint-disable-next-line no-await-in-loop -- Model the configured two-worker live-index limit.
          const result = await persistSearchDocument({
            conversationId: write.conversationId,
            keyEpoch: 1,
            messageId: write.messageId,
            outboxId: write.outboxId,
            references: [],
            revision: write.revision,
            terms: [
              { gramKeys: gramKeys(COMMON_TERM), normalized: COMMON_TERM },
            ],
          });
          if (result.status !== "indexed") {
            throw new Error("DM search scale live index write was superseded");
          }
        }
      }
    )
  );
}

async function commitConcurrentBackfillBatch(): Promise<boolean> {
  const started = await startMessageSearchBackfill(CONVERSATION_ID);
  if (!started || started.throughSequence === null || started.completedAt) {
    throw new Error(
      "DM search scale fixture could not start historical backfill"
    );
  }
  const batch = await readNextMessageSearchBackfillBatch(CONVERSATION_ID);
  if (!batch || batch.messages.length === 0) {
    throw new Error("DM search scale fixture did not read a backfill batch");
  }
  const lastMessage = batch.messages.at(-1);
  if (!lastMessage) {
    throw new Error("DM search scale fixture returned an empty backfill batch");
  }
  const result = await commitMessageSearchBackfillBatch({
    artifacts: batch.messages.map((message) => ({
      createdAt: message.createdAt,
      keyEpoch: 1,
      messageId: message.id,
      references: [],
      revision: message.revision,
      terms: [{ gramKeys: gramKeys(COMMON_TERM), normalized: COMMON_TERM }],
    })),
    conversationId: CONVERSATION_ID,
    expectedPosition: batch.expectedPosition,
    finished: false,
    nextPosition: {
      createdAt: lastMessage.createdAt,
      messageId: lastMessage.id,
    },
    rowsTraversed: batch.messages.length,
    throughSequence: batch.throughSequence,
    unrecoverableEpochs: 0,
  });
  return result.committed;
}

function requireFulfilled<T>(
  result: PromiseSettledResult<T>,
  operation: string
): T {
  if (result.status === "rejected") {
    throw new Error(`DM search scale ${operation} failed`, {
      cause: result.reason,
    });
  }
  return result.value;
}

test.skipIf(process.env.RUN_MESSAGE_SEARCH_SCALE !== "1")(
  `searches ${CONVERSATION_COUNT} DM(s) with ${MESSAGE_COUNT} messages each under broad and concurrent query load`,
  async () => {
    assertLocalTestDatabase();
    try {
      await seedConversation();
      await prisma.orm.public.MessageHiddens.createAll(
        Array.from({ length: HIDDEN_NEWEST_MESSAGE_COUNT }, (_, index) => ({
          messageId: messageId(0, MESSAGE_COUNT - index),
          userId: OWNER_ID,
        }))
      );
      console.info(
        JSON.stringify({
          conversations: CONVERSATION_COUNT,
          messagesPerConversation: MESSAGE_COUNT,
          stage: "seeded",
          test: "dm-search-scale",
        })
      );
      const indexedTerms = await prisma.orm.public.MessageSearchTerms.select(
        "documentFrequency",
        "id",
        "normalized"
      )
        .where({ conversationId: CONVERSATION_ID })
        .all();
      const commonTerm = indexedTerms.find(
        (term) => term.normalized === COMMON_TERM
      );
      const rareTerm = indexedTerms.find(
        (term) => term.normalized === RARE_TERM
      );
      if (!rareTerm) {
        throw new Error("DM search scale fixture rare term was not created");
      }
      expect(commonTerm?.documentFrequency).toBe(MESSAGE_COUNT);
      expect(rareTerm.documentFrequency).toBe(1);

      const rareHits = await search(RARE_TERM);
      expect(rareHits.map((row) => row.id)).toEqual([messageId(0, 1)]);
      const rareQueryPlan = await explainSearchMessageCandidatesForDiagnostics({
        conversationId: CONVERSATION_ID,
        fragments: [{ grams: gramKeys(RARE_TERM), text: RARE_TERM }],
        indexedTermIds: [rareTerm.id],
        limit: 20,
        membershipWindows: [{ after: null, before: null }],
        snapshotSequence: MESSAGE_COUNT,
        userId: OWNER_ID,
      });
      if (!rareQueryPlan) {
        throw new Error("Postgres returned no DM search query plan");
      }
      expect(rareQueryPlan.indexNames).toContain(
        "message_search_documents_term_ids_idx"
      );
      const selectiveDocumentScan = rareQueryPlan.planNodes.find(
        (node) => node.relationName === "message_search_documents"
      );
      expect(selectiveDocumentScan).toBeDefined();
      expect(selectiveDocumentScan?.actualRows).toBeLessThan(1000);

      const broadHits = await search(COMMON_TERM);
      expect(broadHits).toHaveLength(20);
      expect(broadHits[0]?.id).toBe(
        messageId(0, MESSAGE_COUNT - HIDDEN_NEWEST_MESSAGE_COUNT)
      );
      expect(broadHits[19]?.id).toBe(
        messageId(0, MESSAGE_COUNT - HIDDEN_NEWEST_MESSAGE_COUNT - 19)
      );
      const lastBroadHit = broadHits.at(-1);
      if (!lastBroadHit) {
        throw new Error("DM search scale fixture returned no broad-query hit");
      }
      const nextBroadHits = await search(COMMON_TERM, CONVERSATION_ID, {
        createdAt: lastBroadHit.createdAt,
        messageId: lastBroadHit.id,
      });
      expect(nextBroadHits).toHaveLength(20);
      expect(nextBroadHits[0]?.id).toBe(
        messageId(0, MESSAGE_COUNT - HIDDEN_NEWEST_MESSAGE_COUNT - 20)
      );
      expect(
        nextBroadHits.every(
          (hit) => !broadHits.some((previousHit) => previousHit.id === hit.id)
        )
      ).toBe(true);
      const broadQueryPlan = await explainSearchMessageCandidatesForDiagnostics(
        {
          conversationId: CONVERSATION_ID,
          fragments: [{ grams: gramKeys(COMMON_TERM), text: COMMON_TERM }],
          limit: 20,
          membershipWindows: [{ after: null, before: null }],
          snapshotSequence: MESSAGE_COUNT,
          strategy: "ordered",
          userId: OWNER_ID,
        }
      );
      if (!broadQueryPlan) {
        throw new Error("Postgres returned no broad DM search query plan");
      }
      expect(broadQueryPlan.indexNames).toContain(
        "message_search_documents_conversation_created_message_idx"
      );
      expect(
        broadQueryPlan.planNodes.some(
          (node) =>
            node.relationName === "message_search_documents" &&
            node.nodeType === "Seq Scan"
        )
      ).toBe(false);
      const broadCandidateHitPlan =
        await explainSearchMessageCandidatesForDiagnostics({
          candidateMessageIds: Array.from({ length: 100 }, (_, index) =>
            messageId(0, MESSAGE_COUNT - HIDDEN_NEWEST_MESSAGE_COUNT - index)
          ),
          conversationId: CONVERSATION_ID,
          fragments: [{ grams: gramKeys(COMMON_TERM), text: COMMON_TERM }],
          limit: 20,
          membershipWindows: [{ after: null, before: null }],
          snapshotSequence: MESSAGE_COUNT,
          strategy: "orderedHits",
          userId: OWNER_ID,
        });
      if (!broadCandidateHitPlan) {
        throw new Error("Postgres returned no ordered search hit plan");
      }
      expect(broadCandidateHitPlan.indexNames).toContain(
        "message_search_documents_pkey"
      );

      const countStartedAt = performance.now();
      const broadCount = await countMessageSearchCandidates({
        conversationId: CONVERSATION_ID,
        fragments: [{ grams: gramKeys(COMMON_TERM), text: COMMON_TERM }],
        membershipWindows: [{ after: null, before: null }],
        snapshotSequence: MESSAGE_COUNT,
        userId: OWNER_ID,
      });
      const exactCountDurationMs = performance.now() - countStartedAt;
      expect(broadCount).toBe(MESSAGE_COUNT - HIDDEN_NEWEST_MESSAGE_COUNT);

      const pendingLiveIndexWrites = await seedPendingLiveIndexWrites();
      const concurrentSearches = Promise.all(
        Array.from({ length: CONCURRENT_SEARCHES }, async (_, index) => {
          const conversationIndex = index % CONVERSATION_COUNT;
          const conversationId =
            CONVERSATION_IDS[conversationIndex] ?? CONVERSATION_ID;
          const startedAt = performance.now();
          try {
            const rows = await search(COMMON_TERM, conversationId);
            return {
              conversationIndex,
              durationMs: performance.now() - startedAt,
              rows,
            };
          } catch (error) {
            return {
              conversationIndex,
              durationMs: performance.now() - startedAt,
              errorMessage:
                error instanceof Error ? error.message : "Unknown search error",
            };
          }
        })
      );
      const liveIndexing = processPendingLiveIndexWrites(
        pendingLiveIndexWrites
      );
      const historicalBackfill = commitConcurrentBackfillBatch();
      const [searchesSettled, liveIndexingSettled, backfillSettled] =
        await Promise.allSettled([
          concurrentSearches,
          liveIndexing,
          historicalBackfill,
        ]);
      const concurrentAttempts = requireFulfilled(
        searchesSettled,
        "concurrent searches"
      );
      const liveIndexingResult = requireFulfilled(
        liveIndexingSettled,
        "live indexing"
      );
      const backfillCommitted = requireFulfilled(
        backfillSettled,
        "historical backfill"
      );
      expect(liveIndexingResult).toBeUndefined();
      expect(backfillCommitted).toBe(true);
      const durations = concurrentAttempts.map((attempt) => attempt.durationMs);
      const concurrentPages = concurrentAttempts.flatMap((attempt) =>
        "rows" in attempt && attempt.rows !== undefined ? [attempt.rows] : []
      );
      const failureMessages = [
        ...new Set(
          concurrentAttempts.flatMap((attempt) =>
            "errorMessage" in attempt ? [attempt.errorMessage] : []
          )
        ),
      ];
      const failuresByConversation = Object.groupBy(
        concurrentAttempts.filter((attempt) => "errorMessage" in attempt),
        (attempt) => attempt.conversationIndex
      );
      const sortedDurations = durations.toSorted((left, right) => left - right);
      const broadDocumentScan = broadQueryPlan.planNodes.find(
        (node) => node.relationName === "message_search_documents"
      );
      const p95DurationMs =
        sortedDurations[Math.ceil(sortedDurations.length * 0.95) - 1];
      const rareDocumentScan = rareQueryPlan.planNodes.find(
        (node) => node.relationName === "message_search_documents"
      );
      console.info(
        JSON.stringify({
          backfillBatchCommitted: backfillCommitted,
          broadCandidateHitExecutionMs: Math.round(
            broadCandidateHitPlan.executionTimeMs
          ),
          broadDocumentScan: broadDocumentScan
            ? {
                actualRows: broadDocumentScan.actualRows,
                indexName: broadDocumentScan.indexName,
                nodeType: broadDocumentScan.nodeType,
                rowsRemovedByFilter: broadDocumentScan.rowsRemovedByFilter,
                sharedHitBlocks: broadDocumentScan.sharedHitBlocks,
                sharedReadBlocks: broadDocumentScan.sharedReadBlocks,
              }
            : null,
          broadQueryExecutionMs: Math.round(broadQueryPlan.executionTimeMs),
          concurrentLiveIndexWrites: pendingLiveIndexWrites.length,
          concurrentSearches: CONCURRENT_SEARCHES,
          conversations: CONVERSATION_COUNT,
          exactCountMs: Math.round(exactCountDurationMs),
          failedSearches: CONCURRENT_SEARCHES - concurrentPages.length,
          failureMessages,
          failuresByConversation: Object.fromEntries(
            Object.entries(failuresByConversation).map(([index, attempts]) => [
              index,
              attempts?.length ?? 0,
            ])
          ),
          messagesPerConversation: MESSAGE_COUNT,
          p95BroadSearchMs: Math.round(p95DurationMs),
          rareCandidateRows: rareDocumentScan?.actualRows,
          rareQueryExecutionMs: Math.round(rareQueryPlan.executionTimeMs),
          test: "dm-search-scale",
        })
      );
      expect(concurrentPages).toHaveLength(CONCURRENT_SEARCHES);
      expect(concurrentPages.every((page) => page.length === 20)).toBe(true);
      expect(p95DurationMs).toBeDefined();
      expect(p95DurationMs).toBeLessThan(300);
    } finally {
      await prisma.orm.public.MessageSearchDocuments.where((document) =>
        document.conversationId.in(CONVERSATION_IDS)
      ).deleteAndCount();
      await prisma.orm.public.MessageSearchTerms.where((term) =>
        term.conversationId.in(CONVERSATION_IDS)
      ).deleteAndCount();
      await prisma.orm.public.MessageConversations.where((conversation) =>
        conversation.id.in(CONVERSATION_IDS)
      ).deleteAndCount();
      await prisma.orm.public.Users.where((user) =>
        user.id.in([OWNER_ID, ...PEER_IDS])
      ).deleteAndCount();
      await closeMessageSearchPool();
    }
  },
  900_000
);
