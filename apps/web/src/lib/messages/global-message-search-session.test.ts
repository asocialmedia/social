import { describe, expect, test } from "bun:test";

import {
  createGlobalMessageSearchCursor,
  createGlobalMessageSearchSessionToken,
  readGlobalMessageSearchCursor,
  readGlobalMessageSearchSessionToken,
} from "./global-message-search-session";

const secret = "global-message-search-test-secret";
const userId = "viewer-1";
const queryHash = "query-hash";
const sessionId = "123e4567-e89b-12d3-a456-426614174000";

describe("global message search tokens", () => {
  test("binds a short-lived session to its viewer and normalized query", () => {
    const expiresAt = 2_000_000;
    const token = createGlobalMessageSearchSessionToken(
      { expiresAt, queryHash, sessionId, userId },
      secret
    );

    expect(
      readGlobalMessageSearchSessionToken(
        token,
        { queryHash, userId },
        secret,
        1_000_000
      )?.sessionId
    ).toBe(sessionId);
    expect(
      readGlobalMessageSearchSessionToken(
        token,
        { queryHash: "another-query", userId },
        secret,
        1_000_000
      )
    ).toBeNull();
    expect(
      readGlobalMessageSearchSessionToken(
        token,
        { queryHash, userId: "another-user" },
        secret,
        1_000_000
      )
    ).toBeNull();
    expect(
      readGlobalMessageSearchSessionToken(
        token,
        { queryHash, userId },
        secret,
        expiresAt
      )
    ).toBeNull();
  });

  test("rejects tampered and oversized session tokens", () => {
    const token = createGlobalMessageSearchSessionToken(
      { expiresAt: Date.now() + 60_000, queryHash, sessionId, userId },
      secret
    );
    const [payload, signature] = token.split(".");
    if (!payload || !signature) {
      throw new Error("Expected a signed global search session token");
    }
    const changedFirstCharacter = signature[0] === "A" ? "B" : "A";
    const tampered = `${payload}.${changedFirstCharacter}${signature.slice(1)}`;

    expect(
      readGlobalMessageSearchSessionToken(
        tampered,
        { queryHash, userId },
        secret
      )
    ).toBeNull();
    expect(
      readGlobalMessageSearchSessionToken(
        "x".repeat(2000),
        { queryHash, userId },
        secret
      )
    ).toBeNull();
  });

  test("binds a cursor to one session and preserves the global ordering tuple", () => {
    const cursor = createGlobalMessageSearchCursor(
      {
        conversationId: "conversation-2",
        createdAt: "2026-10-18T08:30:00.000Z",
        messageId: "message-3",
        sessionId,
        userId,
      },
      secret
    );

    expect(
      readGlobalMessageSearchCursor(cursor, { sessionId, userId }, secret)
    ).toMatchObject({
      conversationId: "conversation-2",
      createdAt: "2026-10-18T08:30:00.000Z",
      messageId: "message-3",
    });
    expect(
      readGlobalMessageSearchCursor(
        cursor,
        { sessionId: "another-session", userId },
        secret
      )
    ).toBeNull();
  });
});
