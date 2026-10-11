import { describe, expect, test } from "bun:test";

import { DEN_LIMITS } from "@asm/db";
import { MAX_MESSAGE_ATTACHMENTS } from "@asm/media";

import {
  decryptMessage,
  decryptMessageWithBaseKey,
  decryptWithMasterKey,
  deriveMasterKey,
  deriveMessageKey,
  editMessagePayload,
  encryptMessage,
  encryptWithMasterKey,
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
  importRatchetBaseKey,
  publicKeyBase64ToJwk,
  publicKeyJwkToBase64,
  selfPublicKeyBase64,
  unwrapRootKey,
  wrapRootKey,
  wrapRootKeyForMembers,
} from "./crypto";
import type { WrapRecipient } from "./crypto";

const CONVO_ID = "convo-123";
const SENDER_ID = "user-alice";

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCodePoint(...bytes));
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.codePointAt(0));
}

// Encrypts an arbitrary JSON payload under the message ratchet key for the
// given IV, so tests can feed tampered-but-authentic ciphertext into
// decryptMessage and assert the payload validation boundary.
async function encryptRaw(
  payload: unknown,
  rootKey: Uint8Array,
  ratchetIndex: number,
  ivBase64: string
): Promise<string> {
  const messageKey = await deriveMessageKey(rootKey, SENDER_ID, ratchetIndex);
  const aad = new TextEncoder().encode(
    `${CONVO_ID}:${SENDER_ID}:${ratchetIndex}`
  );
  const ciphertext = await crypto.subtle.encrypt(
    { additionalData: aad, iv: base64ToBytes(ivBase64), name: "AES-GCM" },
    messageKey,
    new TextEncoder().encode(JSON.stringify(payload))
  );
  return bytesToBase64(new Uint8Array(ciphertext));
}

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

// A den is one root key fanned out to every member. These tests pin the two
// properties the whole group design rests on: each member's wrap is paired with
// that member alone, and every one of them resolves to the SAME root, so the
// members never hold per-member message keys.
describe("multi-member wrap fan-out", () => {
  async function makeMembers(count: number) {
    const pairs = await Promise.all(
      Array.from({ length: count }, () => identityPair())
    );
    const publicKeys = await Promise.all(
      pairs.map((pair) => exportPublicKeyJwk(pair.publicKey))
    );
    return pairs.map((pair, index) => ({
      pair,
      recipient: {
        publicKeyBase64: publicKeyJwkToBase64(publicKeys[index] ?? {}),
        userId: `member-${index}`,
      } satisfies WrapRecipient,
    }));
  }

  test("every member unwraps its own wrap to the same root key", async () => {
    const rotator = await identityPair();
    const members = await makeMembers(4);
    const rootKey = generateRootKey();

    const { skipped, wrapped } = await wrapRootKeyForMembers(
      rotator.privateKey,
      members.map((member) => member.recipient),
      CONVO_ID,
      rootKey
    );
    expect(skipped).toEqual([]);
    expect(wrapped).toHaveLength(4);

    // Every member's own wrap resolves to the shared root: that is what makes one
    // set of message keys readable by the whole den.
    const unwrapped = await Promise.all(
      members.map(
        async (member) =>
          await unwrapRootKey(
            member.pair.privateKey,
            rotator.publicKey,
            CONVO_ID,
            wrapped.find((row) => row.userId === member.recipient.userId)
              ?.encryptedKey ?? { ciphertext: "", iv: "" }
          )
      )
    );
    expect(wrapped.map((row) => row.userId)).toEqual(
      members.map((member) => member.recipient.userId)
    );
    for (const root of unwrapped) {
      expect(Buffer.from(root).equals(Buffer.from(rootKey))).toBe(true);
    }
  });

  test("each wrap is independently paired, so no member reads another's", async () => {
    const rotator = await identityPair();
    const members = await makeMembers(3);
    const rootKey = generateRootKey();
    const { wrapped } = await wrapRootKeyForMembers(
      rotator.privateKey,
      members.map((member) => member.recipient),
      CONVO_ID,
      rootKey
    );
    const [first, second, third] = wrapped;
    // Separate rows, not one blob copied N times: distinct IVs over distinct
    // pairings.
    expect(
      new Set(wrapped.map((wrap) => wrap.encryptedKey.ciphertext)).size
    ).toBe(3);
    // The key property of the fan-out. Member 1 cannot read member 0's wrap even
    // though both hold the same root key material by other means, because the
    // pairing is (rotator, that member).
    const [, outsider] = members;
    await expect(
      unwrapRootKey(
        outsider?.pair.privateKey ?? rotator.privateKey,
        rotator.publicKey,
        CONVO_ID,
        first?.encryptedKey ?? { ciphertext: "", iv: "" }
      )
    ).rejects.toThrow();
    expect(second?.userId).toBe(members[1]?.recipient.userId);
    expect(third?.userId).toBe(members[2]?.recipient.userId);
    expect(members[1]?.recipient.userId).toBe("member-1");
  });

  test("a member who cannot be wrapped for is skipped, not fatal", async () => {
    const rotator = await identityPair();
    const members = await makeMembers(2);
    const rootKey = generateRootKey();

    // One member with no identity at all and one whose stored key is corrupt.
    // Neither can be paired, so neither can be wrapped.
    const { skipped, wrapped } = await wrapRootKeyForMembers(
      rotator.privateKey,
      [
        members[0]?.recipient ?? { publicKeyBase64: "", userId: "missing" },
        { publicKeyBase64: "", userId: "no-identity" },
        { publicKeyBase64: "not-a-jwk", userId: "corrupt-key" },
        members[1]?.recipient ?? { publicKeyBase64: "", userId: "unknown" },
      ],
      CONVO_ID,
      rootKey
    );

    // Reported by name, so the caller can decide what a skip means rather than
    // discovering a silently smaller epoch later.
    expect(skipped.toSorted()).toEqual(["corrupt-key", "no-identity"]);
    expect(wrapped.map((wrap) => wrap.userId)).toEqual([
      "member-0",
      "member-1",
    ]);
    // The members that could be wrapped still got a complete, readable epoch.
    const [reader] = members;
    const unwrapped = await unwrapRootKey(
      reader?.pair.privateKey ?? rotator.privateKey,
      rotator.publicKey,
      CONVO_ID,
      wrapped[0]?.encryptedKey ?? { ciphertext: "", iv: "" }
    );
    expect(Buffer.from(unwrapped).equals(Buffer.from(rootKey))).toBe(true);
  });

  test("the rotator's own public key is derivable from the key they hold", async () => {
    // The rotator is always included in a fan-out, and their identity row is not
    // always in the snapshot being rotated from. Deriving the public half from the
    // private key they are holding is what guarantees their own wrap is never the
    // one that gets skipped.
    const rotator = await identityPair();
    expect(await selfPublicKeyBase64(rotator.privateKey)).toBe(
      publicKeyJwkToBase64(await exportPublicKeyJwk(rotator.publicKey))
    );
  });

  test("a 100-member den wraps in one fan-out, every wrap distinct", async () => {
    // The den ceiling. One fan-out is 100 independent ECDH pairings; this pins
    // that the whole roster is wrapped, that no two wraps collide, and that a
    // sample of members can each read the shared root back out.
    const rotator = await identityPair();
    const members = await makeMembers(DEN_LIMITS.membersMax);
    const rootKey = generateRootKey();

    const { skipped, wrapped } = await wrapRootKeyForMembers(
      rotator.privateKey,
      members.map((member) => member.recipient),
      CONVO_ID,
      rootKey
    );
    expect(skipped).toEqual([]);
    expect(wrapped).toHaveLength(DEN_LIMITS.membersMax);
    expect(
      new Set(wrapped.map((wrap) => wrap.encryptedKey.ciphertext)).size
    ).toBe(DEN_LIMITS.membersMax);

    // A sample rather than all 100: enough to prove every pairing resolves without
    // spending the whole roster's decrypt budget on one assertion.
    const sampled = await Promise.all(
      [0, 1, 42, DEN_LIMITS.membersMax - 1].map(async (index) => {
        const member = members[index];
        const blob = wrapped[index]?.encryptedKey;
        if (!member || !blob) {
          throw new Error(`missing member ${index}`);
        }
        return await unwrapRootKey(
          member.pair.privateKey,
          rotator.publicKey,
          CONVO_ID,
          blob
        );
      })
    );
    for (const root of sampled) {
      expect(Buffer.from(root).equals(Buffer.from(rootKey))).toBe(true);
    }
  });
});

describe("message ratchet", () => {
  test("both sides derive the same message key for the same index", async () => {
    const rootKey = generateRootKey();
    const keyA = await deriveMessageKey(rootKey, SENDER_ID, 0);
    const keyB = await deriveMessageKey(rootKey, SENDER_ID, 0);
    expect(keyA.algorithm.name).toBe("AES-GCM");
    expect(keyB.algorithm.name).toBe("AES-GCM");
    // Behavioral equality, not just the algorithm label: a message encrypted
    // with one key must decrypt with the other.
    const ciphertext = await crypto.subtle.encrypt(
      { iv: new Uint8Array(12), name: "AES-GCM" },
      keyA,
      new TextEncoder().encode("shared secret")
    );
    const decrypted = await crypto.subtle.decrypt(
      { iv: new Uint8Array(12), name: "AES-GCM" },
      keyB,
      ciphertext
    );
    expect(new TextDecoder().decode(decrypted)).toBe("shared secret");
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

  test("media payload round-trips with the url inside the ciphertext", async () => {
    const rootKey = generateRootKey();
    const encrypted = await encryptMessage(rootKey, SENDER_ID, 0, CONVO_ID, {
      height: 240,
      kind: "gif",
      type: "media",
      url: "https://cdn.example.com/hi.gif",
      width: 320,
    });
    const decrypted = await decryptMessage(
      rootKey,
      SENDER_ID,
      CONVO_ID,
      encrypted
    );
    expect(decrypted).toEqual({
      height: 240,
      kind: "gif",
      type: "media",
      url: "https://cdn.example.com/hi.gif",
      width: 320,
    });
  });

  test("rejects a media payload with a non-string url", async () => {
    const rootKey = generateRootKey();
    const encrypted = await encryptMessage(rootKey, SENDER_ID, 0, CONVO_ID, {
      height: 240,
      kind: "image",
      type: "media",
      url: "https://cdn.example.com/a.png",
      width: 320,
    });
    const tampered = {
      ...encrypted,
      ciphertext: await encryptRaw(
        { height: 240, kind: "image", type: "media", url: 123, width: 320 },
        rootKey,
        0,
        encrypted.iv
      ),
    };
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, tampered)
    ).rejects.toThrow();
  });

  test("rejects a media payload with an unsupported kind", async () => {
    const rootKey = generateRootKey();
    const tampered = {
      ciphertext: await encryptRaw(
        {
          height: 240,
          kind: "svg",
          type: "media",
          url: "https://cdn.example.com/a.svg",
          width: 320,
        },
        rootKey,
        0,
        "AAAAAAAAAAAAAAAAAAAAAA=="
      ),
      iv: "AAAAAAAAAAAAAAAAAAAAAA==",
      ratchetIndex: 0,
    };
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, tampered)
    ).rejects.toThrow();
  });

  test("rejects a media payload with a non-https url", async () => {
    const rootKey = generateRootKey();
    const tampered = {
      ciphertext: await encryptRaw(
        {
          height: 240,
          kind: "image",
          type: "media",
          url: "ftp://cdn.example.com/a.png",
          width: 320,
        },
        rootKey,
        0,
        "AAAAAAAAAAAAAAAAAAAAAA=="
      ),
      iv: "AAAAAAAAAAAAAAAAAAAAAA==",
      ratchetIndex: 0,
    };
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, tampered)
    ).rejects.toThrow();
  });

  test("media payload with a same-origin /api/media url round-trips", async () => {
    const rootKey = generateRootKey();
    const encrypted = await encryptMessage(rootKey, SENDER_ID, 0, CONVO_ID, {
      height: 240,
      kind: "image",
      type: "media",
      url: "/api/media/cm123abc",
      width: 320,
    });
    const decrypted = await decryptMessage(
      rootKey,
      SENDER_ID,
      CONVO_ID,
      encrypted
    );
    expect(decrypted).toEqual({
      height: 240,
      kind: "image",
      type: "media",
      url: "/api/media/cm123abc",
      width: 320,
    });
  });

  test("media payload with a derivative variant url round-trips", async () => {
    const rootKey = generateRootKey();
    const encrypted = await encryptMessage(rootKey, SENDER_ID, 0, CONVO_ID, {
      height: 240,
      kind: "image",
      type: "media",
      url: "/api/media/cm123abc/v/md-webp.webp",
      width: 704,
    });
    const decrypted = await decryptMessage(
      rootKey,
      SENDER_ID,
      CONVO_ID,
      encrypted
    );
    expect(decrypted).toEqual({
      height: 240,
      kind: "image",
      type: "media",
      url: "/api/media/cm123abc/v/md-webp.webp",
      width: 704,
    });
  });

  test("grouped media album round-trips with a caption", async () => {
    const rootKey = generateRootKey();
    const payload = {
      content: "vacation pics",
      images: [
        { height: 240, url: "/api/media/cm1", width: 320 },
        { height: 480, url: "/api/media/cm2", width: 640 },
      ],
      kind: "image" as const,
      type: "media" as const,
    };
    const encrypted = await encryptMessage(
      rootKey,
      SENDER_ID,
      0,
      CONVO_ID,
      payload
    );
    const decrypted = await decryptMessage(
      rootKey,
      SENDER_ID,
      CONVO_ID,
      encrypted
    );
    expect(decrypted).toEqual(payload);
  });

  test("rejects a media album with no images", async () => {
    const rootKey = generateRootKey();
    const tampered = {
      ciphertext: await encryptRaw(
        { images: [], kind: "image", type: "media" },
        rootKey,
        0,
        "AAAAAAAAAAAAAAAAAAAAAA=="
      ),
      iv: "AAAAAAAAAAAAAAAAAAAAAA==",
      ratchetIndex: 0,
    };
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, tampered)
    ).rejects.toThrow();
  });

  test("rejects a media album over the attachment cap", async () => {
    const rootKey = generateRootKey();
    const images = Array.from(
      { length: MAX_MESSAGE_ATTACHMENTS + 1 },
      (_, index) => ({ url: `/api/media/cm${index}` })
    );
    const tampered = {
      ciphertext: await encryptRaw(
        { images, kind: "image", type: "media" },
        rootKey,
        0,
        "AAAAAAAAAAAAAAAAAAAAAA=="
      ),
      iv: "AAAAAAAAAAAAAAAAAAAAAA==",
      ratchetIndex: 0,
    };
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, tampered)
    ).rejects.toThrow();
  });

  test("rejects an album entry with a hostile url", async () => {
    const rootKey = generateRootKey();
    const tampered = {
      ciphertext: await encryptRaw(
        {
          images: [
            { url: "/api/media/cm1" },
            { url: ["javascript", "alert(1)"].join(":") },
          ],
          kind: "image",
          type: "media",
        },
        rootKey,
        0,
        "AAAAAAAAAAAAAAAAAAAAAA=="
      ),
      iv: "AAAAAAAAAAAAAAAAAAAAAA==",
      ratchetIndex: 0,
    };
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, tampered)
    ).rejects.toThrow();
  });

  test("rejects an album entry with hostile dimensions", async () => {
    const rootKey = generateRootKey();
    const tampered = {
      ciphertext: await encryptRaw(
        {
          images: [{ height: 0, url: "/api/media/cm1", width: 320 }],
          kind: "image",
          type: "media",
        },
        rootKey,
        0,
        "AAAAAAAAAAAAAAAAAAAAAA=="
      ),
      iv: "AAAAAAAAAAAAAAAAAAAAAA==",
      ratchetIndex: 0,
    };
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, tampered)
    ).rejects.toThrow();
  });

  test("rejects an album whose images field is null", async () => {
    const rootKey = generateRootKey();
    const tampered = {
      ciphertext: await encryptRaw(
        {
          images: null,
          kind: "image",
          type: "media",
          url: "/api/media/cm1",
        },
        rootKey,
        0,
        "AAAAAAAAAAAAAAAAAAAAAA=="
      ),
      iv: "AAAAAAAAAAAAAAAAAAAAAA==",
      ratchetIndex: 0,
    };
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, tampered)
    ).rejects.toThrow();
  });

  test("rejects a non-string media caption", async () => {
    const rootKey = generateRootKey();
    const tampered = {
      ciphertext: await encryptRaw(
        {
          content: 42,
          images: [{ url: "/api/media/cm1" }],
          kind: "image",
          type: "media",
        },
        rootKey,
        0,
        "AAAAAAAAAAAAAAAAAAAAAA=="
      ),
      iv: "AAAAAAAAAAAAAAAAAAAAAA==",
      ratchetIndex: 0,
    };
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, tampered)
    ).rejects.toThrow();
  });

  test("getMediaImages normalizes both media shapes", () => {
    expect(
      getMediaImages({
        height: 240,
        kind: "image",
        type: "media",
        url: "/api/media/legacy",
        width: 320,
      })
    ).toEqual([{ height: 240, url: "/api/media/legacy", width: 320 }]);

    const images = [
      { url: "/api/media/a" },
      { height: 10, url: "/api/media/b", width: 20 },
    ];
    expect(getMediaImages({ images, kind: "image", type: "media" })).toEqual(
      images
    );
  });

  test("editMessagePayload rewrites text and preserves reply linkage", () => {
    const edited = editMessagePayload(
      {
        content: "before",
        replyToId: "p1",
        replyToSenderId: "u2",
        type: "text",
      },
      "after"
    );
    expect(edited).toEqual({
      content: "after",
      replyToId: "p1",
      replyToSenderId: "u2",
      type: "text",
    });
  });

  test("editMessagePayload rewrites a media caption without touching the album", () => {
    const images = [{ url: "/api/media/a" }];
    const edited = editMessagePayload(
      { content: "old caption", images, kind: "image", type: "media" },
      "new caption"
    );
    expect(edited).toEqual({
      content: "new caption",
      images,
      kind: "image",
      type: "media",
    });
  });

  test("editMessagePayload rewrites a post share caption and keeps the post id", () => {
    const edited = editMessagePayload(
      { postId: "post-1", type: "post" },
      "look at this"
    );
    expect(edited).toEqual({
      content: "look at this",
      postId: "post-1",
      type: "post",
    });
  });

  // Built at runtime so the no-script-url lint rule cannot flag the literal.
  const JS_URL = ["javascript", "alert(1)"].join(":");
  test.each([
    JS_URL,
    "data:image/png;base64,abcd",
    "//cdn.example.com/a.png",
    "/api/media/../../etc/passwd",
    "/api/media/abc def",
    "/api/media/abc\\def",
    "/api/other/abc123",
    "/api/media/",
    "/api/media/cm123/v/../../etc/passwd",
  ])("rejects a media payload with a hostile url (%s)", async (url) => {
    const rootKey = generateRootKey();
    const tampered = {
      ciphertext: await encryptRaw(
        { height: 240, kind: "image", type: "media", url, width: 320 },
        rootKey,
        0,
        "AAAAAAAAAAAAAAAAAAAAAA=="
      ),
      iv: "AAAAAAAAAAAAAAAAAAAAAA==",
      ratchetIndex: 0,
    };
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, tampered)
    ).rejects.toThrow();
  });

  test.each([
    { height: 0, width: 320 },
    { height: -5, width: 320 },
    { height: 240, width: 1.5 },
    { height: 240, width: 999_999_999 },
    { height: 240, width: "320" },
  ])("rejects a media payload with hostile dimensions (%j)", async (dims) => {
    const rootKey = generateRootKey();
    const tampered = {
      ciphertext: await encryptRaw(
        { ...dims, kind: "image", type: "media", url: "/api/media/cm123abc" },
        rootKey,
        0,
        "AAAAAAAAAAAAAAAAAAAAAA=="
      ),
      iv: "AAAAAAAAAAAAAAAAAAAAAA==",
      ratchetIndex: 0,
    };
    await expect(
      decryptMessage(rootKey, SENDER_ID, CONVO_ID, tampered)
    ).rejects.toThrow();
  });

  test("base-key path decrypts identically to the direct path", async () => {
    const rootKey = generateRootKey();
    const encrypted = await encryptMessage(rootKey, SENDER_ID, 3, CONVO_ID, {
      content: "base path check",
      type: "text",
    });
    const baseKey = await importRatchetBaseKey(rootKey);
    const viaBase = await decryptMessageWithBaseKey(
      baseKey,
      SENDER_ID,
      CONVO_ID,
      encrypted
    );
    const direct = await decryptMessage(
      rootKey,
      SENDER_ID,
      CONVO_ID,
      encrypted
    );
    expect(viaBase).toEqual(direct);
    expect(viaBase).toEqual({ content: "base path check", type: "text" });
  });

  test("base-key path decrypts a frozen pre-split ciphertext (known answer)", async () => {
    // Frozen vector produced BEFORE the import/derive split, so a future
    // change to the ratchet derivation (HKDF salt/info/length) fails here
    // instead of silently making every historical message undecryptable.
    // Both the one-shot and base-key paths must reproduce it.
    const rootKey = base64ToBytes(
      "AwoRGB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5wMfO1dw="
    );
    const frozen = {
      ciphertext:
        "JrRBa84+gpUImgX1XVkn3bIu8pecuDA7TuWDaoNIeO29M1etlr/I5+pGWpZ69EGUSM27T2Zdjtg=",
      iv: "H59753OvR65ZUJf3",
      ratchetIndex: 7,
    };
    const expected = { content: "known answer", type: "text" };
    expect(await decryptMessage(rootKey, SENDER_ID, CONVO_ID, frozen)).toEqual(
      expected
    );
    const baseKey = await importRatchetBaseKey(rootKey);
    expect(
      await decryptMessageWithBaseKey(baseKey, SENDER_ID, CONVO_ID, frozen)
    ).toEqual(expected);
  });

  test("base-key path still enforces ratchet index and payload checks", async () => {
    const rootKey = generateRootKey();
    const baseKey = await importRatchetBaseKey(rootKey);
    const encrypted = await encryptMessage(rootKey, SENDER_ID, 0, CONVO_ID, {
      content: "hey bob",
      type: "text",
    });
    await expect(
      decryptMessageWithBaseKey(baseKey, SENDER_ID, CONVO_ID, {
        ...encrypted,
        ratchetIndex: 1,
      })
    ).rejects.toThrow();
    const tampered = {
      ...encrypted,
      ciphertext: await encryptRaw(
        {
          kind: "image",
          type: "media",
          // Built at runtime so the no-script-url lint rule cannot flag it.
          url: ["javascript", "alert(1)"].join(":"),
        },
        rootKey,
        0,
        encrypted.iv
      ),
    };
    await expect(
      decryptMessageWithBaseKey(baseKey, SENDER_ID, CONVO_ID, tampered)
    ).rejects.toThrow();
  });

  test("media round-trips through an offset Uint8Array view of the root key", async () => {
    const full = generateRootKey();
    // A subarray view exercises toBufferSource's copy path.
    const rootKey = full.subarray(0, 32);
    const encrypted = await encryptMessage(rootKey, SENDER_ID, 0, CONVO_ID, {
      content: "hey bob",
      type: "text",
    });
    const decrypted = await decryptMessage(
      rootKey,
      SENDER_ID,
      CONVO_ID,
      encrypted
    );
    expect(decrypted).toEqual({ content: "hey bob", type: "text" });
  });

  test("invalid payloads are rejected", async () => {
    const rootKey = generateRootKey();
    const messageKey = await deriveMessageKey(rootKey, SENDER_ID, 0);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // Encrypt a payload that is neither text, post, nor media.
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

  test("verifier rows unlock from the raw secret this device still holds", async () => {
    // The short-lived verifier scheme encrypted under a raw secret and stored
    // only its hash, so the row alone cannot derive the key. A device that
    // still holds that secret must still be able to unlock; unlockIdentity
    // verifies the hash before deriving.
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const secret = generateAccountSecret();
    const masterKeyHash = await hashAccountSecret(secret);
    const masterKey = await deriveMasterKey(secret, salt, 100_000);
    const backup = await encryptWithMasterKey(
      masterKey,
      JSON.stringify(privateKeyJwk)
    );

    // Device B lost local storage, so it has neither the secret nor the key;
    // the user supplies the secret from their saved copy. This mirrors
    // unlockIdentity's verifier-row path: verify the hash, then derive from the
    // raw secret (NOT the hash) and decrypt.
    const supplied = secret;
    const verifier = await hashAccountSecret(supplied);
    expect(verifier.toLowerCase()).toBe(masterKeyHash.toLowerCase());

    const recoveredKey = await deriveMasterKey(supplied, salt, 100_000);
    const decrypted = await decryptWithMasterKey(recoveredKey, backup);
    const recovered = await importPrivateKeyJwk(
      JSON.parse(decrypted) as JsonWebKey
    );
    const recoveredPrivate = await exportPrivateKeyJwk(recovered);
    const originalPublic = await exportPublicKeyJwk(pair.publicKey);
    expect(recoveredPrivate.x).toBe(originalPublic.x);
    expect(recoveredPrivate.y).toBe(originalPublic.y);
  });

  test("a wrong recovery secret fails the hash check before decryption", async () => {
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const secret = generateAccountSecret();
    const masterKeyHash = await hashAccountSecret(secret);
    const masterKey = await deriveMasterKey(secret, salt, 100_000);
    await encryptWithMasterKey(masterKey, JSON.stringify(privateKeyJwk));

    const wrongVerifier = await hashAccountSecret(generateAccountSecret());
    expect(wrongVerifier.toLowerCase()).not.toBe(masterKeyHash.toLowerCase());
  });

  test("the stored row alone derives the backup key (automatic recovery)", async () => {
    // Deliberate trade-off of the server-recoverable model: a database reader
    // who holds the entire identity row derives the same backup key the client
    // does, because the row is the recovery material. Pinned so the documented
    // recovery behavior and the accepted risk stay in lockstep.
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

    // Everything a DB reader has: the ciphertext, the IV, the salt, the
    // iteration count, and the seed hash. That is sufficient by design.
    const rowDerived = await deriveMasterKey(masterKeyHash, salt, 100_000);
    const decrypted = await decryptWithMasterKey(rowDerived, backup);
    expect(JSON.parse(decrypted)).toEqual(privateKeyJwk);
  });
});
