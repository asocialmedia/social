// Client-side encryption primitives for Messages, ported 1:1 from
// apps/web/src/lib/messages/crypto.ts.
//
// Trust model (server-recoverable, "Telegram-cloud" semantics — NOT E2EE):
// each user owns an ECDH P-256 identity keypair. The public half is stored in
// plaintext on the server so anyone can derive a shared secret to wrap
// conversation keys for that user. The private half is backed up on the server
// encrypted under a master key derived (PBKDF2) from a random per-identity value
// whose SHA-256 hash is stored in the SAME row. Deriving the backup key from that
// stored row is exactly what automatic recovery does, so anyone who can read the
// database can decrypt the backup and every message wrapped under it. That is an
// accepted trade-off: messages are encrypted in transit and at rest and access is
// gated by session + membership. See AGENTS.md before changing anything here.
//
// A second, short-lived scheme ("verifier rows") derived the master key from a
// raw random secret held only on the user's device and stored just its hash.
// Those rows cannot be auto-recovered; unlock still accepts them when this device
// still holds the raw secret.
//
// Per-conversation, a fresh random 256-bit root key is wrapped for each
// participant via ECDH(myPrivate, theirPublic) + HKDF + AES-GCM. Message keys
// are ratcheted forward from the root: the i-th message from sender S uses
// HKDF(root, "asm:ratchet:" + S + ":" + i), giving backward secrecy if a root key
// is ever compromised.
//
// WHAT CHANGED FROM WEB, AND WHY IT IS SAFE:
// 1. `CryptoKey` does not exist in Hermes. Keys are the branded raw byte handles
//    from crypto-primitives.ts instead. Every derivation is byte-identical, which
//    crypto-primitives.test.ts asserts against the same WebCrypto calls web uses,
//    so ciphertext produced here decrypts there and vice versa.
// 2. The device key store is injected rather than reaching for localStorage and
//    IndexedDB, neither of which exists on native. SecureStore is the native
//    equivalent and is strictly better: web had to mirror the private key into
//    localStorage in cleartext for a 0ms read, which this does not.
// 3. `isAllowedMediaUrl` cannot consult process.env.NODE_ENV on a device, so the
//    loopback-http allowance is an explicit injected flag instead.

import { MAX_MESSAGE_ATTACHMENTS } from "@asm/media";
import { p256 as nobleP256 } from "@noble/curves/nist.js";

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64ToBytes,
  bytesToBase64,
  bytesToBase64Url,
  compressPublicKey,
  DECODER,
  deriveSharedSecret,
  ENCODER,
  generateIdentityKeyPair as generateKeyPair,
  GCM_IV_BYTES,
  hkdfSha256,
  importPrivateKeyJwk as importPrivateKeyBytes,
  importPublicKeyJwk as importPublicKeyBytes,
  pbkdf2Sha256Async,
  randomBytes,
  setRandomSource,
  sha256,
  uncompressPublicKey,
} from "./crypto-primitives";
import type {
  AesGcmKey,
  EcdhPrivateKey,
  EcdhPublicKey,
} from "./crypto-primitives";

export const KDF_ITERATIONS = 100_000;
export const FINGERPRINT_GROUP_COUNT = 4;
export const ACCOUNT_SECRET_LENGTH = 64;

// Points the entropy source at expo-crypto's native CSPRNG. Idempotent, and safe
// in Expo Go (expo-crypto ships there). Called once by the identity provider on
// mount; until then the primitives fall back to the runtime's own
// getRandomValues, which on Hermes does not exist, so this must run before the
// first key is generated.
//
// The dynamic import is the point: a static `expo-crypto` import would make this
// module unparseable under `bun test`, which the lib/ rule in AGENTS.md forbids.
export async function configureNativeEntropy(): Promise<void> {
  const { getRandomValues } = await import("expo-crypto");
  setRandomSource((length) => {
    const out = new Uint8Array(length);
    getRandomValues(out);
    return out;
  });
}

// ---- identity keypair ------------------------------------------------------

export interface NativeIdentityKeyPair {
  privateKey: EcdhPrivateKey;
  publicKey: EcdhPublicKey;
}

export function generateIdentityKeyPair(): NativeIdentityKeyPair {
  return generateKeyPair();
}

export function exportPublicKeyJwk(key: EcdhPublicKey): JsonWebKey {
  const uncompressed = uncompressPublicKey(key);

  return {
    crv: "P-256",
    ext: true,
    key_ops: [],
    kty: "EC",
    x: bytesToBase64Url(uncompressed.subarray(1, 33)),
    y: bytesToBase64Url(uncompressed.subarray(33, 65)),
  };
}

export function exportPrivateKeyJwk(key: EcdhPrivateKey): JsonWebKey {
  const { x, y } = publicPointCoordinates(key);
  return {
    crv: "P-256",
    d: bytesToBase64Url(key),
    ext: true,
    key_ops: ["deriveBits"],
    kty: "EC",
    x: bytesToBase64Url(x),
    y: bytesToBase64Url(y),
  };
}

export function importPublicKeyJwk(jwk: JsonWebKey): EcdhPublicKey {
  return importPublicKeyBytes(jwk);
}

// The public half of an identity keypair, recovered from the private half. The
// identity provider keeps only the private key (the public one lives on the server
// row), and the thread header needs the public key to compute the fingerprint.
export function derivePublicKeyFromPrivate(
  privateKey: EcdhPrivateKey
): EcdhPublicKey {
  return compressPublicKey(nobleP256.getPublicKey(privateKey)) as EcdhPublicKey;
}

export function importPrivateKeyJwk(jwk: JsonWebKey): EcdhPrivateKey {
  return importPrivateKeyBytes(jwk);
}

// A P-256 public JWK is fully described by (crv, kty, x, y); store those so the
// server row stays small and self-contained. Byte-for-byte the same compact
// shape web stores, so a public key written by either client reads on the other.
export function publicKeyJwkToBase64(jwk: JsonWebKey): string {
  const compact = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  return bytesToBase64(ENCODER.encode(JSON.stringify(compact)));
}

export function publicKeyBase64ToJwk(encoded: string): JsonWebKey {
  const parsed = JSON.parse(
    DECODER.decode(base64ToBytes(encoded))
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

export type MasterKeyDeriver = (
  secret: string,
  salt: Uint8Array,
  iterations: number
) => Promise<Uint8Array>;

let nativeMasterKeyDeriver: MasterKeyDeriver | null = null;

// Injected by the native binding so this wire-format module remains testable.
export function setNativeMasterKeyDeriver(
  deriver: MasterKeyDeriver | null
): void {
  nativeMasterKeyDeriver = deriver;
}

export async function deriveMasterKey(
  secret: string,
  salt: Uint8Array,
  iterations = KDF_ITERATIONS
): Promise<AesGcmKey> {
  if (nativeMasterKeyDeriver) {
    const key = await nativeMasterKeyDeriver(secret, salt, iterations);
    if (key.length !== 32) {
      throw new Error("Invalid derived message key length");
    }
    return key as AesGcmKey;
  }
  return pbkdf2Sha256Async(ENCODER.encode(secret), salt, iterations);
}

export interface EncryptedBlob {
  ciphertext: string;
  iv: string;
}

export async function encryptWithMasterKey(
  masterKey: AesGcmKey,
  plaintext: string
): Promise<EncryptedBlob> {
  await Promise.resolve();
  const iv = randomBytes(GCM_IV_BYTES);
  const ciphertext = aesGcmEncrypt(masterKey, iv, ENCODER.encode(plaintext));
  return { ciphertext: bytesToBase64(ciphertext), iv: bytesToBase64(iv) };
}

export async function decryptWithMasterKey(
  masterKey: AesGcmKey,
  blob: EncryptedBlob
): Promise<string> {
  await Promise.resolve();
  const plaintext = aesGcmDecrypt(
    masterKey,
    base64ToBytes(blob.iv),
    base64ToBytes(blob.ciphertext)
  );
  return DECODER.decode(plaintext);
}

// ---- shared secret + conversation key wrapping ------------------------------

// HKDF-derived AES-GCM wrap key from the shared secret, bound to the
// conversation id so one shared secret can never wrap keys for another convo.
export async function deriveWrapKey(
  sharedSecret: Uint8Array,
  conversationId: string
): Promise<AesGcmKey> {
  await Promise.resolve();
  return hkdfSha256(
    sharedSecret,
    new Uint8Array(32),
    ENCODER.encode(`asm:wrap:${conversationId}`)
  );
}

export async function wrapRootKey(
  myPrivateKey: EcdhPrivateKey,
  theirPublicKey: EcdhPublicKey,
  conversationId: string,
  rootKey: Uint8Array
): Promise<EncryptedBlob> {
  const sharedSecret = deriveSharedSecret(myPrivateKey, theirPublicKey);
  const wrapKey = await deriveWrapKey(sharedSecret, conversationId);
  const iv = randomBytes(GCM_IV_BYTES);
  const ciphertext = aesGcmEncrypt(wrapKey, iv, rootKey);
  return { ciphertext: bytesToBase64(ciphertext), iv: bytesToBase64(iv) };
}

export async function unwrapRootKey(
  myPrivateKey: EcdhPrivateKey,
  theirPublicKey: EcdhPublicKey,
  conversationId: string,
  blob: EncryptedBlob
): Promise<Uint8Array> {
  const sharedSecret = deriveSharedSecret(myPrivateKey, theirPublicKey);
  const wrapKey = await deriveWrapKey(sharedSecret, conversationId);
  return aesGcmDecrypt(
    wrapKey,
    base64ToBytes(blob.iv),
    base64ToBytes(blob.ciphertext)
  );
}

export function generateRootKey(): Uint8Array {
  return randomBytes(32);
}

// ---- message ratchet ---------------------------------------------------------

// A ratchet base key is just the conversation root key. Web splits this into
// importKey + deriveKey so it pays one import per conversation; here the root is
// already raw bytes, so there is no import step to hoist and the two functions
// collapse to one derivation. Kept as a separate symbol because every call site
// reads as base-key-plus-index and that is the concept being expressed.
export type RatchetBaseKey = Uint8Array;

export function importRatchetBaseKey(rootKey: Uint8Array): RatchetBaseKey {
  return rootKey;
}

export function deriveMessageKeyFromBase(
  baseKey: RatchetBaseKey,
  senderId: string,
  index: number
): AesGcmKey {
  return hkdfSha256(
    baseKey,
    ENCODER.encode(`asm:ratchet:${senderId}:${index}`),
    ENCODER.encode("asm:msg:v1")
  );
}

export async function deriveMessageKey(
  rootKey: Uint8Array,
  senderId: string,
  index: number
): Promise<AesGcmKey> {
  await Promise.resolve();
  return deriveMessageKeyFromBase(rootKey, senderId, index);
}

// One image inside a grouped media message. Dimensions are captured at upload so
// the receiver can reserve the tile box before the bytes arrive.
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
      type: "media";
      kind: "gif" | "image";
      images: MediaImageRef[];
      content?: string;
      replyToId?: string;
      replyToSenderId?: string;
    }
  | {
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

// Returns a copy of a payload with its text rewritten. An edit only ever changes
// the human-visible body; every structural field is preserved so the message keeps
// its shape. The ratchet index lives on the row, not the payload.
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
  const iv = randomBytes(GCM_IV_BYTES);
  const aad = ENCODER.encode(`${conversationId}:${senderId}:${ratchetIndex}`);
  const ciphertext = aesGcmEncrypt(
    messageKey,
    iv,
    ENCODER.encode(JSON.stringify(payload)),
    aad
  );
  return {
    ciphertext: bytesToBase64(ciphertext),
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
  // Kept async for signature parity with web's `decryptMessage`, so a call site
  // that ports across does not have to drop an `await`. The work itself is
  // synchronous on native.
  await Promise.resolve();
  return decryptMessageWithBaseKey(rootKey, senderId, conversationId, message);
}

export function decryptMessageWithBaseKey(
  baseKey: RatchetBaseKey,
  senderId: string,
  conversationId: string,
  message: Pick<EncryptedMessage, "ciphertext" | "iv" | "ratchetIndex">
): MessagePayload {
  const messageKey = deriveMessageKeyFromBase(
    baseKey,
    senderId,
    message.ratchetIndex
  );
  const aad = ENCODER.encode(
    `${conversationId}:${senderId}:${message.ratchetIndex}`
  );
  const plaintext = aesGcmDecrypt(
    messageKey,
    base64ToBytes(message.iv),
    base64ToBytes(message.ciphertext),
    aad
  );
  return parseMessagePayload(DECODER.decode(plaintext));
}

// Parses and validates a decrypted payload. Shared by both decrypt entry points
// so the trust boundary (peer-controlled JSON) is identical.
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

// A media URL must resolve to a same-origin proxy path or an external scheme.
// Relative paths are matched with a strict character class instead of the URL
// constructor so `new URL` is never handed a scheme-relative input. Both the
// original proxy path and the pipeline derivative path (/v/<name>) are accepted,
// since senders may embed either.
const RELATIVE_MEDIA_PATH_RE =
  /^\/api\/media\/[A-Za-z0-9_-]+(?:\/v\/[A-Za-z0-9.-]+)?(?:\?[A-Za-z0-9_=&%.-]+)?$/;

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
  // Detected by key presence, not array truthiness: a present-but-malformed
  // `images` (null, a non-array) must be rejected rather than silently falling
  // through to the legacy URL check.
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
  // Dimensions are attacker-controlled and drive layout, so only sane positive
  // integers.
  if (
    !isValidMediaDimension(image.width) ||
    !isValidMediaDimension(image.height)
  ) {
    return false;
  }
  return isAllowedMediaUrl(image.url);
}

// Only https is accepted in production. Plain http is tolerated for loopback so
// local development against a local object store works; on a device the dev
// server is reached over the emulator alias (10.0.2.2), so the allowance is an
// explicit argument rather than the process.env.NODE_ENV check web uses. A
// release build passes nothing and gets https-only.
export interface MediaUrlPolicy {
  // True in a dev build. Gates the loopback-http allowance.
  allowLoopbackHttp?: boolean;
}

export function isAllowedMediaUrl(
  url: string,
  policy: MediaUrlPolicy = {}
): boolean {
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
  if (parsed.protocol === "http:") {
    if (!policy.allowLoopbackHttp) {
      return false;
    }
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "10.0.2.2"
    );
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

// Short, comparable fingerprint of a (myPub, theirPub) pair shown in the thread
// header so users can verify keys out of band. Web computes it over the two JWK
// coordinates plus the peer's stored public key; the input string is identical
// here, so a fingerprint shown on one client matches the other.
export function generateFingerprint(
  myPublicKey: EcdhPublicKey,
  theirPublicBase64: string
): string {
  const myJwk = exportPublicKeyJwk(myPublicKey);
  const digest = sha256(
    ENCODER.encode(`${myJwk.x}:${myJwk.y}:${theirPublicBase64}`)
  );
  const hash = digest.slice(0, FINGERPRINT_GROUP_COUNT * 4);
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

// Random per-identity seed. Its SHA-256 hash is stored with the identity and used
// as the PBKDF2 input for the backup key, so the server can re-derive the backup
// key from the row alone. The raw value is discarded immediately.
export function generateAccountSecret(length = ACCOUNT_SECRET_LENGTH): string {
  // base64url encodes 3 bytes as 4 characters, so derive the random-byte count
  // from the requested length. That keeps the returned secret exactly `length`
  // characters for any length, not just the 64-character default.
  const byteCount = Math.floor((length * 3) / 4);
  return bytesToBase64Url(randomBytes(byteCount)).slice(0, length);
}

export async function hashAccountSecret(secret: string): Promise<string> {
  await Promise.resolve();
  return [...sha256(ENCODER.encode(secret))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ---- device-scoped key storage ------------------------------------------------

// Where the unwrapped identity private key and the legacy verifier secret live.
// Injected rather than imported so this module stays runnable under `bun test`
// with no native runtime (the lib/ rule in AGENTS.md). SecureStore is the native
// binding; see secure-key-store.ts.
export interface MessageKeyStore {
  clear: (userId: string) => Promise<void>;
  getPrivateKey: (userId: string) => Promise<JsonWebKey | null>;
  getStoredAccountSecret: (userId: string) => Promise<string | null>;
  setPrivateKey: (userId: string, jwk: JsonWebKey) => Promise<void>;
}

let keyStore: MessageKeyStore | null = null;

export function setMessageKeyStore(store: MessageKeyStore): void {
  keyStore = store;
}

function requireKeyStore(): MessageKeyStore {
  if (!keyStore) {
    throw new Error("Message key store is not configured");
  }
  return keyStore;
}

export function getStoredPrivateKey(
  userId: string
): Promise<JsonWebKey | null> {
  return requireKeyStore().getPrivateKey(userId);
}

export async function setStoredPrivateKey(
  userId: string,
  jwk: JsonWebKey
): Promise<void> {
  await requireKeyStore().setPrivateKey(userId, jwk);
}

export async function clearStoredPrivateKey(userId: string): Promise<void> {
  await requireKeyStore().clear(userId);
}

// Storage for the raw secret of the short-lived "verifier" scheme. It is only
// READ now: current identities derive their backup key from the stored hash, so
// nothing writes this key anymore. Keeping the reader lets a device that still
// holds a verifier-row secret unlock it instead of needing a reset.
export function getStoredAccountSecret(userId: string): Promise<string | null> {
  return requireKeyStore().getStoredAccountSecret(userId);
}

// ---- internal helpers --------------------------------------------------------

function publicPointCoordinates(privateKey: EcdhPrivateKey): {
  x: Uint8Array;
  y: Uint8Array;
} {
  const uncompressed = nobleP256.getPublicKey(privateKey, false);
  return {
    x: uncompressed.subarray(1, 33),
    y: uncompressed.subarray(33, 65),
  };
}
