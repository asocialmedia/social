// The decrypt scheduler and the realtime frame parser. Both are pure enough to
// drive with a stub decrypt fn, a stub clock and no device.
import { describe, expect, test } from "bun:test";

import type { MessagePayload } from "./crypto";
import { createDecryptor, MESSAGE_DECRYPTOR_CACHE_CAP } from "./decryptor";
import type { DecryptItem } from "./decryptor";
import {
  parseMessageActivity,
  parseMessageEvent,
  shouldCatchUp,
} from "./realtime";

// A stub decrypt that resolves on a microtask, plus a way to hold it open so a
// test can observe the in-flight state.
function item(id: string, senderId = "peer"): DecryptItem {
  return {
    conversationId: "conv-1",
    message: {
      ciphertext: "ct",
      id,
      iv: "iv",
      ratchetIndex: 0,
      senderId,
    },
  };
}

function payload(content: string): MessagePayload {
  return { content, type: "text" };
}

// Runs the microtask queue until the scheduler has drained, then resolves.
async function settle(times = 12): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- draining the microtask queue IS the loop; each pass has to await the previous one or nothing ever runs
    await Promise.resolve();
  }
}

/**
 * A gate the test opens by hand, used to hold one decrypt in flight while others
 * queue behind it. `wait()` blocks until `open()` is called, which is what makes
 * the queue ordering observable.
 */
function createGate(): { open: () => void; wait: () => Promise<unknown> } {
  const latch = Promise.withResolvers<unknown>();
  return {
    open: latch.resolve,
    wait: () => latch.promise,
  };
}

const keys = {
  getBaseKeys: () => Promise.resolve([new Uint8Array([1])]),
};

describe("decryptor", () => {
  test("queued conversations retain their own key source", async () => {
    const gate = createGate();
    const decryptor = createDecryptor({
      concurrency: 1,
      decrypt: async (entry, key) => {
        if (entry.message.id === "held") {
          await gate.wait();
        }
        return payload(String(key[0]));
      },
    });
    const first = { getBaseKeys: () => Promise.resolve([new Uint8Array([1])]) };
    const second = {
      getBaseKeys: () => Promise.resolve([new Uint8Array([2])]),
    };
    const held = { ...item("held"), conversationId: "first" };
    const queued = { ...item("queued"), conversationId: "queued-conversation" };
    decryptor.request([held, queued], first);
    decryptor.request([{ ...item("other"), conversationId: "other" }], second);
    gate.open();
    await settle(60);
    expect(decryptor.get("queued")).toEqual(payload("1"));
    expect(decryptor.get("other")).toEqual(payload("2"));
  });

  test("key readiness clears only this conversation's errors and retains plaintext", async () => {
    const decryptor = createDecryptor({
      decrypt: (entry) => payload(entry.message.id),
    });
    decryptor.request([item("early")], {
      getBaseKeys: () => Promise.resolve([]),
    });
    decryptor.request([{ ...item("other-error"), conversationId: "other" }], {
      getBaseKeys: () => Promise.resolve([]),
    });
    await settle(30);
    decryptor.request([item("cached")], keys);
    await settle(30);
    const cached = decryptor.get("cached");
    decryptor.clearKeys("conv-1");
    decryptor.clearErrors("conv-1");
    decryptor.request([item("early")], keys);
    await settle(30);
    expect(decryptor.get("early")).toEqual(payload("early"));
    expect(decryptor.get("other-error")).toBe("error");
    expect(decryptor.get("cached")).toBe(cached);
  });

  test("a key refresh discards an in-flight stale failure and permits retry", async () => {
    const gate = createGate();
    const decryptor = createDecryptor({
      decrypt: (entry) => payload(entry.message.id),
    });
    decryptor.request([item("waiting")], {
      getBaseKeys: async () => {
        await gate.wait();
        return [];
      },
    });
    decryptor.clearKeys("conv-1");
    gate.open();
    await settle(30);
    expect(decryptor.get("waiting")).toBeUndefined();
    decryptor.request([item("waiting")], keys);
    await settle(30);
    expect(decryptor.get("waiting")).toEqual(payload("waiting"));
  });

  test("decrypts a batch and coalesces the notification", async () => {
    // The default scheduleFlush (queueMicrotask) is what coalesces, so the test
    // must use it: a stub that flushes synchronously would defeat the property.
    const decryptor = createDecryptor({
      decrypt: (entry) => payload(entry.message.id),
    });
    let notifications = 0;
    decryptor.subscribe(() => {
      notifications += 1;
    });

    decryptor.request([item("a"), item("b"), item("c")], keys);
    expect(decryptor.get("a")).toBe("pending");

    await settle(40);
    expect(decryptor.get("a")).toEqual(payload("a"));
    expect(decryptor.get("b")).toEqual(payload("b"));
    expect(decryptor.get("c")).toEqual(payload("c"));
    // One notify for the enqueue plus ONE for the whole batch of completions. Not
    // one per message: this is the whole reason the scheduler exists.
    expect(notifications).toBe(2);
  });

  test("a failure is terminal and never strands pending", async () => {
    const decryptor = createDecryptor({
      decrypt: (entry) => {
        if (entry.message.id === "bad") {
          throw new Error("no key");
        }
        return payload(entry.message.id);
      },
    });
    decryptor.request([item("bad"), item("good")], keys);
    await settle(20);
    expect(decryptor.get("bad")).toBe("error");
    expect(decryptor.get("good")).toEqual(payload("good"));
    expect(decryptor.getErroredIds("conv-1").has("bad")).toBe(true);
    expect(decryptor.getErroredIds("conv-2").size).toBe(0);
  });

  test("an error does not auto-retry", async () => {
    let calls = 0;
    const decryptor = createDecryptor({
      decrypt: () => {
        calls += 1;
        throw new Error("nope");
      },
    });
    decryptor.request([item("bad")], keys);
    await settle(20);
    expect(calls).toBe(1);
    await settle(20);
    expect(calls).toBe(1);
  });

  test("retry re-opens an errored id and clearErrors drops them all", async () => {
    let shouldFail = true;
    const decryptor = createDecryptor({
      decrypt: (entry) => {
        if (shouldFail) {
          throw new Error("nope");
        }
        return payload(entry.message.id);
      },
    });
    decryptor.request([item("bad")], keys);
    await settle(20);
    expect(decryptor.get("bad")).toBe("error");

    shouldFail = false;
    decryptor.retry("bad");
    expect(decryptor.get("bad")).toBeUndefined();
    decryptor.request([item("bad")], keys);
    await settle(20);
    expect(decryptor.get("bad")).toEqual(payload("bad"));

    // clearErrors only touches errors, never a live payload.
    decryptor.clearErrors();
    expect(decryptor.get("bad")).toEqual(payload("bad"));
  });

  test("a second request for the same id does not decrypt twice", async () => {
    let calls = 0;
    const decryptor = createDecryptor({
      decrypt: (entry) => {
        calls += 1;
        return payload(entry.message.id);
      },
    });
    decryptor.request([item("a")], keys);
    decryptor.request([item("a")], keys);
    await settle(20);
    expect(calls).toBe(1);
  });

  test("a terminal id is not resurrected as pending by a re-request", async () => {
    const decryptor = createDecryptor({
      decrypt: () => {
        throw new Error("nope");
      },
    });
    decryptor.request([item("bad")], keys);
    await settle(20);
    decryptor.request([item("bad")], keys);
    expect(decryptor.get("bad")).toBe("error");
  });

  test("an urgent request is served before the background lane", async () => {
    const order: string[] = [];
    const gate = createGate();
    const decryptor = createDecryptor({
      concurrency: 1,
      decrypt: async (entry) => {
        order.push(`start:${entry.message.id}`);
        // Every run waits on the same gate, so the slot stays occupied until the
        // test opens it and the rest stay queued behind it.
        await gate.wait();
        order.push(`done:${entry.message.id}`);
        return payload(entry.message.id);
      },
    });

    // Occupy the only slot, then queue a background batch behind it.
    decryptor.request([item("blocker")], keys);
    decryptor.request([item("bg1"), item("bg2")], keys);
    decryptor.requestUrgent([item("urgent")], keys);

    // Let the blocker claim the slot and reach its await.
    await settle(10);
    expect(order).toEqual(["start:blocker"]);
    gate.open();
    await settle(40);

    expect(order).toContain("done:blocker");
    // The urgent row runs before the queued background rows. The blocker
    // finishing is logged first, so the meaningful assertion is the ordering,
    // not an absolute index.
    expect(order.indexOf("start:urgent")).toBeLessThan(
      order.indexOf("start:bg1")
    );
    expect(order.indexOf("start:urgent")).toBeLessThan(
      order.indexOf("start:bg2")
    );
    expect(order.indexOf("done:blocker")).toBeLessThan(
      order.indexOf("start:urgent")
    );
  });

  test("promotion moves a queued id rather than decrypting it twice", async () => {
    let calls = 0;
    const gate = createGate();
    const decryptor = createDecryptor({
      concurrency: 1,
      decrypt: async (entry) => {
        calls += 1;
        await gate.wait();
        return payload(entry.message.id);
      },
    });

    decryptor.request([item("blocker")], keys);
    decryptor.request([item("bg")], keys);
    // Promote bg out of the background lane into the urgent lane.
    decryptor.requestUrgent([item("bg")], keys);
    await settle(10);
    gate.open();
    await settle(40);
    expect(calls).toBe(2); // blocker + bg, not bg twice
  });

  test("an invalidate during a run drops the stale result", async () => {
    const decryptor = createDecryptor({
      decrypt: async (entry) => {
        await settle(6);
        return payload(`stale:${entry.message.id}`);
      },
    });
    decryptor.request([item("a")], keys);
    decryptor.invalidate("a");
    await settle(30);
    // The run landed after the invalidate, so the entry went back to unrequested
    // rather than holding plaintext that predates the edit.
    expect(decryptor.get("a")).toBeUndefined();
  });

  test("an invalidate of a settled id clears it for re-decryption", async () => {
    const decryptor = createDecryptor({
      decrypt: (entry) => payload(`v:${entry.message.id}`),
    });
    decryptor.request([item("a")], keys);
    await settle(20);
    expect(decryptor.get("a")).toEqual(payload("v:a"));
    decryptor.invalidate("a");
    expect(decryptor.get("a")).toBeUndefined();
    decryptor.request([item("a")], keys);
    await settle(20);
    expect(decryptor.get("a")).toEqual(payload("v:a"));
  });

  test("an epoch list is tried newest-first and the wrong root falls through", async () => {
    const good = new Uint8Array([9]);
    const bad = new Uint8Array([1]);
    const decryptor = createDecryptor({
      decrypt: (_entry, baseKey) => {
        if (baseKey[0] !== 9) {
          throw new Error("wrong epoch");
        }
        return payload("right epoch");
      },
    });
    decryptor.request([item("a")], {
      // Deliberately wrong-first: the scheduler must walk past it.
      getBaseKeys: () => Promise.resolve([bad, good]),
    });
    await settle(20);
    expect(decryptor.get("a")).toEqual(payload("right epoch"));
  });

  test("empty or rejected keys are a terminal error, not a hang", async () => {
    const decryptor = createDecryptor({
      decrypt: () => payload("never"),
    });
    decryptor.request([item("a")], {
      getBaseKeys: () => {
        throw new Error("no unwrappable key");
      },
    });
    await settle(20);
    expect(decryptor.get("a")).toBe("error");

    // And an empty list is cached only transiently: keys arriving later must
    // still decrypt, which is the identity-still-provisioning case.
    const late = createDecryptor({
      decrypt: () => payload("late"),
    });
    let ready = false;
    late.request([item("b")], {
      getBaseKeys: () => Promise.resolve(ready ? [new Uint8Array([1])] : []),
    });
    await settle(20);
    expect(late.get("b")).toBe("error");
    ready = true;
    late.retry("b");
    late.request([item("b")], {
      getBaseKeys: () => Promise.resolve([new Uint8Array([1])]),
    });
    await settle(20);
    expect(late.get("b")).toEqual(payload("late"));
  });

  test("changing scope drops every entry so accounts cannot share plaintext", async () => {
    const decryptor = createDecryptor({
      decrypt: (entry) => payload(entry.message.id),
    });
    decryptor.request([item("a")], keys);
    await settle(20);
    expect(decryptor.get("a")).toEqual(payload("a"));
    decryptor.configureScope("user-2");
    expect(decryptor.get("a")).toBeUndefined();
    expect(decryptor.getErroredIds("conv-1").size).toBe(0);
  });

  test("setting the same scope twice is a no-op", async () => {
    const decryptor = createDecryptor({
      decrypt: (entry) => payload(entry.message.id),
    });
    // The first scope change is what adopts the scope; only a repeat is free.
    decryptor.configureScope("user-1");
    decryptor.request([item("a")], keys);
    await settle(20);
    decryptor.configureScope("user-1");
    expect(decryptor.get("a")).toEqual(payload("a"));
  });

  test("the cache respects its cap, keeping text over media", async () => {
    const decryptor = createDecryptor({
      cacheCap: 4,
      decrypt: (entry) =>
        entry.message.id.startsWith("media")
          ? {
              images: [{ url: "/api/media/a" }],
              kind: "image",
              type: "media",
            }
          : payload(entry.message.id),
    });
    const ids = [
      "media1",
      "media2",
      "text1",
      "text2",
      "text3",
      "text4",
      "text5",
      "text6",
    ];
    decryptor.request(
      ids.map((id) => item(id)),
      keys
    );
    await settle(60);
    // Older text rows were evicted before the media ones.
    expect(decryptor.get("text1")).toBeUndefined();
    expect(decryptor.get("text6")).toEqual(payload("text6"));
    expect(decryptor.get("media1")).toEqual({
      images: [{ url: "/api/media/a" }],
      kind: "image",
      type: "media",
    });
  });

  test("the exported cap is the phone-sized one, not web's", () => {
    expect(MESSAGE_DECRYPTOR_CACHE_CAP).toBe(600);
  });

  test("unsubscribing stops the broadcast", async () => {
    const decryptor = createDecryptor({
      decrypt: (entry) => payload(entry.message.id),
    });
    let notified = 0;
    const unsubscribe = decryptor.subscribe(() => {
      notified += 1;
    });
    decryptor.request([item("a")], keys);
    await settle(20);
    const seen = notified;
    expect(seen).toBeGreaterThan(0);
    unsubscribe();
    decryptor.invalidate("a");
    decryptor.request([item("a")], keys);
    await settle(20);
    expect(notified).toBe(seen);
  });
});

describe("realtime frame parsing", () => {
  test("accepts every event kind the server publishes", () => {
    const kinds = [
      "message.created",
      "message.deleted",
      "message.edited",
      "conversation.read",
      "conversation.delivered",
      "typing.started",
      "keys.rotated",
    ] as const;
    for (const kind of kinds) {
      const body: Record<string, unknown> = {
        conversationId: "conv-1",
        deliveredAt: "2026-01-01T00:00:00Z",
        kind,
        message: { id: "m1" },
        readAt: "2026-01-01T00:00:00Z",
        userId: "peer",
      };
      expect(parseMessageEvent(JSON.stringify(body))?.kind).toBe(kind);
    }
  });

  test("rejects an unknown kind", () => {
    expect(
      parseMessageEvent(JSON.stringify({ conversationId: "c", kind: "nope" }))
    ).toBeNull();
  });

  test("rejects a message event with no message", () => {
    expect(
      parseMessageEvent(
        JSON.stringify({ conversationId: "c", kind: "message.created" })
      )
    ).toBeNull();
  });

  test("rejects a watermark event with no watermark", () => {
    expect(
      parseMessageEvent(
        JSON.stringify({ conversationId: "c", kind: "conversation.read" })
      )
    ).toBeNull();
    expect(
      parseMessageEvent(
        JSON.stringify({
          conversationId: "c",
          kind: "conversation.delivered",
          userId: "peer",
        })
      )
    ).toBeNull();
  });

  test("rejects a frame with no conversation", () => {
    expect(
      parseMessageEvent(JSON.stringify({ kind: "typing.started" }))
    ).toBeNull();
  });

  test("survives malformed json", () => {
    expect(parseMessageEvent("{not json")).toBeNull();
    expect(parseMessageEvent("")).toBeNull();
  });

  test("parses an activity frame", () => {
    expect(
      parseMessageActivity(
        JSON.stringify({ conversationId: "c", kind: "message.created" })
      )
    ).toEqual({ conversationId: "c", kind: "message.created" });
    expect(parseMessageActivity(JSON.stringify({ kind: "x" }))).toBeNull();
    expect(parseMessageActivity("nope")).toBeNull();
  });
});

describe("reconnect catch-up policy", () => {
  const now = 1_000_000;

  test("an in-flight fetch is never duplicated", () => {
    expect(shouldCatchUp({ dataUpdatedAt: 0, isFetching: true, now })).toBe(
      false
    );
    expect(
      shouldCatchUp({
        dataUpdatedAt: 0,
        isFetching: true,
        isReconnect: true,
        now,
      })
    ).toBe(false);
  });

  test("a reconnect always reconciles, however fresh the cache", () => {
    // No replay cursor exists, so a reconnect may have missed anything. This is
    // the mobile case: the gap is a tunnel, not a race between two tabs.
    expect(
      shouldCatchUp({
        dataUpdatedAt: now - 1,
        isFetching: false,
        isReconnect: true,
        now,
      })
    ).toBe(true);
  });

  test("the first connection only reconciles a cold or stale cache", () => {
    expect(shouldCatchUp({ dataUpdatedAt: 0, isFetching: false, now })).toBe(
      true
    );
    expect(
      shouldCatchUp({ dataUpdatedAt: now - 20_000, isFetching: false, now })
    ).toBe(true);
    expect(
      shouldCatchUp({ dataUpdatedAt: now - 1000, isFetching: false, now })
    ).toBe(false);
  });
});
