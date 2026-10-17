import { expect, test } from "bun:test";

import { ChatDraftStore, messageIsRetained } from "./lifecycle";

test("deadlines fail closed and permanent messages survive", () => {
  expect(
    messageIsRetained(
      { expiresAt: "2026-10-16T00:00:00Z" },
      Date.parse("2026-10-16T00:00:00Z")
    )
  ).toBe(false);
  expect(messageIsRetained({ expiresAt: "invalid" })).toBe(false);
  expect(messageIsRetained({ expiresAt: null })).toBe(true);
});

test("normal drafts are isolated by account and bounded in memory", () => {
  const drafts = new ChatDraftStore();
  drafts.set("alice", "dm", "hello");
  expect(drafts.get("bob", "dm")).toBe("");
  expect(drafts.get("alice", "dm")).toBe("hello");
  for (let index = 0; index < 60; index += 1) {
    drafts.set("alice", String(index), "a".repeat(9000));
  }
  expect(drafts.drafts.size).toBe(50);
  expect(drafts.get("alice", "59")).toHaveLength(8000);
  drafts.set("alice", "59", "");
  expect(drafts.get("alice", "59")).toBe("");
});
