import { describe, expect, test } from "bun:test";

import type { OfflineSearchCacheRecord } from "./offline-search-cache";
import {
  decodeOfflineSearchCursor,
  encodeOfflineSearchCursor,
  offlineSearchRecordToMessageData,
  shouldUseOfflineSearchForStatus,
} from "./offline-search-fallback";

describe("offline search fallback", () => {
  test("uses saved history for transient server failures but never access denials", () => {
    for (const status of [408, 429, 500, 502, 503]) {
      expect(shouldUseOfflineSearchForStatus(status)).toBe(true);
    }
    for (const status of [400, 401, 403, 404]) {
      expect(shouldUseOfflineSearchForStatus(status)).toBe(false);
    }
  });

  test("round-trips keyset cursors and rejects malformed cursor state", () => {
    const cursor = { createdAt: 1234, id: "message-1" };
    expect(
      decodeOfflineSearchCursor(encodeOfflineSearchCursor(cursor))
    ).toEqual(cursor);
    expect(decodeOfflineSearchCursor(null)).toBeUndefined();
    expect(decodeOfflineSearchCursor("{}")).toBeUndefined();
    expect(
      decodeOfflineSearchCursor(JSON.stringify({ createdAt: 1.5, id: "x" }))
    ).toBeUndefined();
  });

  test("hydrates only ciphertext metadata for an offline result row", () => {
    const record: OfflineSearchCacheRecord = {
      cachedAt: 123,
      ciphertext: "encrypted",
      conversationId: "conversation-1",
      createdAt: 456,
      id: "message-1",
      iv: "iv",
      keyEpoch: 2,
      ratchetIndex: 3,
      references: [],
      revision: 4,
      senderId: "user-1",
      terms: ["searchable"],
    };
    expect(offlineSearchRecordToMessageData("conversation-1", record)).toEqual({
      ciphertext: "encrypted",
      conversationId: "conversation-1",
      createdAt: new Date(456),
      deletedAt: null,
      editedAt: null,
      id: "message-1",
      iv: "iv",
      keyEpoch: 2,
      ratchetIndex: 3,
      revision: 4,
      sender: null,
      senderId: "user-1",
    });
  });
});
