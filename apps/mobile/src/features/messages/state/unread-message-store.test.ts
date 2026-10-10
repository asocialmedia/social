import { describe, expect, test } from "bun:test";

import { UnreadMessageStore } from "./unread-message-store";

describe("shared message badges", () => {
  test("every subscriber sees arrivals and successful reads", async () => {
    const store = new UnreadMessageStore();
    const first: number[] = [];
    const second: number[] = [];
    store.subscribe(() => first.push(store.getSnapshot()));
    store.subscribe(() => second.push(store.getSnapshot()));
    let unread = 7;
    store.configure("alice", () => Promise.resolve(unread));
    await store.refresh();
    unread = 0;
    store.notifyActivity();
    await store.refresh();
    expect(first).toEqual([7, 0]);
    expect(second).toEqual(first);
  });

  test("account changes ignore a previous account's late response", async () => {
    const store = new UnreadMessageStore();
    const old = Promise.withResolvers<number>();
    store.configure("alice", () => old.promise);
    const pending = store.refresh();
    store.configure("bob", () => Promise.resolve(3));
    await store.refresh();
    old.resolve(99);
    await pending;
    expect(store.getSnapshot()).toBe(3);
    store.configure(null);
    expect(store.getSnapshot()).toBe(0);
  });

  test("an arrival during an in-flight count forces one follow-up read", async () => {
    const store = new UnreadMessageStore();
    const first = Promise.withResolvers<number>();
    let calls = 0;
    store.configure("alice", () => {
      calls += 1;
      return calls === 1 ? first.promise : Promise.resolve(5);
    });
    const pending = store.refresh();
    await Promise.resolve();
    store.notifyActivity();
    store.notifyActivity();
    expect(calls).toBe(1);
    first.resolve(2);
    await pending;
    expect(calls).toBe(2);
    expect(store.getSnapshot()).toBe(5);
  });

  test("network failures retain badges and the next read can recover", async () => {
    const store = new UnreadMessageStore();
    let fail = false;
    store.configure("alice", () => {
      if (fail) {
        throw new Error("offline");
      }
      return Promise.resolve(4);
    });
    await store.refresh();
    fail = true;
    await store.refresh();
    expect(store.getSnapshot()).toBe(4);
    fail = false;
    await store.refresh();
    expect(store.getSnapshot()).toBe(4);
  });
});
