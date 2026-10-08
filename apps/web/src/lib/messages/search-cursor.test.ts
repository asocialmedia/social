import { describe, expect, test } from "bun:test";

import {
  createMessageSearchCursor,
  messageSearchQueryHash,
  readMessageSearchCursor,
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
