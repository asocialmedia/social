import { describe, expect, test } from "bun:test";

import {
  createMessageSearchCursor,
  createMessageSearchSnapshot,
  messageSearchQueryHash,
  readMessageSearchCursor,
  readMessageSearchSnapshot,
} from "./search-cursor";

const secret = "test-search-secret";
const scope = {
  conversationId: "conversation-1",
  membershipSequence: 4,
  normalizationVersion: 1,
  queryHash: messageSearchQueryHash("search term"),
  recoveryGeneration: 2,
  snapshotSequence: 90,
  userId: "user-1",
};

describe("message search cursors", () => {
  test("signs reverse direction while keeping older cursors compatible", () => {
    const cursor = {
      ...scope,
      after: { createdAt: "2026-10-08T10:00:00.000Z", messageId: "m20" },
      direction: "newer" as const,
    };
    const token = createMessageSearchCursor(cursor, secret);
    expect(readMessageSearchCursor(token, scope, secret)).toEqual(cursor);
    expect(readMessageSearchCursor(`${token}x`, scope, secret)).toBeNull();
    expect(
      readMessageSearchCursor(
        token,
        { ...scope, membershipSequence: 5 },
        secret
      )
    ).toBeNull();
    expect(
      readMessageSearchCursor(
        token,
        { ...scope, normalizationVersion: 2 },
        secret
      )
    ).toBeNull();
  });
  test("round trips with a stable timestamp and complete scope", () => {
    const token = createMessageSearchCursor(
      {
        ...scope,
        after: {
          createdAt: "2026-10-08T10:00:00.000Z",
          messageId: "message-19",
        },
      },
      secret
    );
    expect(readMessageSearchCursor(token, scope, secret)).toEqual({
      ...scope,
      after: {
        createdAt: "2026-10-08T10:00:00.000Z",
        messageId: "message-19",
      },
    });
  });

  test("rejects tampering and a cursor from another account, query, or generation", () => {
    const token = createMessageSearchCursor(
      {
        ...scope,
        after: { createdAt: "2026-10-08T10:00:00.000Z", messageId: "m1" },
      },
      secret
    );
    expect(readMessageSearchCursor(`${token}x`, scope, secret)).toBeNull();
    expect(
      readMessageSearchCursor(token, { ...scope, userId: "user-2" }, secret)
    ).toBeNull();
    expect(
      readMessageSearchCursor(
        token,
        { ...scope, recoveryGeneration: 3 },
        secret
      )
    ).toBeNull();
  });
});

describe("message search snapshots", () => {
  test("round trips while preserving the original search sequence", () => {
    const snapshot = { ...scope, snapshotSequence: 90 };
    const token = createMessageSearchSnapshot(snapshot, secret);
    expect(readMessageSearchSnapshot(token, scope, secret)).toEqual(snapshot);
  });

  test("rejects tampered tokens and tokens from another permission scope", () => {
    const token = createMessageSearchSnapshot(
      { ...scope, snapshotSequence: 90 },
      secret
    );
    expect(readMessageSearchSnapshot(`${token}x`, scope, secret)).toBeNull();
    expect(
      readMessageSearchSnapshot(
        token,
        { ...scope, normalizationVersion: 2 },
        secret
      )
    ).toBeNull();
    expect(
      readMessageSearchSnapshot(token, { ...scope, userId: "user-2" }, secret)
    ).toBeNull();
    expect(
      readMessageSearchSnapshot(
        token,
        { ...scope, queryHash: messageSearchQueryHash("other query") },
        secret
      )
    ).toBeNull();
  });
});
