import { describe, expect, test } from "bun:test";

import {
  createMessageChangeCursor,
  readMessageChangeCursor,
} from "./change-cursor";

const now = 1_800_000_000_000;
const secret = "test-message-change-cursor-secret";
const scope = {
  conversationId: "conversation-1",
  membershipSequence: 8,
  recoveryGeneration: 3,
  userId: "user-1",
};

describe("message change cursors", () => {
  test("signs and validates the cursor scope and snapshot", () => {
    const cursor = createMessageChangeCursor(
      { ...scope, afterSequence: 15, snapshotSequence: 21 },
      secret,
      now
    );

    expect(readMessageChangeCursor(cursor, scope, secret, now)).toEqual({
      cursor: {
        ...scope,
        afterSequence: 15,
        issuedAt: now,
        snapshotSequence: 21,
      },
      status: "valid",
    });
    expect(
      readMessageChangeCursor(
        cursor,
        { ...scope, recoveryGeneration: 4 },
        secret,
        now
      )
    ).toEqual({ status: "scope-changed" });
  });

  test("requires a valid signature and rejects expired cursors", () => {
    const cursor = createMessageChangeCursor(
      { ...scope, afterSequence: 0, snapshotSequence: 0 },
      secret,
      now - 8 * 24 * 60 * 60 * 1000
    );

    expect(readMessageChangeCursor(cursor, scope, secret, now)).toEqual({
      status: "expired",
    });
    expect(readMessageChangeCursor(`${cursor}x`, scope, secret, now)).toEqual({
      status: "invalid",
    });
    expect(readMessageChangeCursor("", scope, secret, now)).toEqual({
      status: "invalid",
    });
  });
});
