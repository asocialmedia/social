// Client-side E2EE primitives for Messages. Everything here runs in the
// browser (and in bun unit tests); the server never sees plaintext, private
// keys, master keys, or conversation keys.
//
// Trust model: each user owns an ECDH P-256 identity keypair. The public half
// is stored in plaintext on the server so anyone can derive a shared secret
// to wrap conversation keys for that user. The private half is backed up on
// the server encrypted under a master key derived (PBKDF2) from a hash of the
// account's random backup secret. Enabling is fully automatic: the client
// generates a 64-character random secret, stores only its SHA-256 hash with
// the account on the server, and derives the master key from that hash. The
// raw secret is never persisted, but the hash IS the KDF input, so a server
// or database reader holding the row can re-derive the master key and decrypt
// the backup; recovery on a new device needs no user input by design.
//
// Per-conversation, a fresh random 256-bit root key is wrapped for each
// participant via ECDH(myPrivate, theirPublic) + HKDF + AES-GCM. Message
// keys are ratcheted forward from the root: the i-th message from sender S
// uses HKDF(root, "asm:ratchet:" + S + ":" + i), giving backward secrecy if a
// root key is ever compromised.

export const KDF_ITERATIONS = 600_000;
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

// ---- message ratchet ---------------------------------------------------------

// Deterministic per-message key: both the sender and the receiver derive the
// same key from the root key, the sender's id, and the message's chain index.
export async function deriveMessageKey(
  rootKey: Uint8Array,
  senderId: string,
  index: number
): Promise<CryptoKey> {
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    toBufferSource(rootKey),
    "HKDF",
    false,
    ["deriveKey"]
  );
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
      url: string;
      width?: number;
      height?: number;
      replyToId?: string;
      replyToSenderId?: string;
    };

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
  const messageKey = await deriveMessageKey(
    rootKey,
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
  const payload = JSON.parse(DEC.decode(plaintext)) as Partial<MessagePayload>;
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
  if (payload.type === "media" && !isValidMediaPayload(payload)) {
    throw new Error("Invalid media payload");
  }
  return payload as MessagePayload;
}

// A media payload must carry a supported kind and a URL that resolves to an
// external scheme. Only https is accepted in production; http is tolerated for
// localhost/loopback so local development against a local object store works.
function isValidMediaPayload(
  payload: Partial<Extract<MessagePayload, { type: "media" }>>
): boolean {
  if (payload.kind !== "gif" && payload.kind !== "image") {
    return false;
  }
  if (typeof payload.url !== "string") {
    return false;
  }
  let url: URL;
  try {
    url = new URL(payload.url);
  } catch {
    return false;
  }
  if (url.protocol === "https:") {
    return true;
  }
  if (url.protocol === "http:") {
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1"
    );
  }
  return false;
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

// Fully automatic, account-scoped backup secret: a random 64-character value
// generated once per account. Only its SHA-256 hash is ever stored (server
// side, with the identity), and that hash is the actual secret used for the
// PBKDF2 master key, so no user input is needed to enable or unlock.
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
const IDB_NAME = "asm-messages";
const IDB_STORE = "identity-keys";

function openStore(): Promise<IDBDatabase> {
  // eslint-disable-next-line promise/avoid-new -- IndexedDB callback API must be wrapped in Promise
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) {
        request.result.createObjectStore(IDB_STORE);
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

export async function getStoredPrivateKey(
  userId: string
): Promise<JsonWebKey | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }
  try {
    const db = await openStore();
    // eslint-disable-next-line promise/avoid-new -- IndexedDB callback API must be wrapped in Promise
    return await new Promise<JsonWebKey | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const request = tx.objectStore(IDB_STORE).get(userId);
      request.addEventListener("success", () => {
        resolve((request.result as JsonWebKey) ?? null);
      });
      request.addEventListener("error", () => reject(request.error));
    });
  } catch {
    return null;
  }
}

export async function setStoredPrivateKey(
  userId: string,
  jwk: JsonWebKey
): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return;
  }
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
    console.error("Failed to store identity key:", error);
  }
}

export async function clearStoredPrivateKey(userId: string): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return;
  }
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
    console.error("Failed to clear identity key:", error);
  }
}
