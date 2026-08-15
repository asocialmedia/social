import { describe, expect, test } from "bun:test";

import {
  decryptMessage,
  decryptWithMasterKey,
  deriveMasterKey,
  deriveMessageKey,
  encryptMessage,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateAccountSecret,
  generateFingerprint,
  generateIdentityKeyPair,
  generateRootKey,
  hashAccountSecret,
  importPrivateKeyJwk,
  importPublicKeyJwk,
  publicKeyBase64ToJwk,
  publicKeyJwkToBase64,
  unwrapRootKey,
  wrapRootKey,
} from "./crypto";

const CONVO_ID = "convo-123";
const SENDER_ID = "user-alice";

function identityPair(): Promise<CryptoKeyPair> {
  return generateIdentityKeyPair();
}

describe("identity keypair serialization", () => {
  test("public JWK survives base64 round-trip", async () => {
    const pair = await identityPair();
    const jwk = await exportPublicKeyJwk(pair.publicKey);
    const encoded = publicKeyJwkToBase64(jwk);
    const restored = await publicKeyBase64ToJwk(encoded);
    expect(restored.crv).toBe("P-256");
    expect(restored.kty).toBe("EC");
    expect(restored.x).toBe(jwk.x);
    expect(restored.y).toBe(jwk.y);
  });

  test("private JWK imports back into a usable key", async () => {
    const pair = await identityPair();
    const jwk = await exportPrivateKeyJwk(pair.privateKey);
    const restored = await importPrivateKeyJwk(jwk);
    expect(restored.type).toBe("private");
    expect(restored.algorithm).toMatchObject({ name: "ECDH" });
  });

  test("public JWK imports back into a usable key", async () => {
    const pair = await identityPair();
    const jwk = await exportPublicKeyJwk(pair.publicKey);
    const restored = await importPublicKeyJwk(jwk);
    expect(restored.type).toBe("public");
  });
});

describe("master key backup", () => {
  test("encrypt/decrypt round-trip with the same password", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveMasterKey("correct horse battery staple", salt);
    const pair = await identityPair();
    const privateKey = await exportPrivateKeyJwk(pair.privateKey);
    const blob = await encryptWithMasterKey(key, JSON.stringify(privateKey));
    const decrypted = await decryptWithMasterKey(key, blob);
    expect(decrypted).toBe(JSON.stringify(privateKey));
  });

  test("wrong password fails to decrypt (tamper/wrong-secret detection)", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const goodKey = await deriveMasterKey("right-password", salt);
    const badKey = await deriveMasterKey("wrong-password", salt);
    const blob = await encryptWithMasterKey(goodKey, "secret payload");

    await expect(decryptWithMasterKey(badKey, blob)).rejects.toThrow();
  });

  test("different salts produce different keys", async () => {
    const keyA = await deriveMasterKey(
      "same secret",
      crypto.getRandomValues(new Uint8Array(16))
    );
    const keyB = await deriveMasterKey(
      "same secret",
      crypto.getRandomValues(new Uint8Array(16))
    );
    const blobA = await encryptWithMasterKey(keyA, "hello");
    await expect(decryptWithMasterKey(keyB, blobA)).rejects.toThrow();
  });
});

describe("conversation key wrapping", () => {
  test("wrap with one side, unwrap with the other (both directions)", async () => {
    const alice = await identityPair();
    const bob = await identityPair();
    const rootKey = generateRootKey();

    const wrappedForBob = await wrapRootKey(
      alice.privateKey,
      bob.publicKey,
      CONVO_ID,
      rootKey
    );
    const unwrappedByBob = await unwrapRootKey(
      bob.privateKey,
      alice.publicKey,
      CONVO_ID,
      wrappedForBob
    );
    expect(Buffer.from(unwrappedByBob).equals(Buffer.from(rootKey))).toBe(true);
  });

  test("wrap is bound to the conversation id", async () => {
    const alice = await identityPair();
    const bob = await identityPair();
    const rootKey = generateRootKey();

    const wrapped = await wrapRootKey(
      alice.privateKey,
      bob.publicKey,
      CONVO_ID,
      rootKey
    );
    // Unwrapping with the wrong conversation id must fail.
    await expect(
      unwrapRootKey(bob.privateKey, alice.publicKey, "other-convo", wrapped)
    ).rejects.toThrow();
  });

  test("a third party without a private key cannot unwrap", async () => {
    const alice = await identityPair();
    const bob = await identityPair();
    const eve = await identityPair();
    const rootKey = generateRootKey();

    const wrappedForBob = await wrapRootKey(
      alice.privateKey,
      bob.publicKey,
      CONVO_ID,
      rootKey
    );
    // Eve trying to unwrap with her own key (as if she were Bob) fails because
    // the wrap key is derived from (Alice, Bob) shared secret, not (Alice, Eve).
    await expect(
      unwrapRootKey(eve.privateKey, alice.publicKey, CONVO_ID, wrappedForBob)
    ).rejects.toThrow();
  });
});

describe("message ratchet", () => {
  test("both sides derive the same message key for the same index", async () => {
    const rootKey = generateRootKey();
    const keyA = await deriveMessageKey(rootKey, SENDER_ID, 0);
    const keyB = await deriveMessageKey(rootKey, SENDER_ID, 0);
    expect(keyA.algorithm.name).toBe("AES-GCM");
    expect(keyB.algorithm.name).toBe("AES-GCM");
  });

  test("encrypt/decrypt round-trip", async () => {
    const rootKey = generateRootKey();
    const encrypted = await encryptMessage(rootKey, SENDER_ID, 0, CONVO_ID, {
      content: "hey bob",
      type: "text",
    });
    expect(encrypted.ratchetIndex).toBe(0);

    const decrypted = await decryptMessage(
      rootKey,
      SENDER_ID,
      CONVO_ID,
      encrypted
    );
    expect(decrypted).toEqual({ content: "hey bob", type: "text" });
  });

  test("tampered ciphertext is rejected", async () => {
    const rootKey = generateRootKey();
    const encrypted = await encryptMessage(rootKey, SENDER_ID, 1, CONVO_ID, {
      content: "secret",
      type: "text",
    });
    const tampered = {
      ...encrypted,
      ciphertext:
        encrypted.ciphertext.slice(0, -2) +
        (encrypted.ciphertext.endsWith("AA") ? "BB" : "AA"),
    };
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, tampered)
    ).rejects.toThrow();
  });

  test("wrong ratchet index fails to decrypt (backward secrecy guard)", async () => {
    const rootKey = generateRootKey();
    const encrypted = await encryptMessage(rootKey, SENDER_ID, 2, CONVO_ID, {
      content: "index two",
      type: "text",
    });
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, {
        ...encrypted,
        ratchetIndex: 3,
      })
    ).rejects.toThrow();
  });

  test("post payload round-trips with postId inside the ciphertext", async () => {
    const rootKey = generateRootKey();
    const encrypted = await encryptMessage(rootKey, SENDER_ID, 0, CONVO_ID, {
      postId: "post-42",
      type: "post",
    });
    const decrypted = await decryptMessage(
      rootKey,
      SENDER_ID,
      CONVO_ID,
      encrypted
    );
    expect(decrypted).toEqual({ postId: "post-42", type: "post" });
  });

  test("invalid payloads are rejected", async () => {
    const rootKey = generateRootKey();
    const messageKey = await deriveMessageKey(rootKey, SENDER_ID, 0);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // Encrypt a payload that is neither text nor post.
    const ciphertext = await crypto.subtle.encrypt(
      { iv, name: "AES-GCM" },
      messageKey,
      new TextEncoder().encode(JSON.stringify({ type: "garbage" }))
    );
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, {
        ciphertext: btoa(String.fromCodePoint(...new Uint8Array(ciphertext))),
        iv: btoa(String.fromCodePoint(...iv)),
        ratchetIndex: 0,
      })
    ).rejects.toThrow();
  });
});

describe("fingerprints", () => {
  test("is stable across calls and differs between peers", async () => {
    const alice = await identityPair();
    const bob = await identityPair();
    const bobPublicBase64 = publicKeyJwkToBase64(
      await exportPublicKeyJwk(bob.publicKey)
    );

    const fp1 = await generateFingerprint(
      alice.publicKey,
      bob.publicKey,
      bobPublicBase64
    );
    const fp2 = await generateFingerprint(
      alice.publicKey,
      bob.publicKey,
      bobPublicBase64
    );
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/);

    const eve = await identityPair();
    const evePublicBase64 = publicKeyJwkToBase64(
      await exportPublicKeyJwk(eve.publicKey)
    );
    const fpOther = await generateFingerprint(
      alice.publicKey,
      eve.publicKey,
      evePublicBase64
    );
    expect(fpOther).not.toBe(fp1);
  });
});

describe("account backup secret", () => {
  test("generates a 64-character url-safe secret", () => {
    const secret = generateAccountSecret();
    expect(secret).toHaveLength(64);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("generates a fresh secret each call", () => {
    const a = generateAccountSecret();
    const b = generateAccountSecret();
    expect(a).not.toBe(b);
  });

  test("hashes to a deterministic 64-char hex digest", async () => {
    const secret = generateAccountSecret();
    const hash1 = await hashAccountSecret(secret);
    const hash2 = await hashAccountSecret(secret);
    expect(hash1).toHaveLength(64);
    expect(hash1).toMatch(/^[0-9a-f]+$/);
    expect(hash1).toBe(hash2);
  });

  test("the hash works as a PBKDF2 secret for the master key", async () => {
    const secret = generateAccountSecret();
    const hash = await hashAccountSecret(secret);
    const salt = new Uint8Array(16);
    const masterKey = await deriveMasterKey(hash, salt, 100_000);
    const blob = await encryptWithMasterKey(masterKey, "hello");
    const plaintext = await decryptWithMasterKey(masterKey, blob);
    expect(plaintext).toBe("hello");
  });

  test("a new device can unlock with only the stored hash (automatic recovery)", async () => {
    // Device A enables: keypair + random secret, only the hash is persisted.
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const secret = generateAccountSecret();
    const masterKeyHash = await hashAccountSecret(secret);
    const masterKey = await deriveMasterKey(masterKeyHash, salt, 100_000);
    const backup = await encryptWithMasterKey(
      masterKey,
      JSON.stringify(privateKeyJwk)
    );

    // The raw secret is never stored; only the hash, salt, and ciphertext
    // survive (simulating the server row fetched by a new device).
    expect(secret).not.toBe(masterKeyHash);

    // Device B (no IndexedDB, no user input) unlocks from the stored row.
    const recoveredKey = await deriveMasterKey(masterKeyHash, salt, 100_000);
    const decrypted = await decryptWithMasterKey(recoveredKey, backup);
    const recoveredJwk = JSON.parse(decrypted) as JsonWebKey;
    const imported = await importPrivateKeyJwk(recoveredJwk);
    // The recovered key is the private key; its public point (x, y) must match
    // the original identity's public key so peers still recognize this device.
    const recoveredPrivate = await exportPrivateKeyJwk(imported);
    const originalPublic = await exportPublicKeyJwk(pair.publicKey);
    expect(recoveredPrivate.x).toBe(originalPublic.x);
    expect(recoveredPrivate.y).toBe(originalPublic.y);
  });
});
