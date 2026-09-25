import { describe, expect, test } from "bun:test";

import type { MessageData } from "@asm/db";

import {
  isDecryptSettled,
  unsettledDecryptIds,
  waitForDecrypts,
} from "./wait-for-decrypts";

// Hoisted so the "never settles" cases share one lookup, which is also what the
// lint rule wants: a function that captures nothing belongs at module scope.
const alwaysPending = () => "pending";
const alwaysDecrypted = () => ({ content: "x", type: "text" });

function message(id: string): MessageData {
  return {
    conversationId: "c1",
    createdAt: new Date(0),
    deletedAt: null,
    id,
    senderId: "user-a",
  } as MessageData;
}

describe("isDecryptSettled", () => {
  test("a payload is settled", () => {
    expect(isDecryptSettled({ content: "hi", type: "text" })).toBe(true);
  });

  // A key that cannot be recovered is a final answer. Holding a page open for it
  // would stall the walk for a row that will never decrypt, and the index writer
  // already retries it from its pending set.
  test("a terminal failure is settled", () => {
    expect(isDecryptSettled("error")).toBe(true);
  });

  test("pending and unknown are not settled", () => {
    expect(isDecryptSettled("pending")).toBe(false);
    expect(isDecryptSettled()).toBe(false);
  });
});

describe("unsettledDecryptIds", () => {
  test("lists only the rows still waiting", () => {
    const values = new Map<string, unknown>([
      ["a", { content: "x", type: "text" }],
      ["b", "pending"],
      ["c", undefined],
    ]);
    expect(
      unsettledDecryptIds([message("a"), message("b"), message("c")], (id) =>
        values.get(id)
      )
    ).toEqual(["b", "c"]);
  });
});

describe("waitForDecrypts", () => {
  test("returns immediately when everything is already decrypted", async () => {
    const start = performance.now();
    await waitForDecrypts([message("a")], {
      lookup: alwaysDecrypted,
      timeoutMs: 5000,
    });
    // No waiting on a warm decryptor.
    expect(performance.now() - start).toBeLessThan(50);
  });

  test("returns immediately for an empty batch", async () => {
    await waitForDecrypts([], {
      lookup: () => {},
      timeoutMs: 10,
    });
  });

  test("resolves once the payloads land", async () => {
    const values = new Map<string, unknown>([["a", "pending"]]);
    setTimeout(() => {
      values.set("a", { content: "x", type: "text" });
    }, 10);
    await waitForDecrypts([message("a")], {
      lookup: (id) => values.get(id),
      timeoutMs: 1000,
    });
    expect(values.get("a")).toEqual({ content: "x", type: "text" });
  });

  test("waits for every row in the batch, not just the first", async () => {
    const values = new Map<string, unknown>([
      ["a", "pending"],
      ["b", "pending"],
    ]);
    setTimeout(() => {
      values.set("a", { content: "x", type: "text" });
    }, 5);
    setTimeout(() => {
      values.set("b", { content: "y", type: "text" });
    }, 40);
    await waitForDecrypts([message("a"), message("b")], {
      lookup: (id) => values.get(id),
      timeoutMs: 1000,
    });
    // Both are settled; resolving on the first would have indexed half a page.
    expect(values.get("b")).toEqual({ content: "y", type: "text" });
  });

  test("a row that fails terminally releases the wait", async () => {
    const values = new Map<string, unknown>([
      ["a", "pending"],
      ["b", "pending"],
    ]);
    setTimeout(() => {
      values.set("a", { content: "x", type: "text" });
      values.set("b", "error");
    }, 10);
    await waitForDecrypts([message("a"), message("b")], {
      lookup: (id) => values.get(id),
      timeoutMs: 1000,
    });
    expect(values.get("b")).toBe("error");
  });

  test("gives up on a row that never settles, leaving it to the writer", async () => {
    const start = performance.now();
    await waitForDecrypts([message("a")], {
      lookup: alwaysPending,
      timeoutMs: 30,
    });
    // Bounded: a walk must not stall on one undecryptable row.
    expect(performance.now() - start).toBeLessThan(500);
  });

  test("uses the subscription to notice a change without polling", async () => {
    const values = new Map<string, unknown>([["a", "pending"]]);
    let notify: (() => void) | undefined;
    let subscribed = false;
    let unsubscribed = false;
    const start = performance.now();
    const waiting = waitForDecrypts([message("a")], {
      lookup: (id) => values.get(id),
      subscribe: (listener) => {
        subscribed = true;
        notify = listener;
        return () => {
          unsubscribed = true;
        };
      },
      timeoutMs: 5000,
    });
    expect(subscribed).toBe(true);
    values.set("a", { content: "x", type: "text" });
    notify?.();
    await waiting;
    expect(performance.now() - start).toBeLessThan(50);
    // The subscription is released, not left dangling on a shared decryptor.
    expect(unsubscribed).toBe(true);
  });

  test("releases the subscription on a timeout too", async () => {
    let unsubscribed = false;
    await waitForDecrypts([message("a")], {
      lookup: alwaysPending,
      subscribe: () => () => {
        unsubscribed = true;
      },
      timeoutMs: 20,
    });
    expect(unsubscribed).toBe(true);
  });

  test("handles a page that settles before the wait is armed", async () => {
    // The pre-check and the timers race in real use; this covers the gap.
    const values = new Map<string, unknown>([["a", "pending"]]);
    setTimeout(() => {
      values.set("a", { content: "x", type: "text" });
    }, 0);
    await waitForDecrypts([message("a")], {
      lookup: (id) => values.get(id),
      timeoutMs: 1000,
    });
    expect(values.get("a")).toEqual({ content: "x", type: "text" });
  });
});
