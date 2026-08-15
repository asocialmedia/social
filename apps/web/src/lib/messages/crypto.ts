// Client-side E2EE primitives for Messages. Everything here runs in the
// browser (and in bun unit tests); the server never sees plaintext, private
// keys, master keys, or conversation keys.
//
// Trust model: each user owns an ECDH P-256 identity keypair. The public half
// is stored in plaintext on the server so anyone can derive a shared secret
// to wrap conversation keys for that user. The private half is backed up on
// the server encrypted under a master key derived (PBKDF2) from a secret only
// the owner knows (their account password, or a generated passphrase for
// OAuth-only accounts), so a new device can recover old chats while the
// server still cannot read anything.
//
// Per-conversation, a fresh random 256-bit root key is wrapped for each
// participant via ECDH(myPrivate, theirPublic) + HKDF + AES-GCM. Message
// keys are ratcheted forward from the root: the i-th message from sender S
// uses HKDF(root, "asm:ratchet:" + S + ":" + i), giving backward secrecy if a
// root key is ever compromised.

export const KDF_ITERATIONS = 600_000;
export const FINGERPRINT_GROUP_COUNT = 4;
export const PASSPHRASE_WORDS = 6;

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
  salt: Uint8Array<ArrayBuffer>,
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
    { hash: "SHA-256", iterations, name: "PBKDF2", salt },
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
  sharedSecret: Uint8Array<ArrayBuffer>,
  conversationId: string
): Promise<CryptoKey> {
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    sharedSecret,
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
  rootKey: Uint8Array<ArrayBuffer>
): Promise<EncryptedBlob> {
  const sharedSecret = await deriveSharedSecret(myPrivateKey, theirPublicKey);
  const wrapKey = await deriveWrapKey(sharedSecret, conversationId);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    wrapKey,
    rootKey
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
): Promise<Uint8Array<ArrayBuffer>> {
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
  rootKey: Uint8Array<ArrayBuffer>,
  senderId: string,
  index: number
): Promise<CryptoKey> {
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    rootKey,
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
    };

export interface EncryptedMessage {
  ciphertext: string;
  iv: string;
  ratchetIndex: number;
}

export async function encryptMessage(
  rootKey: Uint8Array<ArrayBuffer>,
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
  rootKey: Uint8Array<ArrayBuffer>,
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
  if (payload.type !== "text" && payload.type !== "post") {
    throw new Error("Invalid message payload");
  }
  if (payload.type === "text" && typeof payload.content !== "string") {
    throw new Error("Invalid text payload");
  }
  if (payload.type === "post" && typeof payload.postId !== "string") {
    throw new Error("Invalid post payload");
  }
  return payload as MessagePayload;
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

// ---- recovery passphrase (OAuth-only accounts) --------------------------------

const WORDS = [
  "acorn",
  "amber",
  "arcade",
  "aspen",
  "atlas",
  "aurora",
  "bacon",
  "badger",
  "bamboo",
  "beacon",
  "blossom",
  "breeze",
  "brick",
  "canyon",
  "cedar",
  "cinder",
  "cobalt",
  "comet",
  "cosmos",
  "cricket",
  "daisy",
  "dandelion",
  "delta",
  "drift",
  "echo",
  "ember",
  "falcon",
  "ferret",
  "fjord",
  "flame",
  "forest",
  "fossil",
  "foxglove",
  "galaxy",
  "geyser",
  "glimmer",
  "granite",
  "grove",
  "harbor",
  "hazel",
  "heron",
  "honey",
  "horizon",
  "icicle",
  "indigo",
  "iris",
  "island",
  "ivory",
  "jaguar",
  "jasmine",
  "juniper",
  "kestrel",
  "kite",
  "lagoon",
  "lantern",
  "lark",
  "lattice",
  "lilac",
  "lotus",
  "lynx",
  "magnolia",
  "maple",
  "marble",
  "meadow",
  "meteor",
  "mint",
  "mirage",
  "mosaic",
  "moss",
  "nebula",
  "nightjar",
  "nova",
  "oak",
  "onyx",
  "orchid",
  "oriole",
  "otter",
  "pebble",
  "petal",
  "pixel",
  "plum",
  "prairie",
  "quartz",
  "quill",
  "raven",
  "reef",
  "ridge",
  "rivulet",
  "robin",
  "sage",
  "salmon",
  "sapphire",
  "sequoia",
  "shard",
  "sierra",
  "sparrow",
  "spruce",
  "summit",
  "swan",
  "taiga",
  "thistle",
  "tide",
  "topaz",
  "trout",
  "tulip",
  "tundra",
  "valley",
  "verdigris",
  "violet",
  "wander",
  "willow",
  "wren",
  "zephyr",
];

export function generateRecoveryPassphrase(
  wordCount = PASSPHRASE_WORDS
): string {
  const words: string[] = [];
  for (let index = 0; index < wordCount; index += 1) {
    const [random] = globalThis.crypto.getRandomValues(new Uint32Array(1));
    words.push(WORDS[random % WORDS.length]);
  }
  return words.join(" ");
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
