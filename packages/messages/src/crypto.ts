// Client-side encryption primitives for Messages. Everything here runs in the
// browser (and in bun unit tests).
//
// Trust model (server-recoverable, "Telegram-cloud" semantics — NOT E2EE):
// each user owns an ECDH P-256 identity keypair. The public half is stored in
// plaintext on the server so anyone can derive a shared secret to wrap
// conversation keys for that user. The private half is backed up on the server
// encrypted under a master key derived (PBKDF2) from a random per-identity
// value whose SHA-256 hash is stored in the SAME row. Deriving the backup key
// from that stored row is exactly what automatic recovery does, so anyone who
// can read the database can decrypt the backup and every message wrapped under
// it. That is an accepted trade-off: messages are encrypted in transit and at
// rest and access is gated by session + membership, which protects against
// everyone who is not the database operator. See AGENTS.md for the threat
// model before changing anything here.
//
// A second, short-lived scheme ("verifier rows") derived the master key from a
// raw random secret held only on the user's device and stored just its hash.
// Those rows cannot be auto-recovered; unlock still accepts them when this
// device still holds the raw secret, and they are otherwise abandoned by the
// reset path.
//
// Per-conversation, a fresh random 256-bit root key is wrapped for each
// participant via ECDH(myPrivate, theirPublic) + HKDF + AES-GCM. Message
// keys are ratcheted forward from the root: the i-th message from sender S
// uses HKDF(root, "asm:ratchet:" + S + ":" + i), giving backward secrecy if a
// root key is ever compromised.

import { parseMessagePayload } from "./payload";
import type { MediaImageRef, MessagePayload } from "./payload";

export type { MediaImageRef, MessagePayload } from "./payload";

export const KDF_ITERATIONS = 100_000;
export const FINGERPRINT_GROUP_COUNT = 4;
export const ACCOUNT_SECRET_LENGTH = 64;

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  return bytes;
}

// WebCrypto's BufferSource requires an ArrayBuffer-backed view; copies the
// input into one when it is not already (e.g. a slice of another buffer).
function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes as Uint8Array<ArrayBuffer>;
  }
  return new Uint8Array(bytes);
}

// ---- identity keypair ------------------------------------------------------

export function generateIdentityKeyPair(): Promise<CryptoKeyPair> {
  return globalThis.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
}

export function exportPublicKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return globalThis.crypto.subtle.exportKey("jwk", key);
}

export function exportPrivateKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return globalThis.crypto.subtle.exportKey("jwk", key);
}

export function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
}

export function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
}

export function publicKeyJwkToBase64(jwk: JsonWebKey): string {
  // A P-256 public JWK is fully described by (crv, kty, x, y); store those so
  // the server row stays small and self-contained.
  const compact = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  return bytesToBase64(ENC.encode(JSON.stringify(compact)));
}

export function publicKeyBase64ToJwk(encoded: string): JsonWebKey {
  const parsed = JSON.parse(
    DEC.decode(base64ToBytes(encoded))
  ) as Partial<JsonWebKey>;
  if (
    parsed.crv !== "P-256" ||
    parsed.kty !== "EC" ||
    typeof parsed.x !== "string" ||
    typeof parsed.y !== "string"
  ) {
    throw new Error("Invalid public key");
  }
  return { crv: parsed.crv, kty: parsed.kty, x: parsed.x, y: parsed.y };
}

// ---- master key (identity backup) -------------------------------------------

export async function deriveMasterKey(
  secret: string,
  salt: Uint8Array,
  iterations = KDF_ITERATIONS
): Promise<CryptoKey> {
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    ENC.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return globalThis.crypto.subtle.deriveKey(
    { hash: "SHA-256", iterations, name: "PBKDF2", salt: toBufferSource(salt) },
    baseKey,
    { length: 256, name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

export interface EncryptedBlob {
  ciphertext: string;
  iv: string;
}

export async function encryptWithMasterKey(
  masterKey: CryptoKey,
  plaintext: string
): Promise<EncryptedBlob> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    masterKey,
    ENC.encode(plaintext)
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptWithMasterKey(
  masterKey: CryptoKey,
  blob: EncryptedBlob
): Promise<string> {
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { iv: base64ToBytes(blob.iv), name: "AES-GCM" },
    masterKey,
    base64ToBytes(blob.ciphertext)
  );
  return DEC.decode(plaintext);
}

// ---- shared secret + conversation key wrapping ------------------------------

// Deterministic 32-byte shared secret from an ECDH pair. Both parties compute
// the same value from (myPriv, theirPub).
export async function deriveSharedSecret(
  myPrivateKey: CryptoKey,
  theirPublicKey: CryptoKey
): Promise<Uint8Array<ArrayBuffer>> {
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: "ECDH", public: theirPublicKey },
    myPrivateKey,
    256
  );
  return new Uint8Array(bits);
}

// HKDF-derived AES-GCM wrap key from the shared secret, bound to the
// conversation id so one shared secret can never wrap keys for another convo.
export async function deriveWrapKey(
  sharedSecret: Uint8Array,
  conversationId: string
): Promise<CryptoKey> {
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    toBufferSource(sharedSecret),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: ENC.encode(`asm:wrap:${conversationId}`),
      name: "HKDF",
      salt: new Uint8Array(new ArrayBuffer(32)),
    },
    baseKey,
    { length: 256, name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function wrapRootKey(
  myPrivateKey: CryptoKey,
  theirPublicKey: CryptoKey,
  conversationId: string,
  rootKey: Uint8Array
): Promise<EncryptedBlob> {
  const sharedSecret = await deriveSharedSecret(myPrivateKey, theirPublicKey);
  const wrapKey = await deriveWrapKey(sharedSecret, conversationId);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    wrapKey,
    toBufferSource(rootKey)
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
}

export async function unwrapRootKey(
  myPrivateKey: CryptoKey,
  theirPublicKey: CryptoKey,
  conversationId: string,
  blob: EncryptedBlob
): Promise<Uint8Array> {
  const sharedSecret = await deriveSharedSecret(myPrivateKey, theirPublicKey);
  const wrapKey = await deriveWrapKey(sharedSecret, conversationId);
  const rootKey = await globalThis.crypto.subtle.decrypt(
    { iv: base64ToBytes(blob.iv), name: "AES-GCM" },
    wrapKey,
    base64ToBytes(blob.ciphertext)
  );
  return new Uint8Array(rootKey);
}

export function generateRootKey(): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(32);
  const bytes = new Uint8Array(buffer);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

// ---- multi-member wrap fan-out ------------------------------------------------

// A member a root key can be wrapped for: their identity public key, and the id
// the resulting wrap row is filed under.
export interface WrapRecipient {
  publicKeyBase64: string;
  userId: string;
}

// One member's independent wrap of a shared root key.
export interface MemberWrap {
  encryptedKey: EncryptedBlob;
  userId: string;
}

export interface RootKeyFanOut {
  // Members whose wrap was made, in the order the recipients were given.
  wrapped: MemberWrap[];
  // Members left out because they have no usable identity public key.
  skipped: string[];
}

// Wraps ONE root key separately for every recipient, each with its own
// ECDH(myPrivate, theirPublic) pairing. That is what makes a den work: every
// member gets a wrap only they can unwrap, while all of them resolve to the
// same root key, so the members never hold per-member message keys.
//
// A recipient whose public key is absent or malformed is SKIPPED and named in
// `skipped` rather than thrown on, because one member who has not enabled
// messages must not cost the other ninety-nine their epoch. Deciding what a skip
// means for the mutation belongs to the caller (see ensureConversationKeys);
// what the caller must never do is mistake a partial fan-out for a complete one.
//
// The pairings are independent, so they run together: a 100-member den is one
// round of WebCrypto rather than a hundred serialized ones.
export async function wrapRootKeyForMembers(
  myPrivateKey: CryptoKey,
  recipients: readonly WrapRecipient[],
  conversationId: string,
  rootKey: Uint8Array
): Promise<RootKeyFanOut> {
  const results = await Promise.all(
    recipients.map(async (recipient) => ({
      encryptedKey: await wrapForRecipient(
        myPrivateKey,
        recipient,
        conversationId,
        rootKey
      ),
      recipient,
    }))
  );
  const wrapped: MemberWrap[] = [];
  const skipped: string[] = [];
  for (const { encryptedKey, recipient } of results) {
    if (encryptedKey) {
      wrapped.push({ encryptedKey, userId: recipient.userId });
    } else {
      skipped.push(recipient.userId);
    }
  }
  return { skipped, wrapped };
}

async function wrapForRecipient(
  myPrivateKey: CryptoKey,
  recipient: WrapRecipient,
  conversationId: string,
  rootKey: Uint8Array
): Promise<EncryptedBlob | null> {
  const theirKey = await importPublicKeyOrNull(recipient.publicKeyBase64);
  if (!theirKey) {
    return null;
  }
  return wrapRootKey(myPrivateKey, theirKey, conversationId, rootKey);
}

// Import that treats an unusable public key as absent rather than throwing, so
// one bad roster entry cannot fail a whole fan-out. The pairing itself still has
// to be valid: a wrong key produces a blob that fails its AES-GCM tag at unwrap
// time, which the unwrap side already treats as "not my wrap".
async function importPublicKeyOrNull(
  publicKeyBase64: string | null | undefined
): Promise<CryptoKey | null> {
  if (typeof publicKeyBase64 !== "string" || publicKeyBase64.length === 0) {
    return null;
  }
  try {
    return await importPublicKeyJwk(publicKeyBase64ToJwk(publicKeyBase64));
  } catch {
    return null;
  }
}

// The caller's own public half, derived from the private key they are holding.
// A rotation includes the rotator, and their identity row is not always in the
// snapshot being rotated from; their public key never is, because they have it.
export async function selfPublicKeyBase64(
  myPrivateKey: CryptoKey
): Promise<string> {
  return publicKeyJwkToBase64(await exportPublicKeyJwk(myPrivateKey));
}

// ---- message ratchet ---------------------------------------------------------

// Deterministic per-message key: both the sender and the receiver derive the
// same key from the root key, the sender's id, and the message's chain index.
// Split into import + derive so a conversation imports its HKDF base key once
// and reuses it for every message instead of paying an importKey round-trip
// per decrypt. The derived keys are identical either way.
export function importRatchetBaseKey(rootKey: Uint8Array): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    toBufferSource(rootKey),
    "HKDF",
    false,
    ["deriveKey"]
  );
}

export function deriveMessageKeyFromBase(
  baseKey: CryptoKey,
  senderId: string,
  index: number
): Promise<CryptoKey> {
  return globalThis.crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: ENC.encode("asm:msg:v1"),
      name: "HKDF",
      salt: ENC.encode(`asm:ratchet:${senderId}:${index}`),
    },
    baseKey,
    { length: 256, name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function deriveMessageKey(
  rootKey: Uint8Array,
  senderId: string,
  index: number
): Promise<CryptoKey> {
  return deriveMessageKeyFromBase(
    await importRatchetBaseKey(rootKey),
    senderId,
    index
  );
}

// Normalizes both media shapes into one list so renderers, reply labels, and
// lightboxes never branch on the payload version.
export function getMediaImages(
  content: Extract<MessagePayload, { type: "media" }>
): MediaImageRef[] {
  if ("images" in content) {
    return content.images;
  }
  return [{ height: content.height, url: content.url, width: content.width }];
}

export { extractMessageReferences } from "./references";

// Returns a copy of a payload with its text rewritten. An edit only ever
// changes the human-visible body (the text of a text message, the caption of a
// media album or post share); every structural field — type, images, postId,
// reply linkage — is preserved so the message keeps its shape. The ratchet
// index lives on the row, not the payload, so it is untouched by design.
export function editMessagePayload(
  payload: MessagePayload,
  content: string
): MessagePayload {
  return { ...payload, content };
}

export interface EncryptedMessage {
  ciphertext: string;
  iv: string;
  ratchetIndex: number;
}

export async function encryptMessage(
  rootKey: Uint8Array,
  senderId: string,
  ratchetIndex: number,
  conversationId: string,
  payload: MessagePayload
): Promise<EncryptedMessage> {
  const messageKey = await deriveMessageKey(rootKey, senderId, ratchetIndex);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const aad = ENC.encode(`${conversationId}:${senderId}:${ratchetIndex}`);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { additionalData: aad, iv, name: "AES-GCM" },
    messageKey,
    ENC.encode(JSON.stringify(payload))
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    ratchetIndex,
  };
}

export async function decryptMessage(
  rootKey: Uint8Array,
  senderId: string,
  conversationId: string,
  message: Pick<EncryptedMessage, "ciphertext" | "iv" | "ratchetIndex">
): Promise<MessagePayload> {
  return decryptMessageWithBaseKey(
    await importRatchetBaseKey(rootKey),
    senderId,
    conversationId,
    message
  );
}

// Same as decryptMessage but starting from an already-imported ratchet base
// key (see importRatchetBaseKey). The batch decryptor resolves the base key
// once per conversation and funnels every message through here.
export async function decryptMessageWithBaseKey(
  baseKey: CryptoKey,
  senderId: string,
  conversationId: string,
  message: Pick<EncryptedMessage, "ciphertext" | "iv" | "ratchetIndex">
): Promise<MessagePayload> {
  const messageKey = await deriveMessageKeyFromBase(
    baseKey,
    senderId,
    message.ratchetIndex
  );
  const aad = ENC.encode(
    `${conversationId}:${senderId}:${message.ratchetIndex}`
  );
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { additionalData: aad, iv: base64ToBytes(message.iv), name: "AES-GCM" },
    messageKey,
    base64ToBytes(message.ciphertext)
  );
  return parseMessagePayload(DEC.decode(plaintext));
}

// ---- fingerprints ------------------------------------------------------------

// Short, comparable fingerprint of a (myPub, theirPub) pair shown in the
// thread header so users can verify keys out of band.
export async function generateFingerprint(
  myPublicKey: CryptoKey,
  theirPublicKey: CryptoKey,
  theirPublicBase64: string
): Promise<string> {
  const myJwk = await exportPublicKeyJwk(myPublicKey);
  const myPubBytes = ENC.encode(`${myJwk.x}:${myJwk.y}:${theirPublicBase64}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", myPubBytes);
  const hash = new Uint8Array(digest).slice(0, FINGERPRINT_GROUP_COUNT * 4);
  const hex = [...hash]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const groups: string[] = [];
  for (let index = 0; index < FINGERPRINT_GROUP_COUNT; index += 1) {
    groups.push(hex.slice(index * 8, index * 8 + 8));
  }
  return groups.join("-");
}

// ---- account backup secret -----------------------------------------------------

// Random per-identity seed. Its SHA-256 hash is stored with the identity and
// used as the PBKDF2 input for the backup key, so the server can re-derive the
// backup key from the row alone (automatic recovery). The raw value is
// discarded immediately and is no longer persisted anywhere.
export function generateAccountSecret(length = ACCOUNT_SECRET_LENGTH): string {
  // base64url encodes 3 bytes as 4 characters, so derive the random-byte count
  // from the requested length. That keeps the returned secret exactly `length`
  // characters for any length, not just the 64-character default.
  const byteCount = Math.floor((length * 3) / 4);
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(byteCount));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .slice(0, length);
}

export async function hashAccountSecret(secret: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    ENC.encode(secret)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
