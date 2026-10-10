import { describe, expect, test } from "bun:test";

import {
  createSharedRefCursor,
  readSharedRefCursor,
} from "./shared-ref-cursor";

const scope = {
  conversationId: "conversation-1",
  kind: "media" as const,
  membershipSequence: 4,
  recoveryGeneration: 2,
  userId: "user-1",
};

describe("shared reference cursors", () => {
  test("round trips a stable snapshot cursor", () => {
    const token = createSharedRefCursor(
      {
        after: {
          createdAt: "2026-10-08T10:00:00.000Z",
          messageId: "message-1",
          ordinal: 2,
        },
        ...scope,
        snapshotSequence: 80,
      },
      "secret"
    );
    expect(readSharedRefCursor(token, scope, "secret")).toMatchObject({
      after: { messageId: "message-1", ordinal: 2 },
      direction: "older",
      snapshotSequence: 80,
    });
  });

  test("round trips a cursor that walks toward newer references", () => {
    const token = createSharedRefCursor(
      {
        after: {
          createdAt: "2026-10-08T10:00:00.000Z",
          messageId: "message-1",
          ordinal: 2,
        },
        direction: "newer",
        ...scope,
        snapshotSequence: 80,
      },
      "secret"
    );
    expect(readSharedRefCursor(token, scope, "secret")).toMatchObject({
      after: { messageId: "message-1", ordinal: 2 },
      direction: "newer",
      snapshotSequence: 80,
    });
  });

  test("rejects tampering and cursors from another permission scope", () => {
    const token = createSharedRefCursor(
      {
        after: {
          createdAt: "2026-10-08T10:00:00.000Z",
          messageId: "message-1",
          ordinal: 0,
        },
        ...scope,
        snapshotSequence: 80,
      },
      "secret"
    );
    expect(readSharedRefCursor(`${token}x`, scope, "secret")).toBeNull();
    expect(
      readSharedRefCursor(token, { ...scope, recoveryGeneration: 3 }, "secret")
    ).toBeNull();
    expect(
      readSharedRefCursor(token, { ...scope, kind: "link" }, "secret")
    ).toBeNull();
  });

  test("rejects malformed and oversized cursors", () => {
    expect(readSharedRefCursor("bad", scope, "secret")).toBeNull();
    expect(readSharedRefCursor("x".repeat(2049), scope, "secret")).toBeNull();
  });
});
