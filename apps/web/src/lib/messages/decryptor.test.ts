import { describe, expect, test } from "bun:test";

import type { MessagePayload } from "./crypto";
import {
  encryptMessage,
  generateRootKey,
  importRatchetBaseKey,
} from "./crypto";
import type { DecryptItem } from "./decryptor";
import {
  createDecryptor,
  MESSAGE_DECRYPTOR_CACHE_BYTES_CAP,
  MESSAGE_DECRYPTOR_CACHE_CAP,
  MESSAGE_DECRYPTOR_QUEUE_CAP,
  MESSAGE_DECRYPTOR_URGENT_QUEUE_CAP,
} from "./decryptor";

const CONVO_ID = "convo-1";

function item(id: string, overrides?: Partial<DecryptItem>): DecryptItem {
  return {
    conversationId: CONVO_ID,
    message: {
      ciphertext: "c",
      id,
      iv: "i",
      ratchetIndex: 0,
      senderId: "alice",
      ...overrides?.message,
    },
    ...overrides,
  };
}

function deferred<T = MessagePayload>() {
  let resolveGate!: (value: T) => void;
  let rejectGate!: (error: unknown) => void;
  // oxlint-disable-next-line promise/avoid-new -- deferred test gate for ordering assertions
  const promise = new Promise<T>((resolve, reject) => {
    resolveGate = resolve;
    rejectGate = reject;
  });
  return { promise, reject: rejectGate, resolve: resolveGate };
}

const TEXT: MessagePayload = { content: "hi", type: "text" };
const EDITED: MessagePayload = { content: "hi edited", type: "text" };

// Drains pending microtasks so scheduled flushes and promise chains settle.
async function settle(rounds = 10): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- deliberate multi-tick drain
    await Bun.sleep(0);
  }
}

// Waits until `check` holds, polling across macrotasks. Used where real
// WebCrypto latency (not just microtask ordering) gates the assertion, so the
// test is not timing-flaky under parallel load.
async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out");
    }
    // oxlint-disable-next-line no-await-in-loop -- condition polling
    await Bun.sleep(5);
  }
}

describe("message decryptor", () => {
  test("decrypts queued items and notifies once for the batch", async () => {
    const started: string[] = [];
    const gate = deferred<MessagePayload>();
    const decryptor = createDecryptor({
      decrypt: (decryptItem) => {
        started.push(decryptItem.message.id);
        return gate.promise;
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    let notifies = 0;
    decryptor.subscribe(() => {
      notifies += 1;
    });

    decryptor.request([item("a"), item("b"), item("c")], keys);
    expect(decryptor.get("a")).toBe("pending");
    await settle(2);
    expect(started).toEqual(["a", "b", "c"]);
    const afterRequest = notifies;

    gate.resolve(TEXT);
    await settle();
    expect(decryptor.get("a")).toEqual(TEXT);
    expect(decryptor.get("b")).toEqual(TEXT);
    expect(decryptor.get("c")).toEqual(TEXT);
    // One flush for the whole completion batch, not one per message.
    expect(notifies).toBe(afterRequest + 1);
  });

  test("processes in caller-provided priority order with a concurrency cap", async () => {
    const started: string[] = [];
    let active = 0;
    let maxActive = 0;
    const gates = new Map<
      string,
      ReturnType<typeof deferred<MessagePayload>>
    >();
    const decryptor = createDecryptor({
      concurrency: 2,
      decrypt: (decryptItem) => {
        const { id } = decryptItem.message;
        started.push(id);
        active += 1;
        maxActive = Math.max(maxActive, active);
        const gate = deferred<MessagePayload>();
        gates.set(id, gate);
        return gate.promise.finally(() => {
          active -= 1;
        });
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };

    decryptor.request(
      [item("first"), item("second"), item("third"), item("fourth")],
      keys
    );
    await settle(2);
    expect(started).toEqual(["first", "second"]);
    gates.get("first")?.resolve(TEXT);
    await settle();
    expect(started).toEqual(["first", "second", "third"]);
    expect(maxActive).toBeLessThanOrEqual(2);
    for (const gate of gates.values()) {
      gate.resolve(TEXT);
    }
    await settle();
    // "fourth" only starts once "second" drains, so its gate postdates the
    // loop above — resolve it explicitly, then assert the cap held throughout.
    gates.get("fourth")?.resolve(TEXT);
    await settle();
    expect(decryptor.get("fourth")).toEqual(TEXT);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  test("coalesces duplicate requests and maps failures to error", async () => {
    let calls = 0;
    const decryptor = createDecryptor({
      decrypt: (decryptItem) => {
        calls += 1;
        return decryptItem.message.id === "bad"
          ? Promise.reject(new Error("nope"))
          : Promise.resolve(TEXT);
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };

    decryptor.request([item("a"), item("a"), item("bad")], keys);
    await settle();
    expect(calls).toBe(2);
    expect(decryptor.get("a")).toEqual(TEXT);
    expect(decryptor.get("bad")).toBe("error");

    // Errors stay put until explicitly cleared; successes are never redone.
    decryptor.request([item("a"), item("bad")], keys);
    await settle();
    expect(calls).toBe(2);

    decryptor.clearErrors();
    decryptor.request([item("bad")], keys);
    await settle();
    expect(calls).toBe(3);
  });

  test("null base key becomes an error without calling decrypt", async () => {
    let calls = 0;
    const decryptor = createDecryptor({
      decrypt: () => {
        calls += 1;
        return Promise.resolve(TEXT);
      },
    });
    decryptor.request([item("a")], {
      getBaseKeys: () => Promise.resolve([]),
    });
    await settle();
    expect(calls).toBe(0);
    expect(decryptor.get("a")).toBe("error");
  });

  test("scope reset drops in-flight bookkeeping so the new scope is not throttled", async () => {
    const started: string[] = [];
    const gate = deferred<MessagePayload>();
    const decryptor = createDecryptor({
      concurrency: 1,
      decrypt: (decryptItem) => {
        started.push(decryptItem.message.id);
        return decryptItem.message.id === "old"
          ? gate.promise
          : Promise.resolve(TEXT);
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };

    decryptor.configureScope("user-1");
    decryptor.request([item("old")], keys);
    await settle(2);
    expect(started).toEqual(["old"]);

    // A different identity takes over while the old decrypt is still pending.
    decryptor.configureScope("user-2");
    decryptor.request([item("fresh")], keys);
    await settle(5);
    // The stale run must not hold the single concurrency slot.
    expect(decryptor.get("fresh")).toEqual(TEXT);

    // The stale run resolving later must not corrupt the new scope's state.
    gate.resolve(TEXT);
    await settle(5);
    expect(decryptor.get("fresh")).toEqual(TEXT);
  });

  test("clearErrors returns entries to unrequested so they can be retried", async () => {
    let calls = 0;
    const decryptor = createDecryptor({
      decrypt: () => {
        calls += 1;
        return Promise.reject(new Error("nope"));
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request([item("a")], keys);
    await settle();
    expect(decryptor.get("a")).toBe("error");

    decryptor.clearErrors();
    // Dropped to undefined, which is what a mounted row self-heals on.
    expect(decryptor.get("a")).toBeUndefined();
    expect(decryptor.getErroredIds(CONVO_ID).size).toBe(0);
  });

  test("tracks errored ids per conversation", async () => {
    // A failure in one conversation must not be visible to another thread, or
    // the unrelated thread would refetch its detail for no reason.
    const decryptor = createDecryptor({
      decrypt: (decryptItem) =>
        decryptItem.message.id === "bad"
          ? Promise.reject(new Error("nope"))
          : Promise.resolve(TEXT),
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request(
      [
        item("bad"),
        item("other-convo", {
          conversationId: "convo-2",
          message: {
            ciphertext: "c",
            id: "other-convo",
            iv: "i",
            ratchetIndex: 0,
            senderId: "alice",
          },
        }),
      ],
      keys
    );
    await settle();

    expect(decryptor.get("bad")).toBe("error");
    expect(decryptor.getErroredIds(CONVO_ID)).toEqual(new Set(["bad"]));
    expect(decryptor.getErroredIds("convo-2").size).toBe(0);
  });

  test("drops an id from the error set once it decrypts", async () => {
    // A retried payload that now succeeds must not keep flagging the thread as
    // needing a heal.
    let shouldFail = true;
    const decryptor = createDecryptor({
      decrypt: () =>
        shouldFail ? Promise.reject(new Error("nope")) : Promise.resolve(TEXT),
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request([item("a")], keys);
    await settle();
    expect(decryptor.getErroredIds(CONVO_ID).has("a")).toBe(true);

    shouldFail = false;
    decryptor.retry("a");
    decryptor.request([item("a")], keys);
    await settle();
    expect(decryptor.get("a")).toEqual(TEXT);
    expect(decryptor.getErroredIds(CONVO_ID).has("a")).toBe(false);
  });

  test("clears the error set when the scope changes", async () => {
    const decryptor = createDecryptor({
      decrypt: () => Promise.reject(new Error("nope")),
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.configureScope("user-1");
    decryptor.request([item("a")], keys);
    await settle();
    expect(decryptor.getErroredIds(CONVO_ID).size).toBe(1);

    decryptor.configureScope("user-2");
    expect(decryptor.getErroredIds(CONVO_ID).size).toBe(0);
  });

  test("evicts oldest terminal entries past the cap", async () => {
    const decryptor = createDecryptor({
      cacheCap: 3,
      decrypt: () => Promise.resolve(TEXT),
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request([item("a"), item("b"), item("c"), item("d")], keys);
    await settle();
    expect(decryptor.get("a")).toBeUndefined();
    expect(decryptor.get("b")).toEqual(TEXT);
    expect(decryptor.get("c")).toEqual(TEXT);
    expect(decryptor.get("d")).toEqual(TEXT);
  });

  test("bounds payload memory by both message count and estimated bytes", async () => {
    const decryptor = createDecryptor({
      cacheBytesCap: 200,
      cacheCap: 10,
      decrypt: () => Promise.resolve({ content: "x".repeat(10), type: "text" }),
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request([item("a"), item("b")], keys);
    await settle();

    expect(decryptor.get("a")).toBeUndefined();
    expect(decryptor.get("b")).toEqual({
      content: "x".repeat(10),
      type: "text",
    });
    expect(MESSAGE_DECRYPTOR_CACHE_CAP).toBe(512);
    expect(MESSAGE_DECRYPTOR_CACHE_BYTES_CAP).toBe(8 * 1024 * 1024);
  });

  const MEDIA: MessagePayload = {
    images: [{ height: 10, url: "/api/media/x", width: 10 }],
    kind: "image",
    type: "media",
  };

  test("evicts text before media when both are over the cap", async () => {
    // Insertion order m1, t1, m2, t2. Cap 3: the least-recently-inserted entry
    // is media (m1), but the oldest TEXT (t1) must be dropped instead so media
    // survives. (A blind FIFO would evict m1 here.)
    const decryptor = createDecryptor({
      cacheCap: 3,
      decrypt: (decryptItem) =>
        Promise.resolve(decryptItem.message.id.startsWith("m") ? MEDIA : TEXT),
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request([item("m1"), item("t1"), item("m2"), item("t2")], keys);
    await settle();
    expect(decryptor.get("t1")).toBeUndefined();
    expect(decryptor.get("t2")).toEqual(TEXT);
    expect(decryptor.get("m1")).toEqual(MEDIA);
    expect(decryptor.get("m2")).toEqual(MEDIA);
  });

  test("falls back to evicting the oldest media when media alone exceeds the cap", async () => {
    const decryptor = createDecryptor({
      cacheCap: 2,
      decrypt: () => Promise.resolve(MEDIA),
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request([item("m1"), item("m2"), item("m3")], keys);
    await settle();
    expect(decryptor.get("m1")).toBeUndefined();
    expect(decryptor.get("m2")).toEqual(MEDIA);
    expect(decryptor.get("m3")).toEqual(MEDIA);
  });

  test("does not evict media that finishes before still-pending text", async () => {
    // The oldest entry is media and completes first (concurrency 1, media
    // first). A blind FIFO would evict it immediately; the deferral must hold
    // it until the text entries resolve, then drop text instead.
    const decryptor = createDecryptor({
      cacheCap: 2,
      concurrency: 1,
      decrypt: (decryptItem) =>
        Promise.resolve(decryptItem.message.id.startsWith("m") ? MEDIA : TEXT),
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request([item("m0"), item("t1"), item("t2")], keys);
    await settle();
    expect(decryptor.get("m0")).toEqual(MEDIA);
  });

  test("scope reset drops the cache and re-decrypts on demand", async () => {
    let calls = 0;
    const decryptor = createDecryptor({
      decrypt: () => {
        calls += 1;
        return Promise.resolve(TEXT);
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.configureScope("user-1");
    decryptor.request([item("a")], keys);
    await settle();
    expect(decryptor.get("a")).toEqual(TEXT);

    decryptor.configureScope("user-2");
    expect(decryptor.get("a")).toBeUndefined();
    decryptor.request([item("a")], keys);
    await settle();
    expect(calls).toBe(2);
    expect(decryptor.get("a")).toEqual(TEXT);
  });

  test("clearKeys re-resolves base keys on the next request", async () => {
    // An identity reset changes the available epochs; the cached roots from the
    // previous identity must not survive it.
    let keyCalls = 0;
    const keys = {
      getBaseKeys: () => {
        keyCalls += 1;
        return Promise.resolve([{} as CryptoKey]);
      },
    };
    const decryptor = createDecryptor({
      decrypt: () => Promise.resolve(TEXT),
    });
    decryptor.request([item("a")], keys);
    await settle();
    expect(keyCalls).toBe(1);

    // Still cached: a second request for a different message reuses the keys.
    decryptor.request([item("b")], keys);
    await settle();
    expect(keyCalls).toBe(1);

    decryptor.clearKeys();
    decryptor.request([item("c")], keys);
    await settle();
    expect(keyCalls).toBe(2);
  });

  test("invalidate drops a settled entry so the next request re-decrypts", async () => {
    // Message edits rewrite ciphertext at the same id; the cached plaintext is
    // stale until invalidated.
    let calls = 0;
    const decryptor = createDecryptor({
      decrypt: () => {
        calls += 1;
        return Promise.resolve(calls === 1 ? TEXT : EDITED);
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request([item("a")], keys);
    await settle();
    expect(decryptor.get("a")).toEqual(TEXT);

    decryptor.invalidate("a");
    expect(decryptor.get("a")).toBeUndefined();
    decryptor.request([item("a")], keys);
    await settle();
    expect(calls).toBe(2);
    expect(decryptor.get("a")).toEqual(EDITED);
  });

  test("invalidate during an in-flight run drops the stale result", async () => {
    const gates: ReturnType<typeof deferred<MessagePayload>>[] = [];
    let calls = 0;
    const decryptor = createDecryptor({
      decrypt: () => {
        calls += 1;
        const gate = deferred<MessagePayload>();
        gates.push(gate);
        return gate.promise;
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request([item("a")], keys);
    await settle(2);
    expect(calls).toBe(1);

    // The edit lands while the first decrypt is still running.
    decryptor.invalidate("a");
    // A re-request while the stale run is in flight must not start a second
    // concurrent decrypt (request() sees the entry still "pending").
    decryptor.request([item("a")], keys);
    await settle(2);
    expect(calls).toBe(1);

    // The stale run resolves; its result is dropped and the entry re-opens.
    gates[0]?.resolve(TEXT);
    await settle();
    expect(decryptor.get("a")).toBeUndefined();

    // The row's self-heal re-requests and decrypts the rewritten bytes.
    decryptor.request([item("a")], keys);
    await settle(2);
    expect(calls).toBe(2);
    gates[1]?.resolve(EDITED);
    await settle();
    expect(decryptor.get("a")).toEqual(EDITED);
  });

  test("invalidate clears a stale error so the edit can succeed", async () => {
    let fail = true;
    const decryptor = createDecryptor({
      decrypt: () =>
        fail ? Promise.reject(new Error("bad")) : Promise.resolve(TEXT),
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request([item("a")], keys);
    await settle();
    expect(decryptor.get("a")).toBe("error");
    expect(decryptor.getErroredIds(CONVO_ID).has("a")).toBe(true);

    fail = false;
    decryptor.invalidate("a");
    expect(decryptor.getErroredIds(CONVO_ID).has("a")).toBe(false);
    decryptor.request([item("a")], keys);
    await settle();
    expect(decryptor.get("a")).toEqual(TEXT);
  });

  test("end-to-end with real crypto through the default path", async () => {
    const rootKey = generateRootKey();
    const baseKey = await importRatchetBaseKey(rootKey);
    const decryptor = createDecryptor();
    const first = await encryptMessage(rootKey, "alice", 0, CONVO_ID, {
      content: "one",
      type: "text",
    });
    const second = await encryptMessage(rootKey, "alice", 1, CONVO_ID, {
      content: "two",
      type: "text",
    });
    decryptor.request(
      [
        {
          conversationId: CONVO_ID,
          message: { ...first, id: "m1", senderId: "alice" },
        },
        {
          conversationId: CONVO_ID,
          message: { ...second, id: "m2", senderId: "alice" },
        },
      ],
      { getBaseKeys: () => Promise.resolve([baseKey]) }
    );
    await waitFor(
      () =>
        decryptor.get("m1") !== "pending" && decryptor.get("m2") !== "pending"
    );
    expect(decryptor.get("m1")).toEqual({ content: "one", type: "text" });
    expect(decryptor.get("m2")).toEqual({ content: "two", type: "text" });
  });

  test("falls back to an older epoch when a message predates a key rotation", async () => {
    // After an identity reset rotates the conversation, a member holds the new
    // root plus the old one. Messages sent before the rotation must still
    // decrypt: the newest key fails its AES-GCM tag and the older one succeeds.
    const oldRoot = generateRootKey();
    const newRoot = generateRootKey();
    const [newBase, oldBase] = await Promise.all([
      importRatchetBaseKey(newRoot),
      importRatchetBaseKey(oldRoot),
    ]);
    const decryptor = createDecryptor();
    const oldMessage = await encryptMessage(oldRoot, "alice", 0, CONVO_ID, {
      content: "before reset",
      type: "text",
    });
    const newMessage = await encryptMessage(newRoot, "alice", 1, CONVO_ID, {
      content: "after reset",
      type: "text",
    });

    decryptor.request(
      [
        {
          conversationId: CONVO_ID,
          message: { ...oldMessage, id: "old", senderId: "alice" },
        },
        {
          conversationId: CONVO_ID,
          message: { ...newMessage, id: "new", senderId: "alice" },
        },
      ],
      // Newest epoch first, exactly what the root-key store returns.
      { getBaseKeys: () => Promise.resolve([newBase, oldBase]) }
    );
    await waitFor(
      () =>
        decryptor.get("old") !== "pending" && decryptor.get("new") !== "pending"
    );

    expect(decryptor.get("old")).toEqual({
      content: "before reset",
      type: "text",
    });
    expect(decryptor.get("new")).toEqual({
      content: "after reset",
      type: "text",
    });
  });
});

// The urgent lane. On a fresh device the search backfill queues 500 rows every
// 250ms and a search jump then asks for exactly one row -- the one the user is
// looking at. Under a single FIFO queue that row waits behind hundreds of rows
// nobody is waiting on, and the jump's own text budget expires while it sits
// there. These pin the promotion.
describe("decryptor urgent lane", () => {
  test("an urgent request is served before everything already queued", async () => {
    const started: string[] = [];
    const gate = deferred<MessagePayload>();
    const decryptor = createDecryptor({
      concurrency: 1,
      decrypt: (decryptItem) => {
        started.push(decryptItem.message.id);
        // The first item holds the single slot so the queue behind it is real.
        return started.length === 1 ? gate.promise : Promise.resolve(TEXT);
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };

    decryptor.request([item("bg-1"), item("bg-2")], keys);
    await settle(2);
    expect(started).toEqual(["bg-1"]);

    decryptor.requestUrgent([item("wanted")], keys);
    gate.resolve(TEXT);
    await settle();
    // Straight past both queued rows.
    expect(started).toEqual(["bg-1", "wanted", "bg-2"]);
  });

  // The row is already in the queue, so "requesting it again" must MOVE it rather
  // than skip it as a duplicate or decrypt it twice.
  test("an urgent request promotes a row that is already queued", async () => {
    const started: string[] = [];
    const gate = deferred<MessagePayload>();
    const decryptor = createDecryptor({
      concurrency: 1,
      decrypt: (decryptItem) => {
        started.push(decryptItem.message.id);
        return started.length === 1 ? gate.promise : Promise.resolve(TEXT);
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };

    decryptor.request([item("bg-1"), item("bg-2"), item("target")], keys);
    await settle(2);
    expect(decryptor.get("target")).toBe("pending");
    expect(started).toEqual(["bg-1"]);

    decryptor.requestUrgent([item("target")], keys);
    gate.resolve(TEXT);
    await settle();
    // Decrypted exactly once, and served before the two rows ahead of it.
    expect(started).toEqual(["bg-1", "target", "bg-2"]);
  });

  test("a multi-row urgent request keeps the order it was asked in", async () => {
    const started: string[] = [];
    const gate = deferred<MessagePayload>();
    const decryptor = createDecryptor({
      concurrency: 1,
      decrypt: (decryptItem) => {
        started.push(decryptItem.message.id);
        return started.length === 1 ? gate.promise : Promise.resolve(TEXT);
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };

    decryptor.request([item("bg")], keys);
    await settle(2);
    decryptor.requestUrgent([item("u1"), item("u2"), item("u3")], keys);
    gate.resolve(TEXT);
    await settle();
    expect(started).toEqual(["bg", "u1", "u2", "u3"]);
  });

  test("an urgent request for a row already decrypting changes nothing", async () => {
    const started: string[] = [];
    const gate = deferred<MessagePayload>();
    const decryptor = createDecryptor({
      concurrency: 1,
      decrypt: (decryptItem) => {
        started.push(decryptItem.message.id);
        return gate.promise;
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };

    decryptor.request([item("a")], keys);
    await settle(2);
    let notified = 0;
    decryptor.subscribe(() => {
      notified += 1;
    });
    decryptor.requestUrgent([item("a")], keys);
    gate.resolve(TEXT);
    await settle();
    // Not re-queued, and no spurious notification for work that did not change.
    expect(started).toEqual(["a"]);
    expect(notified).toBe(1);
  });

  test("an urgent request for an already-decrypted row is a no-op", async () => {
    const decryptor = createDecryptor({ decrypt: () => Promise.resolve(TEXT) });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request([item("a")], keys);
    await settle();
    expect(decryptor.get("a")).toEqual(TEXT);
    decryptor.requestUrgent([item("a")], keys);
    await settle();
    expect(decryptor.get("a")).toEqual(TEXT);
  });

  test("a re-queued background row does not jump the urgent lane", async () => {
    const started: string[] = [];
    const gate = deferred<MessagePayload>();
    const decryptor = createDecryptor({
      concurrency: 1,
      decrypt: (decryptItem) => {
        started.push(decryptItem.message.id);
        return started.length === 1 ? gate.promise : Promise.resolve(TEXT);
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };

    decryptor.request([item("bg-1")], keys);
    await settle(2);
    decryptor.requestUrgent([item("wanted")], keys);
    gate.resolve(TEXT);
    await settle();
    // An edit to a row that already decrypted: it is re-queued, and the urgent
    // row still outranks it rather than being pushed back behind it.
    decryptor.retry("bg-1");
    decryptor.request([item("bg-1")], keys);
    await settle();
    expect(started).toEqual(["bg-1", "wanted", "bg-1"]);
  });

  test("a scope change drops urgent work with the rest of the queue", async () => {
    const gate = deferred<MessagePayload>();
    const decryptor = createDecryptor({
      concurrency: 1,
      decrypt: () => gate.promise,
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request([item("bg")], keys);
    await settle(2);
    decryptor.requestUrgent([item("wanted")], keys);
    decryptor.configureScope("other-user");
    expect(decryptor.get("bg")).toBeUndefined();
    expect(decryptor.get("wanted")).toBeUndefined();
  });
});

describe("bounded decrypt queues", () => {
  test("caps background work and leaves overflow retryable", async () => {
    const started: string[] = [];
    const gates = new Map<
      string,
      ReturnType<typeof deferred<MessagePayload>>
    >();
    const decryptor = createDecryptor({
      concurrency: 1,
      decrypt: (decryptItem) => {
        const { id } = decryptItem.message;
        started.push(id);
        const gate = deferred<MessagePayload>();
        gates.set(id, gate);
        return gate.promise;
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    const background = Array.from(
      { length: MESSAGE_DECRYPTOR_QUEUE_CAP + 2 },
      (_, index) => item(`background-${index}`)
    );

    const rejected = decryptor.request(background, keys);
    expect(rejected.map((row) => row.message.id)).toEqual([
      `background-${MESSAGE_DECRYPTOR_QUEUE_CAP}`,
      `background-${MESSAGE_DECRYPTOR_QUEUE_CAP + 1}`,
    ]);
    await waitFor(() => started.length === 1);
    expect(decryptor.get("background-0")).toBe("pending");
    expect(decryptor.get(`background-${MESSAGE_DECRYPTOR_QUEUE_CAP - 1}`)).toBe(
      "pending"
    );
    expect(decryptor.get(`background-${MESSAGE_DECRYPTOR_QUEUE_CAP}`)).toBe(
      undefined
    );
    expect(
      decryptor.get(`background-${MESSAGE_DECRYPTOR_QUEUE_CAP + 1}`)
    ).toBeUndefined();

    decryptor.requestUrgent([item("jump")], keys);
    gates.get("background-0")?.resolve(TEXT);
    await waitFor(() => started.includes("jump"));
    gates.get("jump")?.resolve(TEXT);
    await waitFor(() => started.includes("background-1"));

    const overflow = `background-${MESSAGE_DECRYPTOR_QUEUE_CAP}`;
    decryptor.request([item(overflow)], keys);
    expect(decryptor.get(overflow)).toBe("pending");
    expect(started).toEqual(["background-0", "jump", "background-1"]);
  });

  test("bounds urgent work and lets a new visible target evict stale prefetch", async () => {
    const started: string[] = [];
    const gates = new Map<
      string,
      ReturnType<typeof deferred<MessagePayload>>
    >();
    const decryptor = createDecryptor({
      concurrency: 1,
      decrypt: (decryptItem) => {
        const { id } = decryptItem.message;
        started.push(id);
        const gate = deferred<MessagePayload>();
        gates.set(id, gate);
        return gate.promise;
      },
    });
    const keys = { getBaseKeys: () => Promise.resolve([{} as CryptoKey]) };
    decryptor.request([item("blocker")], keys);
    await waitFor(() => started.includes("blocker"));
    decryptor.requestUrgent(
      Array.from({ length: MESSAGE_DECRYPTOR_URGENT_QUEUE_CAP }, (_, index) =>
        item(`prefetch-${index}`)
      ),
      keys
    );
    expect(
      decryptor.get(`prefetch-${MESSAGE_DECRYPTOR_URGENT_QUEUE_CAP - 1}`)
    ).toBe("pending");

    decryptor.requestUrgent([item("visible-target")], keys);
    expect(decryptor.get("visible-target")).toBe("pending");
    expect(
      decryptor.get(`prefetch-${MESSAGE_DECRYPTOR_URGENT_QUEUE_CAP - 1}`)
    ).toBeUndefined();
    gates.get("blocker")?.resolve(TEXT);
    await waitFor(() => started.includes("visible-target"));
    expect(started).toEqual(["blocker", "visible-target"]);
  });
});
