import { describe, expect, test } from "bun:test";

import type { CommunityChatChange } from "@asm/messages";

import {
  classifyCommunityChatChange,
  isStaleCommunityChatChange,
} from "./community-chat-events";

function change(overrides: Partial<CommunityChatChange>): CommunityChatChange {
  return {
    changeSequence: "2",
    kind: "message.created",
    roomId: "room",
    ...overrides,
  };
}

describe("community chat change classification", () => {
  test("an inline message merges without a reload", () => {
    const message = { id: "m1" };
    const actions = classifyCommunityChatChange(
      change({ message: message as never })
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "merge" });
  });
  test("a bare messageId refetches that message", () => {
    expect(classifyCommunityChatChange(change({ messageId: "m1" }))).toEqual([
      { kind: "refresh-message", messageId: "m1" },
    ]);
  });
  test("thread lifecycle refreshes threads", () => {
    expect(
      classifyCommunityChatChange(change({ kind: "thread.created" }))
    ).toEqual([{ kind: "refresh-threads" }]);
  });
  test("an unknown change shape reloads the page", () => {
    expect(
      classifyCommunityChatChange(change({ kind: "room.updated" }))
    ).toEqual([{ kind: "reload" }]);
  });
  test("stale sequences are detected", () => {
    expect(isStaleCommunityChatChange(change({}), "2")).toBe(true);
    expect(isStaleCommunityChatChange(change({}), "1")).toBe(false);
  });
});
