import { describe, expect, test } from "bun:test";

import {
  buildOfflineSearchCacheRecord,
  estimateOfflineSearchRecordBytes,
  OFFLINE_SEARCH_MAX_MESSAGES_PER_CONVERSATION,
  offlineSearchRecords,
  retainOfflineSearchRecords,
} from "./offline-search-cache";
import type { OfflineSearchCacheRecord } from "./offline-search-cache";

function record(
  input: {
    cachedAt?: number;
    conversationId?: string;
    createdAt?: number;
    ciphertext?: string;
    id?: string;
    revision?: number;
    terms?: string[];
  } = {}
): OfflineSearchCacheRecord {
  return {
    cachedAt: input.cachedAt ?? 1,
    ciphertext: input.ciphertext ?? "ciphertext",
    conversationId: input.conversationId ?? "conversation-1",
    createdAt: input.createdAt ?? 1,
    id: input.id ?? "message-1",
    iv: "iv",
    keyEpoch: 1,
    ratchetIndex: 2,
    references: [],
    revision: input.revision ?? 1,
    senderId: "user-1",
    terms: input.terms ?? ["needle"],
  };
}

function recordKey(conversationId: string, id: string): string {
  return `${conversationId}\u0000${id}`;
}

describe("bounded offline DM search cache contract", () => {
  test("stores ciphertext, normalized terms, and ID-only references without message bodies", () => {
    const source = {
      ciphertext: "encrypted-message-body",
      conversationId: "conversation-1",
      createdAt: new Date("2026-10-08T10:00:00.000Z"),
      id: "message-1",
      iv: "message-iv",
      keyEpoch: 3,
      ratchetIndex: 8,
      revision: 2,
      senderId: "user-1",
    };
    const payload = {
      content: "Private caption https://example.com/private",
      images: [{ url: "/api/media/media_123", width: 320 }],
      kind: "image",
      type: "media",
    } as const;
    const cached = buildOfflineSearchCacheRecord({
      cachedAt: 100,
      message: source,
      payload,
    });

    expect(cached).not.toBeNull();
    if (!cached) {
      throw new Error("expected a valid offline cache record");
    }
    expect(cached).toMatchObject({
      ciphertext: source.ciphertext,
      conversationId: source.conversationId,
      id: source.id,
      keyEpoch: 3,
      ratchetIndex: 8,
      references: [
        { id: "media_123", index: 0, kind: "media", mediaKind: "image" },
        { index: 0, kind: "link" },
      ],
      revision: 2,
      terms: [
        "private",
        "caption",
        "https://example.com/private",
        "shared",
        "an",
        "image",
      ],
    });
    const serialized = JSON.stringify(cached);
    expect(serialized).not.toContain("Private caption");
    expect(serialized).not.toContain('"url"');
    expect(estimateOfflineSearchRecordBytes(cached)).toBe(
      new TextEncoder().encode(serialized).byteLength
    );
  });

  test("rejects invalid source revisions and timestamps instead of caching them", () => {
    const message = {
      ciphertext: "ciphertext",
      conversationId: "conversation-1",
      createdAt: "not-a-date",
      id: "message-1",
      iv: "iv",
      keyEpoch: null,
      ratchetIndex: 0,
      revision: 1,
      senderId: "user-1",
    };
    expect(
      buildOfflineSearchCacheRecord({
        message,
        payload: { content: "valid", type: "text" },
      })
    ).toBeNull();
    expect(
      buildOfflineSearchCacheRecord({
        message: { ...message, createdAt: new Date(), revision: -1 },
        payload: { content: "valid", type: "text" },
      })
    ).toBeNull();
  });

  test("matches fragments with the shared accent, punctuation, and script rules", () => {
    const rows = [
      record({ terms: ["https://example.com/path", "cafe", "東京語"] }),
    ];
    expect(
      offlineSearchRecords(rows, { query: "EXAMPLE.com cafÉ 東" }).hits
    ).toHaveLength(1);
    expect(offlineSearchRecords(rows, { query: "x" }).totalMatches).toBe(0);
    expect(
      offlineSearchRecords(rows, { query: "cafe missing" }).totalMatches
    ).toBe(0);
  });

  test("pages tied timestamps newest-first with a stable createdAt-and-id cursor", () => {
    const rows = [
      record({ createdAt: 20, id: "a" }),
      record({ createdAt: 20, id: "c" }),
      record({ createdAt: 20, id: "b" }),
      record({ createdAt: 19, id: "z" }),
    ];
    const first = offlineSearchRecords(rows, { limit: 2, query: "needle" });
    const second = offlineSearchRecords(rows, {
      before: first.nextCursor ?? undefined,
      limit: 2,
      query: "needle",
    });
    expect(first.hits.map((hit) => hit.id)).toEqual(["c", "b"]);
    expect(first.totalMatches).toBe(4);
    expect(first.hasMore).toBe(true);
    expect(second.hits.map((hit) => hit.id)).toEqual(["a", "z"]);
    expect(second.hasMore).toBe(false);
  });

  test("keeps the newest 1,000 messages per conversation and rejects stale revisions", () => {
    const existing = Array.from({ length: 1000 }, (_, index) =>
      record({ createdAt: index, id: `message-${index}`, revision: 2 })
    );
    const incoming = [
      record({ createdAt: 1000, id: "message-1000", revision: 1 }),
      record({
        ciphertext: "stale-ciphertext",
        createdAt: 1001,
        id: "message-10",
        revision: 1,
      }),
    ];
    const result = retainOfflineSearchRecords({
      activeConversationId: "conversation-1",
      existing,
      incoming,
    });
    expect(result.records).toHaveLength(
      OFFLINE_SEARCH_MAX_MESSAGES_PER_CONVERSATION
    );
    expect(result.records.some((row) => row.id === "message-0")).toBe(false);
    expect(result.records.find((row) => row.id === "message-10")).toMatchObject(
      {
        ciphertext: "ciphertext",
        revision: 2,
      }
    );
  });

  test("evicts least-recently-cached history to stay within the account byte budget", () => {
    const old = record({ cachedAt: 1, conversationId: "old", id: "old-1" });
    const active = record({
      cachedAt: 2,
      conversationId: "active",
      id: "active-1",
    });
    const activeBytes = estimateOfflineSearchRecordBytes(active);
    const result = retainOfflineSearchRecords({
      activeConversationId: "active",
      budgetBytes: activeBytes,
      existing: [old],
      incoming: [active],
    });
    expect(result.records).toEqual([active]);
    expect(result.evictedConversationIds).toEqual(["old"]);
    expect(result.totalBytes).toBe(activeBytes);
  });

  test("drops an individual oversized payload gracefully when it cannot fit", () => {
    const huge = record({ ciphertext: "x".repeat(4096) });
    const result = retainOfflineSearchRecords({
      activeConversationId: "conversation-1",
      budgetBytes: 64,
      existing: [],
      incoming: [huge],
    });
    expect(result.records).toEqual([]);
    expect(result.evictedMessageKeys).toEqual([
      recordKey("conversation-1", "message-1"),
    ]);
    expect(result.totalBytes).toBe(0);
  });
});
