// Proves the noble-based native primitives are byte-identical to the WebCrypto
// implementation apps/web uses, so a message encrypted on one client decrypts on
// the other and a root key wrapped on the web unwraps here.
//
// bun has a full WebCrypto implementation, so this file can hold BOTH sides of
// every comparison: the WebCrypto result is not a pasted fixture that can go
// stale, it is recomputed on every run. If someone changes a derivation in
// crypto-primitives.ts, this fails.
import { describe, expect, test } from "bun:test";

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64UrlToBytes,
  bytesToBase64Url,
  concatBytes,
  deriveSharedSecret,
  GCM_IV_BYTES,
  hkdfSha256,
  importPrivateKeyJwk,
  importPublicKeyJwk,
  pbkdf2Sha256,
  pbkdf2Sha256Async,
  sha256,
} from "./crypto-primitives";

const { subtle } = globalThis.crypto;
const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// WebCrypto's BufferSource wants an ArrayBuffer-backed view. The branded key
// types are plain `Uint8Array<ArrayBufferLike>`, so anything handed to subtle
// goes through this copy first.
function source(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

async function generateWebKeyPair(): Promise<CryptoKeyPair> {
  return (await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  )) as CryptoKeyPair;
}

describe("P-256 identity keys", () => {
  test("reproduces the public key from the same private key", async () => {
    const webPair = await generateWebKeyPair();
    const webPublicJwk = await subtle.exportKey("jwk", webPair.publicKey);

    const privateKey = importPrivateKeyJwk(
      await subtle.exportKey("jwk", webPair.privateKey)
    );
    const nativePublic = importPublicKeyJwk(webPublicJwk);
    const { p256 } = await import("@noble/curves/nist.js");
    const uncompressed = p256.Point.fromBytes(nativePublic).toBytes(false);

    // JWK coordinates are base64url per RFC 7517, so decode before comparing.
    expect(toHex(uncompressed.subarray(1, 33))).toBe(
      toHex(base64UrlToBytes(webPublicJwk.x as string))
    );
    expect(toHex(uncompressed.subarray(33, 65))).toBe(
      toHex(base64UrlToBytes(webPublicJwk.y as string))
    );
    expect(privateKey.length).toBe(32);
  });

  test("derives the same shared secret in both directions", async () => {
    const aliceWeb = await generateWebKeyPair();
    const bobWeb = await generateWebKeyPair();
    const alicePublicJwk = await subtle.exportKey("jwk", aliceWeb.publicKey);
    const bobPublicJwk = await subtle.exportKey("jwk", bobWeb.publicKey);

    const webSecret = new Uint8Array(
      await subtle.deriveBits(
        { name: "ECDH", public: bobWeb.publicKey },
        aliceWeb.privateKey,
        256
      )
    );

    const alicePrivate = importPrivateKeyJwk(
      await subtle.exportKey("jwk", aliceWeb.privateKey)
    );
    const bobPrivate = importPrivateKeyJwk(
      await subtle.exportKey("jwk", bobWeb.privateKey)
    );

    const aliceToBob = deriveSharedSecret(
      alicePrivate,
      importPublicKeyJwk(bobPublicJwk)
    );
    const bobToAlice = deriveSharedSecret(
      bobPrivate,
      importPublicKeyJwk(alicePublicJwk)
    );

    expect(toHex(aliceToBob)).toBe(toHex(webSecret));
    // Both directions must agree, or wrapping would work one way only.
    expect(toHex(aliceToBob)).toBe(toHex(bobToAlice));
    expect(webSecret.length).toBe(32);
  });

  test("rejects a private key that is out of range", () => {
    // d = 1 byte, far outside the 32-byte scalar the curve requires.
    expect(() =>
      importPrivateKeyJwk({ crv: "P-256", d: "AQ", kty: "EC" })
    ).toThrow();
  });

  test("rejects a private key equal to zero", () => {
    expect(() =>
      importPrivateKeyJwk({
        crv: "P-256",
        d: bytesToBase64Url(new Uint8Array(32)),
        kty: "EC",
      })
    ).toThrow();
  });

  test("rejects a public key that is not on the curve", () => {
    expect(() =>
      importPublicKeyJwk({
        crv: "P-256",
        kty: "EC",
        x: bytesToBase64Url(new Uint8Array(32).fill(1)),
        y: bytesToBase64Url(new Uint8Array(32).fill(2)),
      })
    ).toThrow();
  });
});

describe("PBKDF2-SHA256", () => {
  test("matches WebCrypto's derived AES-GCM key material", async () => {
    const secret = encoder.encode("a-test-secret-value");
    const salt = new Uint8Array(16).fill(7);
    const iterations = 1000;

    const baseKey = await subtle.importKey(
      "raw",
      source(secret),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const webKey = await subtle.deriveKey(
      { hash: "SHA-256", iterations, name: "PBKDF2", salt },
      baseKey,
      { length: 256, name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );
    const webRaw = new Uint8Array(await subtle.exportKey("raw", webKey));

    const native = pbkdf2Sha256(secret, salt, iterations);
    expect(toHex(native)).toBe(toHex(webRaw));
  });
});

describe("AES-GCM", () => {
  test("produces WebCrypto's ciphertext||tag layout", async () => {
    const key = pbkdf2Sha256(
      encoder.encode("secret"),
      new Uint8Array(16).fill(1),
      1000
    );
    const iv = new Uint8Array(GCM_IV_BYTES).fill(3);
    const plaintext = encoder.encode('{"hello":"world"}');

    const nativeCt = aesGcmEncrypt(key, iv, plaintext);

    const webKey = await subtle.importKey(
      "raw",
      source(key),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"]
    );
    const webCt = new Uint8Array(
      await subtle.encrypt({ iv, name: "AES-GCM" }, webKey, source(plaintext))
    );

    expect(toHex(nativeCt)).toBe(toHex(webCt));
    // 16 bytes of plaintext + the 16-byte GCM tag.
    expect(nativeCt.length).toBe(plaintext.length + 16);
  });

  test("WebCrypto ciphertext decrypts natively", async () => {
    const key = pbkdf2Sha256(
      encoder.encode("secret"),
      new Uint8Array(16).fill(1),
      1000
    );
    const iv = new Uint8Array(GCM_IV_BYTES).fill(3);
    const plaintext = encoder.encode("from the browser");
    const additionalData = encoder.encode("conv-1:user-2:7");

    const webKey = await subtle.importKey(
      "raw",
      source(key),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"]
    );
    const webCt = new Uint8Array(
      await subtle.encrypt(
        { additionalData, iv, name: "AES-GCM" },
        webKey,
        source(plaintext)
      )
    );

    expect(toHex(aesGcmDecrypt(key, iv, webCt, additionalData))).toBe(
      toHex(plaintext)
    );
  });

  test("native ciphertext decrypts in WebCrypto", async () => {
    const key = pbkdf2Sha256(
      encoder.encode("secret"),
      new Uint8Array(16).fill(1),
      1000
    );
    const iv = new Uint8Array(GCM_IV_BYTES).fill(11);
    const plaintext = encoder.encode("from the phone");
    const additionalData = encoder.encode("conv-1:user-2:9");

    const nativeCt = aesGcmEncrypt(key, iv, plaintext, additionalData);

    const webKey = await subtle.importKey(
      "raw",
      source(key),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"]
    );
    const webPt = new Uint8Array(
      await subtle.decrypt(
        { additionalData, iv, name: "AES-GCM" },
        webKey,
        source(nativeCt)
      )
    );

    expect(toHex(webPt)).toBe(toHex(plaintext));
  });

  test("rejects a tampered ciphertext", () => {
    const key = pbkdf2Sha256(
      encoder.encode("secret"),
      new Uint8Array(16).fill(1),
      1000
    );
    const iv = new Uint8Array(GCM_IV_BYTES).fill(3);
    const ct = aesGcmEncrypt(key, iv, encoder.encode("hello"));
    // Any change to the ciphertext fails the GCM tag; it does not have to be a
    // specific bit flip.
    const tampered = new Uint8Array(ct);
    tampered[0] = ((tampered[0] ?? 0) + 1) % 256;
    expect(() => aesGcmDecrypt(key, iv, tampered)).toThrow();
  });
});

describe("HKDF-SHA256", () => {
  test("matches WebCrypto's conversation wrap key", async () => {
    const sharedSecret = new Uint8Array(32).fill(4);
    const conversationId = "conv-abc";

    const hkdfKey = await subtle.importKey(
      "raw",
      source(sharedSecret),
      "HKDF",
      false,
      ["deriveKey"]
    );
    const webWrapKey = await subtle.deriveKey(
      {
        hash: "SHA-256",
        info: encoder.encode(`asm:wrap:${conversationId}`),
        name: "HKDF",
        salt: new Uint8Array(32),
      },
      hkdfKey,
      { length: 256, name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );
    const webRaw = new Uint8Array(await subtle.exportKey("raw", webWrapKey));

    const native = hkdfSha256(
      sharedSecret,
      new Uint8Array(32),
      encoder.encode(`asm:wrap:${conversationId}`)
    );
    expect(toHex(native)).toBe(toHex(webRaw));
  });

  test("matches WebCrypto's ratchet message key", async () => {
    const rootKey = new Uint8Array(32).fill(9);
    const senderId = "user-2";
    const index = 7;

    const ratchetKey = await subtle.importKey(
      "raw",
      source(rootKey),
      "HKDF",
      false,
      ["deriveKey"]
    );
    const webMsgKey = await subtle.deriveKey(
      {
        hash: "SHA-256",
        info: encoder.encode("asm:msg:v1"),
        name: "HKDF",
        salt: encoder.encode(`asm:ratchet:${senderId}:${index}`),
      },
      ratchetKey,
      { length: 256, name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );
    const webRaw = new Uint8Array(await subtle.exportKey("raw", webMsgKey));

    const native = hkdfSha256(
      rootKey,
      encoder.encode(`asm:ratchet:${senderId}:${index}`),
      encoder.encode("asm:msg:v1")
    );
    expect(toHex(native)).toBe(toHex(webRaw));
  });
});

describe("SHA-256", () => {
  test("matches WebCrypto's digest", async () => {
    const input = encoder.encode("abc:def:ghi");
    const webDigest = new Uint8Array(await subtle.digest("SHA-256", input));
    expect(toHex(sha256(input))).toBe(toHex(webDigest));
  });
});

describe("base64", () => {
  test("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 42]);
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
  });

  test("matches Node's base64", () => {
    for (const length of [0, 1, 2, 3, 4, 5, 17, 255, 1024]) {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      expect(
        bytesToBase64Url(bytes).replaceAll("-", "+").replaceAll("_", "/")
      ).toBe(Buffer.from(bytes).toString("base64").replace(/=+$/, ""));
    }
  });

  test("decodes standard base64 with padding", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(base64UrlToBytes(Buffer.from(bytes).toString("base64"))).toEqual(
      bytes
    );
  });

  test("throws on malformed input rather than returning partial bytes", () => {
    expect(() => base64UrlToBytes("!!!!")).toThrow();
  });
});

describe("concatBytes", () => {
  test("joins in order", () => {
    expect(
      concatBytes(Uint8Array.of(1, 2), Uint8Array.of(3), Uint8Array.of(4, 5))
    ).toEqual(Uint8Array.of(1, 2, 3, 4, 5));
  });
});

describe("responsive identity recovery", () => {
  test("100k-round recovery yields to timers and remains WebCrypto compatible", async () => {
    const secret = encoder.encode("stored-row-hash-🔑");
    const salt = new Uint8Array(16).fill(7);
    let completed = false;
    let heartbeatDuringRecovery = false;
    const timer = setTimeout(() => {
      heartbeatDuringRecovery = !completed;
    }, 0);
    const native = await pbkdf2Sha256Async(secret, salt, 100_000);
    completed = true;
    clearTimeout(timer);
    expect(heartbeatDuringRecovery).toBe(true);
    const material = await subtle.importKey(
      "raw",
      source(secret),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const expected = await subtle.deriveBits(
      {
        hash: "SHA-256",
        iterations: 100_000,
        name: "PBKDF2",
        salt: source(salt),
      },
      material,
      256
    );
    expect(toHex(native)).toBe(toHex(new Uint8Array(expected)));
  });
});
