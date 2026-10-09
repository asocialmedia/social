// End-to-end proof that the native messages crypto agrees with itself across a
// two-party conversation, and with the WebCrypto primitives the web client uses.
//
// This is the test that would catch a wire-format regression: a root key wrapped
// on one device must unwrap on the other, a message sent must decrypt on the
// peer's device, and an edit must stay readable to the peer under the same epoch.
import { afterEach, describe, expect, test } from "bun:test";

import {
  createRootKeyStore,
  ensureConversationKeys,
  wrapRootKeyForPeer,
  reencryptMessageForEdit,
} from "./client";
import type { WrappedKeyPayload } from "./client";
import {
  ACCOUNT_SECRET_LENGTH,
  decryptMessage,
  deriveMasterKey,
  encryptMessage,
  encryptWithMasterKey,
  decryptWithMasterKey,
  editMessagePayload,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateAccountSecret,
  generateFingerprint,
  generateIdentityKeyPair,
  generateRootKey,
  getMediaImages,
  hashAccountSecret,
  importPrivateKeyJwk,
  importPublicKeyJwk,
  isAllowedMediaUrl,
  KDF_ITERATIONS,
  setNativeMasterKeyDeriver,
  publicKeyBase64ToJwk,
  publicKeyJwkToBase64,
  unwrapRootKey,
} from "./crypto";
import type { MessagePayload } from "./crypto";
import type { EcdhPrivateKey } from "./crypto-primitives";
import type { MessageConversationData } from "./types";

// Test-side shorthands for the raw wrap/unwrap primitives, so a case can go
// straight from key bytes to a stored blob without going through a conversation.
function wrapBlobFor(
  privateKey: EcdhPrivateKey,
  peerPublicBase64: string,
  conversationId: string
) {
  const rootKey = generateRootKey();
  return wrapRootKeyForPeer(
    privateKey,
    peerPublicBase64,
    conversationId,
    rootKey
  );
}

function unwrapBlobFor(
  privateKey: EcdhPrivateKey,
  peerPublicBase64: string,
  conversationId: string,
  blob: { ciphertext: string; iv: string }
) {
  return unwrapRootKey(
    privateKey,
    importPublicKeyJwk(publicKeyBase64ToJwk(peerPublicBase64)),
    conversationId,
    blob
  );
}

// ---- helpers -----------------------------------------------------------------

interface Party {
  privateKey: EcdhPrivateKey;
  publicKeyBase64: string;
  userId: string;
}

function makeParty(userId: string): Party {
  const { privateKey, publicKey } = generateIdentityKeyPair();
  return {
    privateKey,
    publicKeyBase64: publicKeyJwkToBase64(exportPublicKeyJwk(publicKey)),
    userId,
  };
}

function conversationOf(
  id: string,
  alice: Party,
  bob: Party,
  keys: MessageConversationData["keys"] = []
): MessageConversationData {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    id,
    keys,
    members: [
      {
        conversationId: id,
        lastReadAt: null,
        user: {
          avatarUrl: null,
          badge: null,
          badges: [],
          communityMemberships: [],
          displayName: "Alice",
          id: alice.userId,
          messageIdentity: { publicKey: alice.publicKeyBase64 },
          username: "alice",
        },
        userId: alice.userId,
      },
      {
        conversationId: id,
        lastReadAt: null,
        user: {
          avatarUrl: null,
          badge: null,
          badges: [],
          communityMemberships: [],
          displayName: "Bob",
          id: bob.userId,
          messageIdentity: { publicKey: bob.publicKeyBase64 },
          username: "bob",
        },
        userId: bob.userId,
      },
    ],
    pairKey: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// A transport recorder: every posted wrap is remembered, so the heal/rotate paths
// can assert on what would have gone over the wire.
function makePostKeysRecorder() {
  const posted: { conversationId: string; keys: WrappedKeyPayload[] }[] = [];
  return {
    postKeys: (conversationId: string, keys: WrappedKeyPayload[]) => {
      posted.push({ conversationId, keys });
      return Promise.resolve();
    },
    posted,
  };
}

describe("identity keypairs", () => {
  test("a stored public key round-trips through its compact form", () => {
    const { publicKey } = generateIdentityKeyPair();
    const jwk = exportPublicKeyJwk(publicKey);
    const encoded = publicKeyJwkToBase64(jwk);
    const decoded = publicKeyBase64ToJwk(encoded);
    expect(decoded).toEqual({ crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y });
    // And it must import back to the same usable key.
    expect(() => importPublicKeyJwk(decoded)).not.toThrow();
  });

  test("the compact form carries only crv/kty/x/y", () => {
    const { publicKey } = generateIdentityKeyPair();
    const encoded = publicKeyJwkToBase64(exportPublicKeyJwk(publicKey));
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf-8")
    ) as Record<string, unknown>;
    expect(Object.keys(parsed).toSorted()).toEqual(["crv", "kty", "x", "y"]);
  });

  test("a private key survives a JWK export/import round trip", async () => {
    const alice = makeParty("alice");
    const jwk = exportPrivateKeyJwk(alice.privateKey);
    const reimported = importPrivateKeyJwk(jwk);
    // Same private key, so the shared secret with any peer is unchanged.
    const bob = makeParty("bob");
    // Wrapped by the original key; only the imported copy unwraps it if the
    // round trip was lossless.
    const blob = await wrapBlobFor(
      alice.privateKey,
      bob.publicKeyBase64,
      "conv-1"
    );
    const viaOriginal = await unwrapBlobFor(
      alice.privateKey,
      bob.publicKeyBase64,
      "conv-1",
      blob
    );
    const viaReimported = await unwrapBlobFor(
      reimported,
      bob.publicKeyBase64,
      "conv-1",
      blob
    );
    expect(Buffer.from(viaReimported).toString("hex")).toBe(
      Buffer.from(viaOriginal).toString("hex")
    );
  });

  test("rejects a compact public key that is not a P-256 point", () => {
    expect(() =>
      publicKeyBase64ToJwk(
        Buffer.from(
          JSON.stringify({ crv: "P-384", kty: "EC", x: "a", y: "b" })
        ).toString("base64")
      )
    ).toThrow();
  });
});

describe("identity backup (master key)", () => {
  test("a fresh device recovers the private key from the stored row alone", async () => {
    // Exactly what the server does: derive from masterKeyHash + salt, decrypt
    // encryptedPrivateKey. No user input, no device secret.
    const salt = new Uint8Array(16).fill(9);
    const masterKeyHash = await hashAccountSecret(generateAccountSecret());
    const masterKey = await deriveMasterKey(
      masterKeyHash,
      salt,
      // A small count keeps the test fast; production uses KDF_ITERATIONS.
      1000
    );
    const { privateKey } = generateIdentityKeyPair();
    const blob = await encryptWithMasterKey(
      masterKey,
      JSON.stringify(exportPrivateKeyJwk(privateKey))
    );
    expect(blob.iv).not.toBe("");
    expect(blob.ciphertext).not.toBe("");

    // A second device, with only the row, derives the same key and recovers.
    const recoveredMaster = await deriveMasterKey(masterKeyHash, salt, 1000);
    const recoveredJwk = JSON.parse(
      await decryptWithMasterKey(recoveredMaster, blob)
    ) as JsonWebKey;
    const recovered = importPrivateKeyJwk(recoveredJwk);
    expect(Buffer.from(recovered).toString("hex")).toBe(
      Buffer.from(privateKey).toString("hex")
    );
  });

  test("a wrong master key hash cannot decrypt the backup", async () => {
    const salt = new Uint8Array(16).fill(9);
    const masterKey = await deriveMasterKey("the-right-hash", salt, 1000);
    const blob = await encryptWithMasterKey(
      masterKey,
      JSON.stringify(exportPrivateKeyJwk(generateIdentityKeyPair().privateKey))
    );
    const wrong = await deriveMasterKey("a-different-hash", salt, 1000);
    await expect(decryptWithMasterKey(wrong, blob)).rejects.toThrow();
  });

  test("a different salt derives a different key", async () => {
    const hash = await hashAccountSecret("same-secret");
    const a = await deriveMasterKey(hash, new Uint8Array(16).fill(1), 1000);
    const b = await deriveMasterKey(hash, new Uint8Array(16).fill(2), 1000);
    expect(Buffer.from(a).toString("hex")).not.toBe(
      Buffer.from(b).toString("hex")
    );
  });

  test("the account secret is the requested length and is not reused", () => {
    expect(generateAccountSecret()).toHaveLength(ACCOUNT_SECRET_LENGTH);
    expect(generateAccountSecret(20)).toHaveLength(20);
    expect(generateAccountSecret()).not.toBe(generateAccountSecret());
  });

  test("the production iteration count is unchanged", () => {
    expect(KDF_ITERATIONS).toBe(100_000);
  });
});

describe("conversation key wrapping", () => {
  test("a root key wrapped for one peer unwraps for them and nobody else", async () => {
    const alice = makeParty("alice");
    const bob = makeParty("bob");
    const mallory = makeParty("mallory");
    const conversationId = "conv-1";
    const rootKey = generateRootKey();

    const wrappedForBob = await wrapRootKeyForPeer(
      alice.privateKey,
      bob.publicKeyBase64,
      conversationId,
      rootKey
    );

    const bobView = await unwrapBlobFor(
      bob.privateKey,
      alice.publicKeyBase64,
      conversationId,
      wrappedForBob
    );
    expect(Buffer.from(bobView).toString("hex")).toBe(
      Buffer.from(rootKey).toString("hex")
    );

    await expect(
      unwrapBlobFor(
        mallory.privateKey,
        alice.publicKeyBase64,
        conversationId,
        wrappedForBob
      )
    ).rejects.toThrow();
  });

  test("a wrap is bound to its conversation id", async () => {
    const alice = makeParty("alice");
    const bob = makeParty("bob");
    const wrapped = await wrapRootKeyForPeer(
      alice.privateKey,
      bob.publicKeyBase64,
      "conv-1",
      generateRootKey()
    );
    await expect(
      unwrapBlobFor(bob.privateKey, alice.publicKeyBase64, "conv-2", wrapped)
    ).rejects.toThrow();
  });
});

describe("message ratchet", () => {
  test("a sent message decrypts on the peer's device", async () => {
    const alice = makeParty("alice");
    const bob = makeParty("bob");
    const conversationId = "conv-1";
    const rootKey = generateRootKey();
    const wrapped = await wrapRootKeyForPeer(
      alice.privateKey,
      bob.publicKeyBase64,
      conversationId,
      rootKey
    );
    const bobRoot = await unwrapBlobFor(
      bob.privateKey,
      alice.publicKeyBase64,
      conversationId,
      wrapped
    );

    const sent = await encryptMessage(
      rootKey,
      alice.userId,
      0,
      conversationId,
      { content: "hello there", type: "text" }
    );
    const received = await decryptMessage(
      bobRoot,
      alice.userId,
      conversationId,
      sent
    );
    expect(received).toEqual({ content: "hello there", type: "text" });
  });

  test("a message does not decrypt under another ratchet index", async () => {
    const rootKey = generateRootKey();
    const sent = await encryptMessage(rootKey, "alice", 3, "conv-1", {
      content: "hi",
      type: "text",
    });
    await expect(
      decryptMessage(rootKey, "alice", "conv-1", {
        ...sent,
        ratchetIndex: 4,
      })
    ).rejects.toThrow();
  });

  test("a message does not decrypt in another conversation", async () => {
    const rootKey = generateRootKey();
    const sent = await encryptMessage(rootKey, "alice", 0, "conv-1", {
      content: "hi",
      type: "text",
    });
    await expect(
      decryptMessage(rootKey, "alice", "conv-2", sent)
    ).rejects.toThrow();
  });

  test("the peer's identity is bound into the ciphertext", async () => {
    const rootKey = generateRootKey();
    const sent = await encryptMessage(rootKey, "alice", 0, "conv-1", {
      content: "hi",
      type: "text",
    });
    await expect(
      decryptMessage(rootKey, "mallory", "conv-1", sent)
    ).rejects.toThrow();
  });

  test("a media album round-trips with its caption and reply linkage", async () => {
    const rootKey = generateRootKey();
    const payload: MessagePayload = {
      content: "at the beach",
      images: [
        { height: 100, url: "/api/media/abc", width: 200 },
        { url: "https://cdn.example.com/x.png" },
      ],
      kind: "image",
      replyToId: "m-1",
      replyToSenderId: "alice",
      type: "media",
    };
    const sent = await encryptMessage(rootKey, "alice", 0, "conv-1", payload);
    const received = await decryptMessage(rootKey, "alice", "conv-1", sent);
    expect(received).toEqual(payload);
    expect(
      getMediaImages(received as Extract<MessagePayload, { type: "media" }>)
    ).toHaveLength(2);
  });

  test("the legacy single-url media form still decrypts", async () => {
    const rootKey = generateRootKey();
    const payload: MessagePayload = {
      height: 10,
      kind: "gif",
      type: "media",
      url: "https://cdn.example.com/a.gif",
      width: 20,
    };
    const sent = await encryptMessage(rootKey, "alice", 0, "conv-1", payload);
    const received = await decryptMessage(rootKey, "alice", "conv-1", sent);
    expect(
      getMediaImages(received as Extract<MessagePayload, { type: "media" }>)
    ).toEqual([
      { height: 10, url: "https://cdn.example.com/a.gif", width: 20 },
    ]);
  });

  test("an edit stays readable to the peer under the same epoch", async () => {
    const rootKey = generateRootKey();
    const sent = await encryptMessage(rootKey, "alice", 2, "conv-1", {
      content: "typo",
      type: "text",
    });
    const rewritten = await reencryptMessageForEdit({
      conversationId: "conv-1",
      current: sent,
      editedPayload: editMessagePayload(
        { content: "typo", type: "text" },
        "fixed"
      ),
      rootKeys: [generateRootKey(), rootKey],
      senderId: "alice",
    });
    expect(rewritten).not.toBeNull();
    // Same ratchet index: the server keeps it, so the peer re-decrypts the row
    // rather than appending a new message.
    expect(rewritten?.ratchetIndex).toBe(2);
    const received = await decryptMessage(rootKey, "alice", "conv-1", {
      ciphertext: rewritten?.ciphertext ?? "",
      iv: rewritten?.iv ?? "",
      ratchetIndex: 2,
    });
    expect(received).toEqual({ content: "fixed", type: "text" });
  });

  test("an edit is refused when no candidate epoch can read the message", async () => {
    const sent = await encryptMessage(generateRootKey(), "alice", 0, "conv-1", {
      content: "hi",
      type: "text",
    });
    const result = await reencryptMessageForEdit({
      conversationId: "conv-1",
      current: sent,
      editedPayload: { content: "changed", type: "text" },
      rootKeys: [generateRootKey(), generateRootKey()],
      senderId: "alice",
    });
    expect(result).toBeNull();
  });

  test("a tampered payload fails its GCM tag", async () => {
    const rootKey = generateRootKey();
    const sent = await encryptMessage(rootKey, "alice", 0, "conv-1", {
      content: "hi",
      type: "text",
    });
    // Any change to the ciphertext fails the GCM tag; it does not have to be a
    // specific bit flip.
    const bytes = Buffer.from(sent.ciphertext, "base64");
    bytes[0] = ((bytes[0] ?? 0) + 1) % 256;
    await expect(
      decryptMessage(rootKey, "alice", "conv-1", {
        ...sent,
        ciphertext: bytes.toString("base64"),
      })
    ).rejects.toThrow();
  });

  test("an unknown payload type is rejected at the trust boundary", async () => {
    const rootKey = generateRootKey();
    // A payload the validator would reject: the ciphertext is well-formed, so
    // only the post-decrypt parse can catch this.
    const bad = await encryptMessage(rootKey, "alice", 1, "conv-1", {
      anything: true,
    } as never);
    await expect(
      decryptMessage(rootKey, "alice", "conv-1", bad)
    ).rejects.toThrow("Invalid message payload");
  });
});

describe("media url policy", () => {
  test("accepts the app proxy path and its derivative", () => {
    expect(isAllowedMediaUrl("/api/media/abc123")).toBe(true);
    expect(isAllowedMediaUrl("/api/media/abc123/v/thumb.jpg")).toBe(true);
    expect(isAllowedMediaUrl("/api/media/abc123?w=100")).toBe(true);
  });

  test("accepts https", () => {
    expect(isAllowedMediaUrl("https://cdn.example.com/a.png")).toBe(true);
  });

  test("rejects javascript:, data:, and protocol-relative input", () => {
    // eslint-disable-next-line no-script-url -- the point of the assertion is that a peer-controlled payload cannot smuggle a script URL past the validator
    expect(isAllowedMediaUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedMediaUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isAllowedMediaUrl("//evil.example.com/a.png")).toBe(false);
  });

  test("rejects path traversal dressed up as a proxy path", () => {
    expect(isAllowedMediaUrl("/api/media/../secrets")).toBe(false);
    expect(isAllowedMediaUrl("/api/messages/identity")).toBe(false);
  });

  test("allows loopback http only in dev, as web does", () => {
    expect(isAllowedMediaUrl("http://localhost:3000/a.png")).toBe(false);
    expect(
      isAllowedMediaUrl("http://localhost:3000/a.png", {
        allowLoopbackHttp: true,
      })
    ).toBe(true);
    // The emulator alias is loopback-equivalent for a dev build.
    expect(
      isAllowedMediaUrl("http://10.0.2.2:3000/a.png", {
        allowLoopbackHttp: true,
      })
    ).toBe(true);
    // But a dev build still must not reach out to a real host over http.
    expect(
      isAllowedMediaUrl("http://evil.example.com/a.png", {
        allowLoopbackHttp: true,
      })
    ).toBe(false);
  });
});

describe("fingerprints", () => {
  test("is stable for the same key pair and differs across pairs", () => {
    const alice = generateIdentityKeyPair();
    const bob = generateIdentityKeyPair();
    const carol = makeParty("carol");
    const one = generateFingerprint(alice.publicKey, carol.publicKeyBase64);
    const two = generateFingerprint(alice.publicKey, carol.publicKeyBase64);
    const three = generateFingerprint(bob.publicKey, carol.publicKeyBase64);
    expect(one).toBe(two);
    expect(one).not.toBe(three);
    expect(one.split("-")).toHaveLength(4);
    expect(one).toMatch(/^(?<group>[0-9a-f]{8})(?:-[0-9a-f]{8}){3}$/);
  });
});

describe("root key store", () => {
  test("returns epochs newest-first and drops un-unwrappable wraps", async () => {
    const alice = makeParty("alice");
    const bob = makeParty("bob");
    const conversationId = "conv-1";
    const oldRoot = generateRootKey();
    const newRoot = generateRootKey();

    const store = createRootKeyStore(bob.privateKey);
    const roots = await store.getRootKeys(
      conversationId,
      [
        {
          encryptedKey: await wrapRootKeyForPeer(
            bob.privateKey,
            alice.publicKeyBase64,
            conversationId,
            oldRoot
          ),
          version: 1,
        },
        {
          encryptedKey: await wrapRootKeyForPeer(
            bob.privateKey,
            alice.publicKeyBase64,
            conversationId,
            newRoot
          ),
          version: 2,
        },
      ],
      alice.publicKeyBase64
    );

    expect(roots).toHaveLength(2);
    expect(Buffer.from(roots[0]).toString("hex")).toBe(
      Buffer.from(newRoot).toString("hex")
    );
    expect(Buffer.from(roots[1]).toString("hex")).toBe(
      Buffer.from(oldRoot).toString("hex")
    );
  });

  test("rejects when nothing unwraps", async () => {
    const alice = makeParty("alice");
    const bob = makeParty("bob");
    const mallory = makeParty("mallory");
    const store = createRootKeyStore(mallory.privateKey);
    await expect(
      store.getRootKeys(
        "conv-1",
        [
          {
            encryptedKey: await wrapRootKeyForPeer(
              bob.privateKey,
              alice.publicKeyBase64,
              "conv-1",
              generateRootKey()
            ),
            version: 1,
          },
        ],
        alice.publicKeyBase64
      )
    ).rejects.toThrow("No unwrappable conversation key");
  });

  test("a peer key change invalidates the cached roots", async () => {
    const alice = makeParty("alice");
    const bob = makeParty("bob");
    const store = createRootKeyStore(bob.privateKey);
    const first = await store.getRootKeys(
      "conv-1",
      [
        {
          encryptedKey: await wrapRootKeyForPeer(
            bob.privateKey,
            alice.publicKeyBase64,
            "conv-1",
            generateRootKey()
          ),
          version: 1,
        },
      ],
      alice.publicKeyBase64
    );
    // Same conversation, different peer key: the signature changes, so the cache
    // must not hand back the old roots.
    await expect(
      store.getRootKeys("conv-1", [], makeParty("other").publicKeyBase64)
    ).rejects.toThrow();
    expect(first).toHaveLength(1);
  });
});

describe("ensureConversationKeys", () => {
  test("heals a conversation that has no keys at all", async () => {
    const alice = makeParty("alice");
    const bob = makeParty("bob");
    const recorder = makePostKeysRecorder();

    const rootKey = await ensureConversationKeys(
      conversationOf("conv-1", alice, bob),
      bob.privateKey,
      bob.userId,
      { postKeys: recorder.postKeys }
    );
    expect(rootKey).not.toBeNull();

    // Nothing unwrapped, so a fresh epoch wrapped for both members is posted.
    expect(recorder.posted).toHaveLength(1);
    const keys = recorder.posted[0]?.keys as {
      ownerUserId: string;
      version: number;
    }[];
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.ownerUserId).toSorted()).toEqual([
      alice.userId,
      bob.userId,
    ]);
    expect(keys[0]?.version).toBe(1);
  });

  test("wraps the peer's missing wrap for an existing epoch", async () => {
    const alice = makeParty("alice");
    const bob = makeParty("bob");
    const conversationId = "conv-1";
    const rootKey = generateRootKey();
    const bobWrap = await wrapRootKeyForPeer(
      bob.privateKey,
      alice.publicKeyBase64,
      conversationId,
      rootKey
    );
    const recorder = makePostKeysRecorder();

    const unwrapped = await ensureConversationKeys(
      conversationOf(conversationId, alice, bob, [
        {
          conversationId,
          createdAt: "2026-01-01T00:00:00.000Z",
          encryptedKey: bobWrap.ciphertext,
          id: "k1",
          iv: bobWrap.iv,
          ownerUserId: bob.userId,
          ratchetCounter: 0,
          version: 1,
        },
      ]),
      bob.privateKey,
      bob.userId,
      { postKeys: recorder.postKeys }
    );

    expect(Buffer.from(unwrapped ?? new Uint8Array()).toString("hex")).toBe(
      Buffer.from(rootKey).toString("hex")
    );
    // Exactly the missing peer wrap, not a rotation.
    expect(recorder.posted).toHaveLength(1);
    const keys = recorder.posted[0]?.keys as { ownerUserId: string }[];
    expect(keys).toHaveLength(1);
    expect(keys[0]?.ownerUserId).toBe(alice.userId);
  });

  test("does nothing when both wraps are already present", async () => {
    const alice = makeParty("alice");
    const bob = makeParty("bob");
    const conversationId = "conv-1";
    const rootKey = generateRootKey();
    const recorder = makePostKeysRecorder();
    const bobWrap = await wrapRootKeyForPeer(
      bob.privateKey,
      alice.publicKeyBase64,
      conversationId,
      rootKey
    );
    const aliceWrap = await wrapRootKeyForPeer(
      bob.privateKey,
      alice.publicKeyBase64,
      conversationId,
      rootKey
    );

    const unwrapped = await ensureConversationKeys(
      conversationOf(conversationId, alice, bob, [
        {
          conversationId,
          createdAt: "2026-01-01T00:00:00.000Z",
          encryptedKey: bobWrap.ciphertext,
          id: "k1",
          iv: bobWrap.iv,
          ownerUserId: bob.userId,
          ratchetCounter: 0,
          version: 1,
        },
        {
          conversationId,
          createdAt: "2026-01-01T00:00:00.000Z",
          encryptedKey: aliceWrap.ciphertext,
          id: "k2",
          iv: aliceWrap.iv,
          ownerUserId: alice.userId,
          ratchetCounter: 0,
          version: 1,
        },
      ]),
      bob.privateKey,
      bob.userId,
      { postKeys: recorder.postKeys }
    );

    expect(unwrapped).not.toBeNull();
    expect(recorder.posted).toHaveLength(0);
  });

  test("rotates to a new epoch after an identity reset, keeping the peer's old wrap", async () => {
    const alice = makeParty("alice");
    const oldBob = makeParty("bob");
    const newBob = makeParty("bob");
    const conversationId = "conv-1";
    const oldRoot = generateRootKey();
    // A wrap the OLD bob can read but the new bob cannot.
    const staleWrap = await wrapRootKeyForPeer(
      oldBob.privateKey,
      alice.publicKeyBase64,
      conversationId,
      oldRoot
    );
    const recorder = makePostKeysRecorder();

    const rotated = await ensureConversationKeys(
      conversationOf(conversationId, alice, oldBob, [
        {
          conversationId,
          createdAt: "2026-01-01T00:00:00.000Z",
          encryptedKey: staleWrap.ciphertext,
          id: "k1",
          iv: staleWrap.iv,
          ownerUserId: oldBob.userId,
          ratchetCounter: 0,
          version: 1,
        },
      ]),
      newBob.privateKey,
      newBob.userId,
      { postKeys: recorder.postKeys }
    );

    expect(rotated).not.toBeNull();
    expect(Buffer.from(rotated ?? new Uint8Array()).toString("hex")).not.toBe(
      Buffer.from(oldRoot).toString("hex")
    );
    const keys = recorder.posted[0]?.keys as {
      encryptedKey: { ciphertext: string };
      ownerUserId: string;
      version: number;
    }[];
    // A new epoch for both, and the stale epoch is untouched on the server.
    expect(keys.map((k) => k.version)).toEqual([2, 2]);
    expect(keys.map((k) => k.ownerUserId).toSorted()).toEqual([
      alice.userId,
      newBob.userId,
    ]);
    // The peer's new wrap must be readable by alice, who did not reset.
    const aliceWrap = keys.find((k) => k.ownerUserId === alice.userId);
    expect(aliceWrap).toBeDefined();
    const aliceReads = await unwrapBlobFor(
      alice.privateKey,
      newBob.publicKeyBase64,
      conversationId,
      aliceWrap?.encryptedKey as { ciphertext: string; iv: string }
    );
    expect(Buffer.from(aliceReads).toString("hex")).toBe(
      Buffer.from(rotated ?? new Uint8Array()).toString("hex")
    );
  });

  test("refreshes before rotating, so a stale snapshot never mints an unwrappable epoch", async () => {
    const alice = makeParty("alice");
    const bob = makeParty("bob");
    const conversationId = "conv-1";
    const rootKey = generateRootKey();
    const goodWrap = await wrapRootKeyForPeer(
      bob.privateKey,
      alice.publicKeyBase64,
      conversationId,
      rootKey
    );
    const recorder = makePostKeysRecorder();

    // The snapshot we start from carries NO usable key for us, but the fresh
    // fetch reveals one. Rotating here would be a real bug.
    const unwrapped = await ensureConversationKeys(
      conversationOf(conversationId, alice, bob, []),
      bob.privateKey,
      bob.userId,
      {
        postKeys: recorder.postKeys,
        refreshConversation: () =>
          Promise.resolve(
            conversationOf(conversationId, alice, bob, [
              {
                conversationId,
                createdAt: "2026-01-01T00:00:00.000Z",
                encryptedKey: goodWrap.ciphertext,
                id: "k1",
                iv: goodWrap.iv,
                ownerUserId: bob.userId,
                ratchetCounter: 0,
                version: 1,
              },
            ])
          ),
      }
    );

    expect(Buffer.from(unwrapped ?? new Uint8Array()).toString("hex")).toBe(
      Buffer.from(rootKey).toString("hex")
    );
    // The one post is the healed peer wrap at the EXISTING epoch 1, not a
    // rotation. A rotation here would be the bug this guard exists to prevent.
    expect(recorder.posted).toHaveLength(1);
    const healed = recorder.posted[0]?.keys as {
      ownerUserId: string;
      version: number;
    }[];
    expect(healed).toHaveLength(1);
    expect(healed[0]?.ownerUserId).toBe(alice.userId);
    expect(healed[0]?.version).toBe(1);
  });

  test("returns null when the peer has no identity", async () => {
    const alice = makeParty("alice");
    const bob = makeParty("bob");
    const conversation = conversationOf("conv-1", alice, bob);
    const [, peerMember] = conversation.members;
    if (!peerMember) {
      throw new Error("conversationOf should build two members");
    }
    conversation.members[1] = {
      ...peerMember,
      user: { ...peerMember.user, messageIdentity: null },
    };
    const recorder = makePostKeysRecorder();
    await expect(
      ensureConversationKeys(conversation, alice.privateKey, alice.userId, {
        postKeys: recorder.postKeys,
      })
    ).resolves.toBeNull();
    expect(recorder.posted).toHaveLength(0);
  });
});

describe("native background master key", () => {
  afterEach(() => setNativeMasterKeyDeriver(null));

  test("uses the native driver without changing the stored-row KDF inputs", async () => {
    const salt = new Uint8Array(16).fill(4);
    const hash = "stored-row-master-key-hash";
    const expected = await deriveMasterKey(hash, salt);
    const calls: { secret: string; salt: Uint8Array; iterations: number }[] =
      [];
    setNativeMasterKeyDeriver((secret, receivedSalt, iterations) => {
      calls.push({ iterations, salt: receivedSalt, secret });
      return Promise.resolve(expected);
    });
    const derived = await deriveMasterKey(hash, salt);
    expect(calls).toEqual([{ iterations: KDF_ITERATIONS, salt, secret: hash }]);
    const backup = await encryptWithMasterKey(
      expected,
      "existing identity backup"
    );
    expect(await decryptWithMasterKey(derived, backup)).toBe(
      "existing identity backup"
    );
  });

  test("rejects malformed native key results instead of encrypting an unreadable backup", async () => {
    setNativeMasterKeyDeriver(() => Promise.resolve(new Uint8Array(16)));
    await expect(deriveMasterKey("hash", new Uint8Array(16))).rejects.toThrow(
      "Invalid derived message key length"
    );
  });
});

test("conversation recovery works when Hermes has no copying array methods", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "toSorted"
  );
  // oxlint-disable-next-line no-extend-native -- emulate the release Hermes runtime for this regression, restored below
  Object.defineProperty(Array.prototype, "toSorted", {
    configurable: true,
    value: undefined,
  });
  try {
    const alice = makeParty("hermes-alice");
    const bob = makeParty("hermes-bob");
    const conversation = conversationOf("hermes-conversation", alice, bob);
    const written: WrappedKeyPayload[] = [];
    const root = await ensureConversationKeys(
      conversation,
      alice.privateKey,
      alice.userId,
      {
        postKeys: (_target, keys) => {
          written.push(...keys);
          return Promise.resolve();
        },
        refreshConversation: () => Promise.resolve(conversation),
      }
    );
    expect(root?.length).toBe(32);
    if (!root) {
      throw new Error("Root not provisioned");
    }
    const mine = written
      .filter((wrap) => wrap.ownerUserId === alice.userId)
      .map((wrap) => ({
        encryptedKey: wrap.encryptedKey,
        version: wrap.version ?? 1,
      }));
    const recovered = await createRootKeyStore(alice.privateKey).getRootKeys(
      conversation.id,
      mine,
      bob.publicKeyBase64
    );
    expect(recovered[0]).toEqual(root);
  } finally {
    if (descriptor) {
      // oxlint-disable-next-line no-extend-native -- restore the test runtime after the Hermes regression
      Object.defineProperty(Array.prototype, "toSorted", descriptor);
    }
  }
});
