import { describe, expect, mock, test } from "bun:test";

const created: [string, string | undefined][] = [];
const deleted: string[] = [];

mock.module("@asm/db", () => ({
  enqueueNotificationCreated: mock((recipientId: string, id?: string) => {
    created.push([recipientId, id]);
    return Promise.resolve();
  }),
  enqueueNotificationDeleted: mock((recipientId: string) => {
    deleted.push(recipientId);
    return Promise.reject(new Error("queue down"));
  }),
}));

const {
  flushNotificationEvents,
  newNotificationEvents,
  resetNotificationEvents,
} = await import("./deferred-events");

describe("deferred notification events", () => {
  test("collects nothing until flushed, then enqueues each event once", async () => {
    const events = newNotificationEvents();
    events.created.push({ notificationId: "n1", recipientId: "u1" });
    events.deleted.push("u2");
    expect(created).toEqual([]);

    flushNotificationEvents(events, "test");
    await Promise.resolve();

    expect(created).toEqual([["u1", "n1"]]);
    expect(deleted).toEqual(["u2"]);
    // Flushed events are cleared, so a second flush sends nothing new.
    flushNotificationEvents(events, "test");
    expect(created).toHaveLength(1);
  });

  test("a retried transaction starts clean after reset", () => {
    const events = newNotificationEvents();
    events.created.push({ notificationId: "stale", recipientId: "u1" });
    resetNotificationEvents(events);
    expect(events).toEqual({ created: [], deleted: [] });
  });

  test("a failed enqueue never throws out of flush", () => {
    const events = newNotificationEvents();
    events.deleted.push("u3");
    expect(() => flushNotificationEvents(events, "test")).not.toThrow();
  });
});
