import { describe, expect, test } from "bun:test";

import type { CommunityChatMessage } from "./community-chat";
import {
  communityChatMessageBytes,
  mergeCommunityChatTimeline,
} from "./community-chat-timeline";

function message(sequence: number, content = "hello"): CommunityChatMessage {
  return {
    changeSequence: String(sequence),
    createdAt: "2026-10-18T00:00:00.000Z",
    deletedAt: null,
    editedAt: null,
    id: String(sequence),
    payload: { content, type: "text" },
    replyToId: null,
    revision: 1,
    roomId: "channel",
    sender: {
      avatarUrl: null,
      displayName: "Alice",
      id: "alice",
      username: "alice",
    },
    senderId: "alice",
    sequence: String(sequence),
  };
}

describe("community timeline windows", () => {
  test("keeps newly loaded older history when the window is full", () => {
    const result = mergeCommunityChatTimeline(
      [message(3), message(4)],
      [message(1), message(2)],
      { edge: "older", maxMessages: 3 }
    );
    expect(result.messages.map((entry) => entry.id)).toEqual(["1", "2", "3"]);
    expect(result.trimmedAfter).toBe(true);
  });

  test("keeps the live tail when appending beyond the count budget", () => {
    const result = mergeCommunityChatTimeline(
      [message(1), message(2)],
      [message(3), message(4)],
      { edge: "newer", maxMessages: 3 }
    );
    expect(result.messages.map((entry) => entry.id)).toEqual(["2", "3", "4"]);
    expect(result.trimmedBefore).toBe(true);
  });

  test("bounds serialized UTF-8 bytes, including multilingual content", () => {
    const entries = [
      message(1, "💬".repeat(100)),
      message(2, "界".repeat(100)),
    ];
    const maxBytes = communityChatMessageBytes(message(2, "界".repeat(100)));
    const result = mergeCommunityChatTimeline([], entries, {
      edge: "newer",
      maxBytes,
    });
    expect(result.messages.map((entry) => entry.id)).toEqual(["2"]);
    expect(result.bytes).toBeLessThanOrEqual(maxBytes);
  });

  test("rejects stale revisions, out-of-order changes, and resurrection", () => {
    const original = message(1);
    const edited = {
      ...original,
      changeSequence: "8",
      payload: { content: "edited", type: "text" as const },
      revision: 2,
    };
    const deleted = {
      ...edited,
      changeSequence: "9",
      deletedAt: "2026-10-18T00:01:00.000Z",
      payload: null,
      revision: 3,
    };
    const result = mergeCommunityChatTimeline(
      [deleted],
      [original, edited, { ...edited, revision: 4 }],
      { edge: "newer" }
    );
    expect(result.messages).toEqual([deleted]);
  });
});
