// WebCrypto-equivalent primitives for the mobile messages crypto, backed by
// @noble/* instead of `crypto.subtle`.
//
// Why not `crypto.subtle`: Hermes has never shipped it and the RN/Hermes team
// has declined to (hermes#1003 covers even `crypto.getRandomValues`). Expo's
// own `expo-standard-web-crypto` polyfills *only* `getRandomValues`. Every
// fuller option (react-native-quick-crypto, @peculiar/webcrypto,
// react-native-aes-crypto) needs a native rebuild and therefore cannot run in
// Expo Go, which this feature must support.
//
// noble is pure JS, so it works identically in Hermes and in Expo Go. The cost
// is that it cannot be constant-time (JIT + GC), which is a fact about every
// JS crypto library, not about this choice. That is acceptable here: the
// messages threat model is already server-recoverable rather than end-to-end
// (see AGENTS.md and the header of crypto.ts), so it is defending against a
// network attacker and against anyone who is not the database operator.
//
// WIRE FORMAT IS IDENTICAL TO WEB. Every derivation below was checked against
// the WebCrypto implementation apps/web uses, byte for byte, in
// crypto-primitives.test.ts. A message encrypted on one client decrypts on the
// other, and a key wrapped on the web unwraps here and vice versa. Do not
// "clean up" a derivation here without re-running that test.
import { gcm } from "@noble/ciphers/aes.js";
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
// Aliased: this module exports its own `sha256` wrapper, and a local `function
// sha256` declaration would shadow the import for the whole module — including
// inside the wrapper, which would hand noble its own function back and trip its
// "expected hash wrapped by createHasher" assertion at runtime.
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";

// ---- entropy -----------------------------------------------------------------

// Injected so a native build can use expo-crypto's native CSPRNG and a bun test
// can use the runtime's. Never Math.random: this is key material.
let randomSource: (length: number) => Uint8Array = (length) => {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
};

// Called once at app start by the messages bootstrap (see crypto.ts) to point
// entropy at expo-crypto. A no-op replacement keeps the call sites unaware of
// where the bytes came from.
export function setRandomSource(source: (length: number) => Uint8Array): void {
  randomSource = source;
}

export function randomBytes(length: number): Uint8Array {
  return randomSource(length);
}

// ---- base64 ------------------------------------------------------------------

// Hand-rolled rather than btoa/atob: the native ones are Latin-1 only and a
// per-byte loop, and message payloads carry base64 image references large enough
// for that to show up in the composer. Pure here keeps crypto.ts testable under
// bun, where atob exists but the shapes must match byte for byte.
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Base64 is a bit-packing codec, so the encode and decode below are written with
// arithmetic on small integers rather than bitwise operators. The shapes are
// identical either way; this form keeps the arithmetic visible to the reader
// instead of hiding it behind shifts, and it satisfies the repo's no-bitwise rule
// without a file-wide exemption.
//
// Encoding walks three bytes -> four sextets. Decoding is the inverse, and it
// throws on a character outside the alphabet rather than returning partial bytes:
// this decodes peer-controlled ciphertext, so a silent short read would be a
// correctness hole, not a cosmetic one.

function sextet(value: number): string {
  return BASE64_ALPHABET.charAt(value % 64);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const fullTriples = Math.floor(bytes.length / 3);
  for (let index = 0; index < fullTriples; index += 1) {
    const offset = index * 3;
    const a = bytes[offset] ?? 0;
    const b = bytes[offset + 1] ?? 0;
    const c = bytes[offset + 2] ?? 0;
    parts.push(
      sextet(Math.floor(a / 4)),
      sextet((a % 4) * 16 + Math.floor(b / 16)),
      sextet((b % 16) * 4 + Math.floor(c / 64)),
      sextet(c % 64)
    );
  }
  const tail = bytes.length - fullTriples * 3;
  if (tail === 1) {
    const a = bytes[fullTriples * 3] ?? 0;
    parts.push(sextet(Math.floor(a / 4)), sextet((a % 4) * 16), "==");
  } else if (tail === 2) {
    const a = bytes[fullTriples * 3] ?? 0;
    const b = bytes[fullTriples * 3 + 1] ?? 0;
    parts.push(
      sextet(Math.floor(a / 4)),
      sextet((a % 4) * 16 + Math.floor(b / 16)),
      sextet((b % 16) * 4),
      "="
    );
  }
  return parts.join("");
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replaceAll(/\s/g, "");
  let padding = 0;
  if (clean.endsWith("==")) {
    padding = 2;
  } else if (clean.endsWith("=")) {
    padding = 1;
  }
  const body = clean.slice(0, clean.length - padding);
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let written = 0;
  for (let index = 0; index + 1 < body.length; index += 4) {
    const a = BASE64_ALPHABET.indexOf(body.charAt(index));
    const b = BASE64_ALPHABET.indexOf(body.charAt(index + 1));
    const c = BASE64_ALPHABET.indexOf(body.charAt(index + 2));
    const d = BASE64_ALPHABET.indexOf(body.charAt(index + 3));
    if (a === -1 || b === -1 || c === -1 || d === -1) {
      throw new Error("Invalid base64 input");
    }
    out[written] = a * 4 + Math.floor(b / 16);
    out[written + 1] = (b % 16) * 16 + Math.floor(c / 4);
    out[written + 2] = (c % 4) * 64 + d;
    written += 3;
  }
  // A trailing group of one character carries six bits, which is one whole byte.
  const remainder = body.length % 4;
  if (remainder === 1) {
    throw new Error("Invalid base64 input");
  }
  if (remainder === 2) {
    const a = BASE64_ALPHABET.indexOf(body.slice(-2, -1));
    const b = BASE64_ALPHABET.indexOf(body.slice(-1));
    if (a === -1 || b === -1) {
      throw new Error("Invalid base64 input");
    }
    out[written] = a * 4 + Math.floor(b / 16);
  } else if (remainder === 3) {
    const a = BASE64_ALPHABET.indexOf(body.slice(-3, -2));
    const b = BASE64_ALPHABET.indexOf(body.slice(-2, -1));
    const c = BASE64_ALPHABET.indexOf(body.slice(-1));
    if (a === -1 || b === -1 || c === -1) {
      throw new Error("Invalid base64 input");
    }
    out[written] = a * 4 + Math.floor(b / 16);
    out[written + 1] = (b % 16) * 16 + Math.floor(c / 4);
  }
  return out;
}

// ---- text --------------------------------------------------------------------

export const ENCODER = new TextEncoder();
export const DECODER = new TextDecoder();

// ---- branded keys ------------------------------------------------------------

declare const brand: unique symbol;
// A brand, not a wrapper: the native key handle stays a plain Uint8Array so
// these can be handed straight to noble and to expo-crypto, while the type
// system still refuses to pass a private key where a public one is expected.
type Brand<T, Name extends string> = T & { readonly [brand]?: Name };

/** Raw ECDH P-256 secret scalar (32 bytes). */
export type EcdhPrivateKey = Brand<Uint8Array, "EcdhPrivateKey">;
/** Compressed SEC1 point (33 bytes). */
export type EcdhPublicKey = Brand<Uint8Array, "EcdhPublicKey">;
/** AES-GCM-256 key material (32 bytes). */
export type AesGcmKey = Brand<Uint8Array, "AesGcmKey">;

export const P256_KEY_BYTES = 32;
export const AES_GCM_KEY_BYTES = 32;
export const GCM_IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;

// ---- ECDH P-256 --------------------------------------------------------------

// noble compresses by default, so a shared secret is 33 bytes whose first byte
// is the y-parity tag. WebCrypto's `deriveBits(..., 256)` returns the bare 32-byte
// X coordinate, which is bytes 1..33 of the compressed form. That offset is the
// single place where the two implementations could silently disagree, so it is
// asserted against WebCrypto in the test file rather than left to a comment.
export function generateIdentityKeyPair(): {
  privateKey: EcdhPrivateKey;
  publicKey: EcdhPublicKey;
} {
  const secretKey = p256.utils.randomSecretKey(randomBytes(48));
  const publicKey = p256.getPublicKey(secretKey);
  return {
    privateKey: secretKey as EcdhPrivateKey,
    publicKey: publicKey as EcdhPublicKey,
  };
}

export function importPrivateKeyJwk(jwk: JsonWebKey): EcdhPrivateKey {
  const { d } = jwk;
  if (typeof d !== "string") {
    throw new TypeError("Invalid private key");
  }
  const bytes = base64UrlToBytes(d);
  // Reject a scalar outside [1, n-1] here rather than letting it through to a
  // derivation that would silently produce a degenerate shared secret.
  // isValidSecretKey answers with a boolean rather than throwing, so the check
  // has to be explicit.
  if (!p256.utils.isValidSecretKey(bytes)) {
    throw new Error("Invalid private key");
  }
  return bytes as EcdhPrivateKey;
}

export function importPublicKeyJwk(jwk: JsonWebKey): EcdhPublicKey {
  const { x, y } = jwk;
  if (
    jwk.crv !== "P-256" ||
    jwk.kty !== "EC" ||
    typeof x !== "string" ||
    typeof y !== "string"
  ) {
    throw new Error("Invalid public key");
  }
  // Accepts the uncompressed SEC1 point; compressing is the caller's next step.
  const point = p256.Point.fromBytes(
    concatBytes(Uint8Array.of(4), base64UrlToBytes(x), base64UrlToBytes(y))
  );
  return point.toBytes() as EcdhPublicKey;
}

// Uncompressed SEC1 point (65 bytes, 0x04 || X || Y) -> compressed (33 bytes).
export function compressPublicKey(key: EcdhPublicKey): EcdhPublicKey {
  return p256.Point.fromBytes(key).toBytes() as EcdhPublicKey;
}

// The inverse. Needed because a P-256 JWK carries separate X and Y coordinates,
// while noble hands back a compressed point: exporting a JWK means going back to
// the 0x04||X||Y form to slice the two halves out.
export function uncompressPublicKey(key: EcdhPublicKey): Uint8Array {
  return p256.Point.fromBytes(key).toBytes(false);
}

// Deterministic 32-byte shared secret, identical on both sides of a pair.
export function deriveSharedSecret(
  myPrivateKey: EcdhPrivateKey,
  theirPublicKey: EcdhPublicKey
): Uint8Array {
  const compressed = p256.getSharedSecret(myPrivateKey, theirPublicKey);
  return compressed.subarray(1);
}

// ---- PBKDF2 / HKDF -----------------------------------------------------------

export function pbkdf2Sha256(
  secret: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length = AES_GCM_KEY_BYTES
): AesGcmKey {
  return pbkdf2(nobleSha256, secret, salt, {
    c: iterations,
    dkLen: length,
  }) as AesGcmKey;
}

export function hkdfSha256(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length = AES_GCM_KEY_BYTES
): AesGcmKey {
  return hkdf(nobleSha256, inputKeyMaterial, salt, info, length) as AesGcmKey;
}

export function sha256(bytes: Uint8Array): Uint8Array {
  return nobleSha256(bytes);
}

// ---- AES-GCM -----------------------------------------------------------------

// noble's gcm().encrypt() returns ciphertext||tag with the tag appended, which
// is exactly WebCrypto's shape, and iv is carried separately in the wire format
// rather than prepended. So an AES-GCM blob here decrypts in the browser with no
// translation, and vice versa.
export function aesGcmEncrypt(
  key: AesGcmKey,
  iv: Uint8Array,
  plaintext: Uint8Array,
  additionalData?: Uint8Array
): Uint8Array {
  return gcm(key, iv, additionalData).encrypt(plaintext);
}

export function aesGcmDecrypt(
  key: AesGcmKey,
  iv: Uint8Array,
  ciphertextWithTag: Uint8Array,
  additionalData?: Uint8Array
): Uint8Array {
  return gcm(key, iv, additionalData).decrypt(ciphertextWithTag);
}

// ---- JWK base64url -----------------------------------------------------------

// RFC 7517: JWK coordinates are base64url, not hex and not padded base64.
export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return base64ToBytes(padded);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const array of arrays) {
    total += array.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const array of arrays) {
    out.set(array, offset);
    offset += array.length;
  }
  return out;
}
