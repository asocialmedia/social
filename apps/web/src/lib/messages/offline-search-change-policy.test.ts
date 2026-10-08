import { describe, expect, test } from "bun:test";

import type { DurableMessageChange } from "./durable-change-replay";
import { planOfflineSearchChangeEffects } from "./offline-search-change-policy";

function change(
  overrides: Partial<DurableMessageChange> = {}
): DurableMessageChange {
  return {
    globallyDeleted: false,
    hiddenForViewer: false,
    id: "change-1",
    kind: "message.edited",
    messageId: "message-1",
    revision: 2,
    sequence: 1,
    sourceAvailable: true,
    sourceRevision: 2,
    ...overrides,
  };
}

describe("offline search replay change policy", () => {
  test("removes changed entries behind revision and sequence tombstones", () => {
    expect(planOfflineSearchChangeEffects([change()])).toEqual({
      invalidateDecryptIds: ["message-1"],
      messageIds: ["message-1"],
      removals: [
        {
          id: "message-1",
          revisionFloor: 2,
          sequence: 1,
          unavailable: false,
        },
      ],
      unavailableIds: [],
    });
  });

  test("uses the newest visibility state when one replay contains several changes", () => {
    const plan = planOfflineSearchChangeEffects([
      change({
        hiddenForViewer: true,
        sequence: 2,
        sourceAvailable: false,
        sourceRevision: null,
      }),
      change({
        hiddenForViewer: false,
        revision: 4,
        sequence: 4,
        sourceRevision: 4,
      }),
      change({
        globallyDeleted: true,
        revision: 5,
        sequence: 5,
        sourceAvailable: false,
        sourceRevision: null,
      }),
      change({ sequence: 3, sourceAvailable: true }),
    ]);

    expect(plan).toEqual({
      invalidateDecryptIds: ["message-1"],
      messageIds: ["message-1"],
      removals: [
        {
          id: "message-1",
          revisionFloor: null,
          sequence: 5,
          unavailable: true,
        },
      ],
      unavailableIds: ["message-1"],
    });
  });

  test("ignores conversation-level changes without a message id", () => {
    expect(
      planOfflineSearchChangeEffects([change({ messageId: null })])
    ).toEqual({
      invalidateDecryptIds: [],
      messageIds: [],
      removals: [],
      unavailableIds: [],
    });
  });
});
