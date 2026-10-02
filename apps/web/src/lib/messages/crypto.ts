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

import { MAX_MESSAGE_ATTACHMENTS } from "@asm/media";

import {
  closeOnVersionChange,
  ensureMessagesSchema,
  IDENTITY_STORE,
  MESSAGES_DB_NAME,
  MESSAGES_DB_VERSION,
} from "./message-db";

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

// One image inside a grouped media message. Dimensions are captured at upload
// so the receiver can reserve the tile box before the bytes arrive.
export interface MediaImageRef {
  height?: number;
  url: string;
  width?: number;
}

export type MessagePayload =
  | {
      type: "text";
      content: string;
      replyToId?: string;
      replyToSenderId?: string;
    }
  | {
      type: "post";
      content?: string;
      postId: string;
      replyToId?: string;
      replyToSenderId?: string;
    }
  | {
      // Grouped album form, used by every new sender. One message carries up to
      // MAX_MESSAGE_ATTACHMENTS images so a multi-image send lands as a single
      // transcript row instead of N separate bubbles.
      type: "media";
      kind: "gif" | "image";
      images: MediaImageRef[];
      // Optional caption typed alongside the attachments.
      content?: string;
      replyToId?: string;
      replyToSenderId?: string;
    }
  | {
      // Legacy single-image form, still produced by older clients. Kept
      // readable so existing history never becomes undecryptable.
      type: "media";
      kind: "gif" | "image";
      url: string;
      content?: string;
      width?: number;
      height?: number;
      replyToId?: string;
      replyToSenderId?: string;
    };

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

// Parses and validates a decrypted payload. Shared by both decrypt entry
// points so the trust boundary (peer-controlled JSON) is identical.
function parseMessagePayload(plaintext: string): MessagePayload {
  const payload = JSON.parse(plaintext) as Partial<MessagePayload>;
  if (
    payload.type !== "text" &&
    payload.type !== "post" &&
    payload.type !== "media"
  ) {
    throw new Error("Invalid message payload");
  }
  if (payload.type === "text" && typeof payload.content !== "string") {
    throw new Error("Invalid text payload");
  }
  if (payload.type === "post" && typeof payload.postId !== "string") {
    throw new Error("Invalid post payload");
  }
  if (payload.type === "media") {
    if (!isValidMediaPayload(payload)) {
      throw new Error("Invalid media payload");
    }
    if (payload.content !== undefined && typeof payload.content !== "string") {
      throw new Error("Invalid media caption");
    }
  }
  return payload as MessagePayload;
}

// A media payload must carry a supported kind and a URL that resolves to an
// external scheme. Only https is accepted in production; http is tolerated for
// localhost/loopback so local development against a local object store works.
// Same-origin app proxy paths (/api/media/<id>) are also accepted: that is how
// message attachments are stored (see uploadMessageMedia), and they resolve
// against the recipient's own origin, so no cross-origin leak is possible.
// Anything else (protocol-relative, javascript:, data:, path traversal) is
// rejected because the URL comes from the peer's encrypted payload.
// Relative paths are matched with a strict character class instead of the URL
// constructor so `new URL` is never handed a scheme-relative input. Both the
// original proxy path and the pipeline derivative path (/v/<name>) are
// accepted, since senders may embed either.
const RELATIVE_MEDIA_PATH_RE =
  /^\/api\/media\/[A-Za-z0-9_-]+(?:\/v\/[A-Za-z0-9.-]+)?(?:\?[A-Za-z0-9_=&%.-]+)?$/;

// Shape-tolerant view of a media payload so both the grouped-album and legacy
// single-URL forms validate through one path. Every field is `unknown` because
// the value arrives from parsed, peer-controlled JSON.
interface RawMediaPayload {
  height?: unknown;
  images?: unknown;
  kind?: unknown;
  url?: unknown;
  width?: unknown;
}

function isValidMediaPayload(
  payload: Partial<Extract<MessagePayload, { type: "media" }>>
): boolean {
  const raw = payload as RawMediaPayload;
  if (raw.kind !== "gif" && raw.kind !== "image") {
    return false;
  }
  // The grouped form is detected by key presence, not array truthiness: a
  // present-but-malformed `images` (null, a non-array) must be rejected rather
  // than silently falling through to the legacy URL check.
  if ("images" in raw) {
    return isValidMediaImageList(raw.images);
  }
  return isValidMediaImage(raw);
}

function isValidMediaImageList(images: unknown): boolean {
  if (
    !Array.isArray(images) ||
    images.length === 0 ||
    images.length > MAX_MESSAGE_ATTACHMENTS
  ) {
    return false;
  }
  return images.every((image) => {
    if (typeof image !== "object" || image === null) {
      return false;
    }
    return isValidMediaImage(image as RawMediaPayload);
  });
}

function isValidMediaImage(image: RawMediaPayload): boolean {
  if (typeof image.url !== "string") {
    return false;
  }
  // Dimensions are attacker-controlled (they ride in the peer's payload) and
  // flow into CSS aspect-ratio, so accept only sane positive integers.
  if (
    !isValidMediaDimension(image.width) ||
    !isValidMediaDimension(image.height)
  ) {
    return false;
  }
  return isAllowedMediaUrl(image.url);
}

// A media URL must resolve to a same-origin proxy path or an external scheme.
// Only https is accepted in production; http is tolerated for localhost/loopback
// so local development against a local object store works. Same-origin app
// proxy paths (/api/media/<id>) are also accepted: that is how message
// attachments are stored (see uploadMessageMedia), and they resolve against the
// recipient's own origin, so no cross-origin leak is possible. Anything else
// (protocol-relative, javascript:, data:, path traversal) is rejected because
// the URL comes from the peer's encrypted payload. Relative paths are matched
// with a strict character class instead of the URL constructor so `new URL` is
// never handed a scheme-relative input. Both the original proxy path and the
// pipeline derivative path (/v/<name>) are accepted, since senders may embed
// either.
function isAllowedMediaUrl(url: string): boolean {
  if (RELATIVE_MEDIA_PATH_RE.test(url)) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") {
    return true;
  }
  // Plain http is a local-development affordance only: loopback in dev. It is
  // never accepted in production, where a peer could otherwise force the
  // recipient's browser to make insecure/plaintext requests.
  if (parsed.protocol === "http:") {
    const isLoopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";
    return process.env.NODE_ENV !== "production" && isLoopback;
  }
  return false;
}

const MAX_MEDIA_DIMENSION = 16_384;

function isValidMediaDimension(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= MAX_MEDIA_DIMENSION)
  );
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

// ---- device-scoped key storage (IndexedDB) -----------------------------------

// The unwrapped identity private key is cached per device so the user does not
// have to re-enter their secret every session. It never leaves this origin.
const IDB_STORE = IDENTITY_STORE;
const LS_KEY_PREFIX = "asm_msg_key_";

function openStore(): Promise<IDBDatabase> {
  // eslint-disable-next-line promise/avoid-new -- IndexedDB callback API must be wrapped in Promise
  return new Promise((resolve, reject) => {
    // The SHARED version, not a private one. Requesting a lower version than the
    // database already has throws VersionError, so opening this at 1 while the
    // search index had created the database at a higher version made identity
    // key storage fail outright.
    const request = indexedDB.open(MESSAGES_DB_NAME, MESSAGES_DB_VERSION);
    request.addEventListener("upgradeneeded", (event) => {
      // The shared schema builder, so this owner's store exists even when the
      // search index created the database first. It is idempotent and only resets
      // search stores on a version whose keying cannot be migrated, so an
      // identity upgrade never costs a rebuilt index.
      ensureMessagesSchema(request.result, event.oldVersion);
    });
    request.addEventListener("success", () => {
      closeOnVersionChange(request.result);
      resolve(request.result);
    });
    request.addEventListener("error", () => reject(request.error));
  });
}

export async function getStoredPrivateKey(
  userId: string
): Promise<JsonWebKey | null> {
  if (typeof window === "undefined") {
    return null;
  }
  // Try localStorage first for instant 0ms key retrieval
  try {
    const raw = localStorage.getItem(`${LS_KEY_PREFIX}${userId}`);
    if (raw) {
      return JSON.parse(raw) as JsonWebKey;
    }
  } catch {
    // localStorage might be unavailable in restricted webviews
  }

  // Fallback to IndexedDB
  if (typeof indexedDB !== "undefined") {
    try {
      const db = await openStore();
      // eslint-disable-next-line promise/avoid-new -- IndexedDB callback API must be wrapped in Promise
      const jwk = await new Promise<JsonWebKey | null>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const request = tx.objectStore(IDB_STORE).get(userId);
        request.addEventListener("success", () => {
          resolve((request.result as JsonWebKey) ?? null);
        });
        request.addEventListener("error", () => reject(request.error));
      });
      if (jwk) {
        try {
          localStorage.setItem(
            `${LS_KEY_PREFIX}${userId}`,
            JSON.stringify(jwk)
          );
        } catch {
          // ignore
        }
        return jwk;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function setStoredPrivateKey(
  userId: string,
  jwk: JsonWebKey
): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(`${LS_KEY_PREFIX}${userId}`, JSON.stringify(jwk));
    } catch {
      // ignore
    }
  }
  if (typeof indexedDB !== "undefined") {
    try {
      const db = await openStore();
      // eslint-disable-next-line promise/avoid-new -- IndexedDB callback API must be wrapped in Promise
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(jwk, userId);
        tx.addEventListener("complete", () => resolve());
        tx.addEventListener("error", () => reject(tx.error));
      });
    } catch (error) {
      console.error("Failed to store identity key in IDB:", error);
    }
  }
}

export async function clearStoredPrivateKey(userId: string): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(`${LS_KEY_PREFIX}${userId}`);
    } catch {
      // ignore
    }
    try {
      localStorage.removeItem(`${LS_SECRET_PREFIX}${userId}`);
    } catch {
      // ignore
    }
  }
  if (typeof indexedDB !== "undefined") {
    try {
      const db = await openStore();
      // eslint-disable-next-line promise/avoid-new -- IndexedDB callback API must be wrapped in Promise
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(userId);
        tx.addEventListener("complete", () => resolve());
        tx.addEventListener("error", () => reject(tx.error));
      });
    } catch (error) {
      console.error("Failed to clear identity key from IDB:", error);
    }
  }
}

// ---- device-scoped legacy backup-secret storage ------------------------------

// Storage for the raw secret of the short-lived "verifier" scheme. It is only
// READ now: current identities derive their backup key from the stored hash, so
// nothing writes this key anymore. Keeping the reader lets a device that still
// holds a verifier-row secret unlock it instead of needing a reset.
const LS_SECRET_PREFIX = "asm_msg_secret_";

export function getStoredAccountSecret(userId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return localStorage.getItem(`${LS_SECRET_PREFIX}${userId}`);
  } catch {
    return null;
  }
}
