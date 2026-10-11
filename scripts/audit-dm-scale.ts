// Read-only synthetic audit of the production DM helpers; no database or network.
// Run with: bun scripts/audit-dm-scale.ts
// Timings measure Bun CPU work, not browser latency, IndexedDB, or device frames.

import { pagesToDropForTranscriptHistory } from "../apps/web/src/components/messages/viewer-history-window";
import { createMemorySearchIndexStore } from "../apps/web/src/lib/messages/memory-search-index";
import { createMessageIndexBackfill } from "../apps/web/src/lib/messages/message-index-backfill";
import { createMessageIndexWriter } from "../apps/web/src/lib/messages/message-index-writer";
import { rankSearchResults } from "../apps/web/src/lib/messages/message-search";
import { planSearchIndexEviction } from "../apps/web/src/lib/messages/search-index-eviction";
import {
  buildSearchIndexEntry,
  expandPrefixTerm,
  intersectPostingLists,
  selectNewestFirstWindow,
} from "../apps/web/src/lib/messages/search-index-format";

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function queryCpuSample(rowCount: number) {
  const rows = Uint32Array.from({ length: rowCount }, (_, row) => row);
  const times = Float64Array.from(rows, (row) => (row * 48_271) % rowCount);
  const samples: number[] = [];
  for (let repetition = 0; repetition < 8; repetition += 1) {
    const started = performance.now();
    const intersection = intersectPostingLists([{ rows, times }]);
    const result = selectNewestFirstWindow(intersection.matches, 20);
    requireCondition(intersection.totalMatched === rowCount, "Wrong total");
    requireCondition(result.window.length === 20, "Wrong window size");
    if (repetition > 0) {
      samples.push(performance.now() - started);
    }
  }
  samples.sort((left, right) => left - right);
  return {
    matchedRows: rowCount,
    returnedRows: 20,
    samples: samples.length,
    medianMs: rounded(samples[Math.floor(samples.length / 2)] ?? 0),
    maxMs: rounded(samples.at(-1) ?? 0),
  };
}

function postingRewriteModel(rowCount: number) {
  let serializedRows = 0;
  let chunks = 0;
  for (let pageStart = 0; pageStart < rowCount; pageStart += 500) {
    const pageEnd = Math.min(pageStart + 500, rowCount);
    for (let chunkStart = pageStart; chunkStart < pageEnd; chunkStart += 64) {
      serializedRows += Math.min(chunkStart + 64, pageEnd);
      chunks += 1;
    }
  }
  return {
    rowCount,
    chunks,
    serializedPostingRows: serializedRows,
    cumulativeArrayMiB: rounded((serializedRows * 12) / 1024 / 1024),
    finalArrayMiB: rounded((rowCount * 12) / 1024 / 1024),
  };
}

async function auditPendingOverflow() {
  const store = createMemorySearchIndexStore();
  const writer = createMessageIndexWriter({
    conversationId: "pending",
    getPayload: () => "error",
    store,
  });
  writer.consider(
    Array.from({ length: 6000 }, (_, index) => ({
      id: `pending-${index}`,
      senderId: "sender",
      createdAt: new Date(1_700_000_000_000 + index),
    }))
  );
  const result = await writer.flush();
  const persisted = await store.countPending("pending");
  return {
    unindexedReported: result.stillPending.length,
    durableOnDisk: persisted,
    lostAfterReload: result.stillPending.length - persisted,
    flushReportsFailure: result.failed,
  };
}

function auditWriterLifecycle() {
  const listeners = new Set<() => void>();
  let unsubscribeCalls = 0;
  for (let index = 0; index < 20; index += 1) {
    createMessageIndexWriter({
      conversationId: `conversation-${index}`,
      getPayload: () => undefined,
      store: createMemorySearchIndexStore(),
      subscribeToPayloads: (listener) => {
        listeners.add(listener);
        return () => {
          unsubscribeCalls += 1;
          listeners.delete(listener);
        };
      },
    });
  }
  return {
    createdWriters: 20,
    retainedListeners: listeners.size,
    unsubscribeCalls,
  };
}

async function auditRefsVerdict() {
  const underlying = createMemorySearchIndexStore();
  const store = {
    ...underlying,
    putSharedRefs: () =>
      Promise.reject(new Error("synthetic refs write failure")),
  };
  const writer = createMessageIndexWriter({
    conversationId: "refs",
    getPayload: () => ({ type: "text", content: "https://example.com/a" }),
    store,
  });
  const backfill = createMessageIndexBackfill({
    conversationId: "refs",
    awaitDecrypts: () => Promise.resolve(),
    fetchPage: () =>
      Promise.resolve({
        messages: [
          {
            id: "ref-message",
            senderId: "sender",
            createdAt: new Date(1_700_000_000_000),
            conversationId: "refs",
            ciphertext: "synthetic",
            iv: "synthetic",
            ratchetIndex: 0,
            editedAt: null,
            deletedAt: null,
            sender: null,
          },
        ],
        previousCursor: null,
      }),
    pageDelayMs: 0,
    store,
    writer,
  });
  const progress = await backfill.run();
  const refs = await underlying.readSharedRefs("refs", "link", { limit: 20 });
  return {
    refsReachedStart: progress.refsReachedStart,
    pendingCount: progress.pendingCount,
    storedLinks: refs.items.length,
  };
}

async function auditMatchingSemantics() {
  const store = createMemorySearchIndexStore();
  const built = buildSearchIndexEntry({
    text: "redeployment hello,",
    createdAt: 1,
    senderId: "sender",
  });
  requireCondition(built !== null, "Missing entry");
  if (built) {
    await store.putEntries("semantics", new Map([["message", built]]));
  }
  const persistent = await store.query("semantics", [], 20, {
    prefix: "deploy",
  });
  return {
    localSubstringMatches: rankSearchResults(
      [{ id: "message", text: "redeployment hello,", createdAt: 1 }],
      "deploy"
    ).length,
    persistedPrefixMatches: persistent.totalMatched,
    prefixExpansionsWith65Terms: expandPrefixTerm(
      Array.from({ length: 65 }, (_, index) => `hello${index}`),
      "hello"
    ).length,
  };
}

async function main() {
  const eviction = planSearchIndexEviction({
    activeConversationId: "conversation-19",
    summaries: Array.from({ length: 20 }, (_, index) => ({
      conversationId: `conversation-${index}`,
      indexedRowCount: 100_000,
      lastAccessedAt: index,
    })),
  });
  const output = {
    scope:
      "Synthetic Bun CPU/correctness checks; not browser performance or production data",
    queryCpu: [100_000, 200_000, 1_000_000].map(queryCpuSample),
    postingRewriteModel: [100_000, 200_000].map(postingRewriteModel),
    heavyUserCache: {
      conversations: 20,
      rowsPerConversation: 100_000,
      evicted: eviction.evict.length,
      remainingRows: eviction.remainingRows,
    },
    oldestBoundaryRetention: {
      loadedPages: 1000,
      pagesDropped: pagesToDropForTranscriptHistory({
        anchorMessageId: "oldest",
        findPageIndex: () => 0,
        firstVisibleIndex: 0,
        pageCount: 1000,
      }),
    },
    writerLifecycle: auditWriterLifecycle(),
    pendingOverflow: await auditPendingOverflow(),
    refsVerdict: await auditRefsVerdict(),
    matchingSemantics: await auditMatchingSemantics(),
  };
  console.log(JSON.stringify(output, null, 2));
}

await main();
