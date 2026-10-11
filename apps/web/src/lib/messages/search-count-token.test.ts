import { describe, expect, test } from "bun:test";

import {
  createMessageSearchCountToken,
  readMessageSearchCountToken,
} from "./search-count-token";

const secret = "test-message-search-count-secret";
const token = {
  conversationId: "conversation-1",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  membershipSequence: 4,
  normalizationVersion: 1,
  queryHash: "query-hash",
  recoveryGeneration: 2,
  requestId: "request-1",
  snapshotSequence: 90,
  userId: "user-1",
};

describe("message search count tokens", () => {
  test("round trips with conversation and account scope", () => {
    const encoded = createMessageSearchCountToken(token, secret);
    expect(
      readMessageSearchCountToken(
        encoded,
        { conversationId: token.conversationId, userId: token.userId },
        secret
      )
    ).toEqual(token);
  });

  test("rejects tampering, cross-account use, and expiration", () => {
    const encoded = createMessageSearchCountToken(token, secret);
    expect(
      readMessageSearchCountToken(
        `${encoded}x`,
        { conversationId: token.conversationId, userId: token.userId },
        secret
      )
    ).toBeNull();
    expect(
      readMessageSearchCountToken(
        encoded,
        { conversationId: token.conversationId, userId: "user-2" },
        secret
      )
    ).toBeNull();
    const expired = createMessageSearchCountToken(
      { ...token, expiresAt: new Date(Date.now() - 1000).toISOString() },
      secret
    );
    expect(
      readMessageSearchCountToken(
        expired,
        { conversationId: token.conversationId, userId: token.userId },
        secret
      )
    ).toBeNull();
  });
});
