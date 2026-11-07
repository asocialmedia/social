import { expect, test } from "bun:test";

import {
  canDeleteForEveryone,
  canEditMessage,
  chunkMessageIds,
  isWithinEditWindow,
  MESSAGE_EDIT_WINDOW_MS,
  messageDeleteCopy,
  pendingDeleteCount,
} from "./message-delete";

test("delete copy matches web for every scope and count", () => {
  expect(messageDeleteCopy({ count: 1, scope: "for-everyone" })).toEqual({
    confirmLabel: "Delete for everyone",
    description:
      "This message will be removed for both of you. This can't be undone.",
    title: "Delete for everyone?",
  });
  expect(messageDeleteCopy({ count: 1, scope: "for-me" }).title).toBe(
    "Delete for me?"
  );
  expect(messageDeleteCopy({ count: 3, scope: "for-me" }).title).toBe(
    "Delete 3 messages for me?"
  );
});

test("hide batches chunk in order and reject non-positive sizes", () => {
  const ids = ["a", "b", "c"];
  expect(chunkMessageIds(ids, 2)).toEqual([["a", "b"], ["c"]]);
  expect(() => chunkMessageIds(ids, 0)).toThrow();
});

test("only the sender of a live message may delete for everyone", () => {
  const live = { createdAt: new Date(), senderId: "me" };
  expect(canDeleteForEveryone(live, "me")).toBe(true);
  expect(canDeleteForEveryone(live, "peer")).toBe(false);
  expect(canDeleteForEveryone(live, null)).toBe(false);
  expect(canDeleteForEveryone({ ...live, deletedAt: new Date() }, "me")).toBe(
    false
  );
});

test("edit needs ownership, a live message and the window", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  const recent = new Date(now.getTime() - 1000).toISOString();
  const old = new Date(
    now.getTime() - MESSAGE_EDIT_WINDOW_MS - 1000
  ).toISOString();
  expect(canEditMessage({ createdAt: recent, senderId: "me" }, "me", now)).toBe(
    true
  );
  expect(
    canEditMessage({ createdAt: recent, senderId: "me" }, "peer", now)
  ).toBe(false);
  expect(canEditMessage({ createdAt: old, senderId: "me" }, "me", now)).toBe(
    false
  );
  expect(
    canEditMessage(
      { createdAt: recent, deletedAt: recent, senderId: "me" },
      "me",
      now
    )
  ).toBe(false);
  expect(isWithinEditWindow("not a date", now)).toBe(false);
});

test("pending delete count is one for everyone, ids length for me", () => {
  expect(
    pendingDeleteCount({ message: { id: "m" }, scope: "for-everyone" })
  ).toBe(1);
  expect(pendingDeleteCount({ messageIds: ["a", "b"], scope: "for-me" })).toBe(
    2
  );
});
