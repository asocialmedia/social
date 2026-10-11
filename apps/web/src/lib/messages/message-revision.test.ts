import { describe, expect, test } from "bun:test";

import {
  shouldReconcileMessageEvent,
  shouldReplaceMessageRevision,
} from "./message-revision";

describe("message revision admission", () => {
  test("accepts newer source revisions and rejects duplicates or older events", () => {
    expect(shouldReplaceMessageRevision({ revision: 2 }, { revision: 3 })).toBe(
      true
    );
    expect(shouldReplaceMessageRevision({ revision: 3 }, { revision: 3 })).toBe(
      false
    );
    expect(shouldReplaceMessageRevision({ revision: 3 }, { revision: 2 })).toBe(
      false
    );
  });

  test("keeps legacy rows compatible without downgrading a versioned row", () => {
    expect(shouldReplaceMessageRevision({}, {})).toBe(true);
    expect(shouldReplaceMessageRevision({}, { revision: 2 })).toBe(true);
    expect(shouldReplaceMessageRevision({ revision: 2 }, {})).toBe(false);
  });

  test("rejects invalid revisions rather than trusting malformed events", () => {
    for (const revision of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(shouldReplaceMessageRevision({}, { revision })).toBe(false);
    }
  });

  test("a deleted row cannot be resurrected even by a higher numbered edit", () => {
    expect(
      shouldReplaceMessageRevision(
        { deletedAt: new Date(), revision: 2 },
        { deletedAt: null, revision: 3 }
      )
    ).toBe(false);
  });

  test("reconciles mutations and permission changes without replaying each live arrival", () => {
    for (const kind of [
      "message.edited",
      "message.deleted",
      "keys.rotated",
      "den.membership.changed",
    ]) {
      expect(shouldReconcileMessageEvent(kind)).toBe(true);
    }
    for (const kind of [
      "message.created",
      "typing.started",
      "conversation.read",
    ]) {
      expect(shouldReconcileMessageEvent(kind)).toBe(false);
    }
  });
});
