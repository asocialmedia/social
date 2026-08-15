import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import {
  appendMessageToLastPage,
  createRootKeyStore,
  ensureConversationKeys,
} from "./client";
import {
  exportPublicKeyJwk,
  generateIdentityKeyPair,
  generateRootKey,
  publicKeyBase64ToJwk,
  publicKeyJwkToBase64,
  wrapRootKey,
} from "./crypto";

async function makeIdentity() {
  const pair = await generateIdentityKeyPair();
  return {
    id: `id-${Math.random().toString(36).slice(2)}`,
    pair,
    publicKeyBase64: publicKeyJwkToBase64(
      await exportPublicKeyJwk(pair.publicKey)
    ),
  };
}

function makeConversation(
  id: string,
  me: { id: string; publicKeyBase64: string },
  them: { id: string; publicKeyBase64: string }
) {
  return {
    id,
    keys: [] as { encryptedKey: string; iv: string; ownerUserId: string }[],
    members: [
      {
        user: { id: me.id, messageIdentity: { publicKey: me.publicKeyBase64 } },
        userId: me.id,
      },
      {
        user: {
          id: them.id,
          messageIdentity: { publicKey: them.publicKeyBase64 },
        },
        userId: them.id,
      },
    ],
  };
}

const postedKeys: { ownerUserId: string }[] = [];

describe("createRootKeyStore", () => {
  test("unwraps and memoizes the root key per conversation", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const rootKey = generateRootKey();

    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const bobKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      bobPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const wrappedForAlice = await wrapRootKey(
      alice.pair.privateKey,
      bobKey,
      "convo-1",
      rootKey
    );

    const store = createRootKeyStore(alice.pair.privateKey);
    const unwrapped1 = await store.getRootKey(
      "convo-1",
      wrappedForAlice,
      bob.publicKeyBase64
    );
    const unwrapped2 = await store.getRootKey(
      "convo-1",
      wrappedForAlice,
      bob.publicKeyBase64
    );
    expect(Buffer.from(unwrapped1).equals(Buffer.from(rootKey))).toBe(true);
    // Memoized: the second call returns the exact same Uint8Array reference
    // as the first (the cached promise resolves to one instance).
    expect(unwrapped2).toBe(unwrapped1);
    expect(Buffer.from(unwrapped2).equals(Buffer.from(rootKey))).toBe(true);
  });
});

describe("ensureConversationKeys", () => {
  // Stub the network: the real postConversationKeys runs, but fetch is
  // redirected to a fake that captures the posted wrapped keys.
  const originalFetch = globalThis.fetch;
  const fetchMock = mock((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/keys")) {
      const body = JSON.parse(String(init?.body)) as {
        keys: { ownerUserId: string }[];
      };
      postedKeys.push(...body.keys);
      return Response.json({ ok: true }, { status: 200 });
    }
    return Response.json({}, { status: 404 });
  });

  beforeEach(() => {
    postedKeys.length = 0;
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("generates keys for both members when none exist", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const convo = makeConversation("convo-new", alice, bob);

    const rootKey = await ensureConversationKeys(
      convo as never,
      alice.pair.privateKey,
      alice.id
    );

    expect(rootKey).not.toBeNull();
    expect(rootKey?.byteLength).toBe(32);
    expect(postedKeys).toHaveLength(2);
    const owners = postedKeys.map((key) => key.ownerUserId).toSorted();
    expect(owners).toEqual([alice.id, bob.id].toSorted());
  });

  test("returns the unwrapped root without posting when keys exist", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const convo = makeConversation("convo-existing", alice, bob);
    const rootKey = generateRootKey();

    const alicePub = await publicKeyBase64ToJwk(alice.publicKeyBase64);
    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const [aliceKey, bobKey] = await Promise.all([
      globalThis.crypto.subtle.importKey(
        "jwk",
        alicePub,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        []
      ),
      globalThis.crypto.subtle.importKey(
        "jwk",
        bobPub,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        []
      ),
    ]);
    const wrappedForAlice = await wrapRootKey(
      alice.pair.privateKey,
      bobKey,
      "convo-existing",
      rootKey
    );
    const wrappedForBob = await wrapRootKey(
      bob.pair.privateKey,
      aliceKey,
      "convo-existing",
      rootKey
    );
    convo.keys = [
      {
        encryptedKey: wrappedForAlice.ciphertext,
        iv: wrappedForAlice.iv,
        ownerUserId: alice.id,
      },
      {
        encryptedKey: wrappedForBob.ciphertext,
        iv: wrappedForBob.iv,
        ownerUserId: bob.id,
      },
    ];

    const unwrapped = await ensureConversationKeys(
      convo as never,
      alice.pair.privateKey,
      alice.id
    );
    expect(
      Buffer.from(unwrapped ?? new Uint8Array()).equals(Buffer.from(rootKey))
    ).toBe(true);
    expect(postedKeys).toHaveLength(0);
  });

  test("heals a conversation missing only the peer's key", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const convo = makeConversation("convo-heal", alice, bob);
    const rootKey = generateRootKey();

    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const bobKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      bobPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const wrappedForAlice = await wrapRootKey(
      alice.pair.privateKey,
      bobKey,
      "convo-heal",
      rootKey
    );
    convo.keys = [
      {
        encryptedKey: wrappedForAlice.ciphertext,
        iv: wrappedForAlice.iv,
        ownerUserId: alice.id,
      },
    ];

    const unwrapped = await ensureConversationKeys(
      convo as never,
      alice.pair.privateKey,
      alice.id
    );
    expect(
      Buffer.from(unwrapped ?? new Uint8Array()).equals(Buffer.from(rootKey))
    ).toBe(true);
    // Only the peer's missing key is posted.
    expect(postedKeys).toHaveLength(1);
    expect(postedKeys[0].ownerUserId).toBe(bob.id);
  });
});

function pages(messages: { id: string }[]) {
  return [{ messages: [{ id: "older-1" }] }, { messages }];
}

describe("appendMessageToLastPage", () => {
  test("appends to the last page", () => {
    const next = appendMessageToLastPage(pages([{ id: "m1" }]), { id: "m2" });
    expect(next).not.toBeNull();
    expect(next?.at(-1)?.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  test("returns null (no change) when the message is already present", () => {
    const existing = [{ id: "m1" }];
    expect(appendMessageToLastPage(pages(existing), { id: "m1" })).toBeNull();
  });

  test("dedupes against the sender's optimistic fold of the same SSE echo", () => {
    // SSE echo landed first.
    const next = appendMessageToLastPage(pages([{ id: "m1" }]), { id: "m1" });
    expect(next).toBeNull();
    // Fold landed first.
    const afterFold = appendMessageToLastPage(pages([{ id: "m1" }]), {
      id: "m2",
    });
    expect(afterFold?.at(-1)?.messages).toHaveLength(2);
    const duplicateEcho = appendMessageToLastPage(afterFold ?? [], {
      id: "m2",
    });
    expect(duplicateEcho).toBeNull();
  });

  test("handles an empty page list", () => {
    expect(appendMessageToLastPage([], { id: "m1" })).toBeNull();
  });
});
