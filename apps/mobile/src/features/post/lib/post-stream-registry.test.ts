import { describe, expect, test } from "bun:test";

import { StreamRegistry } from "./post-stream-registry";

describe("shared stream registry", () => {
  test("first acquire creates, second reuses the same entry", () => {
    const registry = new StreamRegistry<object>();
    const first = registry.acquire("comments:p1");
    const second = registry.acquire("comments:p1");
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.controller).toBe(first.controller);
    expect(second.subscribers).toBe(first.subscribers);
    expect(registry.size()).toBe(1);
  });

  test("different keys open independent entries", () => {
    const registry = new StreamRegistry<object>();
    const comments = registry.acquire("comments:p1");
    const responses = registry.acquire("responses:p1");
    expect(responses.controller).not.toBe(comments.controller);
    expect(registry.size()).toBe(2);
  });

  test("release drops the entry and aborts only the last subscriber out", () => {
    const registry = new StreamRegistry<object>();
    const shared = registry.acquire("comments:p1");
    const card = {};
    const detail = {};
    shared.subscribers.add(card);
    shared.subscribers.add(detail);
    let aborted = false;
    shared.controller.signal.addEventListener("abort", () => {
      aborted = true;
    });
    registry.release("comments:p1", card);
    expect(aborted).toBe(false);
    expect(registry.size()).toBe(1);
    registry.release("comments:p1", detail);
    expect(aborted).toBe(true);
    expect(registry.size()).toBe(0);
  });

  test("releasing an unknown key or subscriber is a no-op", () => {
    const registry = new StreamRegistry<object>();
    registry.release("comments:missing", {});
    const shared = registry.acquire("comments:p1");
    shared.subscribers.add({});
    registry.release("comments:p1", {});
    expect(registry.size()).toBe(1);
  });

  test("a released key reopens fresh on the next acquire", () => {
    const registry = new StreamRegistry<object>();
    const first = registry.acquire("comments:p1");
    const subscriber = {};
    first.subscribers.add(subscriber);
    registry.release("comments:p1", subscriber);
    const second = registry.acquire("comments:p1");
    expect(second.created).toBe(true);
    expect(second.controller).not.toBe(first.controller);
  });
});
