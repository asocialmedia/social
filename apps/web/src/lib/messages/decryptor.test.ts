import { describe, expect, test } from "bun:test";

import type { MessagePayload } from "./crypto";
import {
  encryptMessage,
  generateRootKey,
  importRatchetBaseKey,
} from "./crypto";
import type { DecryptItem } from "./decryptor";
import { createDecryptor } from "./decryptor";

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
    const keys = { getBaseKey: () => Promise.resolve({} as CryptoKey) };
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
    const keys = { getBaseKey: () => Promise.resolve({} as CryptoKey) };

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
    const keys = { getBaseKey: () => Promise.resolve({} as CryptoKey) };

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
      getBaseKey: () => Promise.resolve(null),
    });
    await settle();
    expect(calls).toBe(0);
    expect(decryptor.get("a")).toBe("error");
  });

  test("evicts oldest terminal entries past the cap", async () => {
    const decryptor = createDecryptor({
      cacheCap: 3,
      decrypt: () => Promise.resolve(TEXT),
    });
    const keys = { getBaseKey: () => Promise.resolve({} as CryptoKey) };
    decryptor.request([item("a"), item("b"), item("c"), item("d")], keys);
    await settle();
    expect(decryptor.get("a")).toBeUndefined();
    expect(decryptor.get("b")).toEqual(TEXT);
    expect(decryptor.get("c")).toEqual(TEXT);
    expect(decryptor.get("d")).toEqual(TEXT);
  });

  test("scope reset drops the cache and re-decrypts on demand", async () => {
    let calls = 0;
    const decryptor = createDecryptor({
      decrypt: () => {
        calls += 1;
        return Promise.resolve(TEXT);
      },
    });
    const keys = { getBaseKey: () => Promise.resolve({} as CryptoKey) };
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
      { getBaseKey: () => Promise.resolve(baseKey) }
    );
    await waitFor(
      () =>
        decryptor.get("m1") !== "pending" && decryptor.get("m2") !== "pending"
    );
    expect(decryptor.get("m1")).toEqual({ content: "one", type: "text" });
    expect(decryptor.get("m2")).toEqual({ content: "two", type: "text" });
  });
});
