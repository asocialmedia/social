import type {
  MessageConversationData,
  MessageData,
  MessagePage,
} from "@asm/db";

import { uploadMediaFile } from "@/lib/media-upload-client";

import {
  decryptMessage,
  encryptMessage,
  generateRootKey,
  publicKeyBase64ToJwk,
  unwrapRootKey,
  wrapRootKey,
} from "./crypto";
import type { EncryptedBlob, MessagePayload } from "./crypto";

// Thin typed wrappers around the messages API plus the client-side crypto
// orchestration (unwrap a conversation key, encrypt a message). All network
// I/O uses plain fetch with same-origin credentials; the server never sees
// plaintext.

export interface MessageIdentityPayload {
  createdAt: string;
  encryptedPrivateKey: string;
  kdfIterations: number;
  masterKeyHash: string;
  publicKey: string;
  salt: string;
  updatedAt: string;
}

export interface WrappedKeyPayload {
  encryptedKey: EncryptedBlob;
  ownerUserId: string;
}

export interface ConversationDetailResponse {
  conversation: MessageConversationData;
  keys: WrappedKeyPayload[];
  mySentCount: number;
}

export interface ConversationListItem {
  conversation: MessageConversationData;
  isNew: boolean;
  lastMessage: {
    ciphertext: string;
    createdAt: string;
    deletedAt: string | null;
    id: string;
    iv: string;
    ratchetIndex: number;
    senderId: string;
  } | null;
  unreadCount: number;
}

export interface ConversationListResponse {
  conversations: MessageConversationData[];
  hasMore: boolean;
  items: ConversationListItem[];
  nextCursor: string | null;
}

export interface SearchUserResult {
  avatarUrl: string | null;
  badge: string | null;
  badges: string[];
  displayName: string;
  hasIdentity: boolean;
  id: string;
  username: string;
}

export interface PresenceUser {
  avatarUrl: string | null;
  displayName: string;
  id: string;
  status: "idle" | "online";
  username: string;
}

export class MessagesApiError extends Error {
  readonly expectedIndex: number | undefined;
  readonly status: number;

  constructor(message: string, status: number, expectedIndex?: number) {
    super(message);
    this.name = "MessagesApiError";
    this.status = status;
    this.expectedIndex = expectedIndex;
  }
}

async function parseError(response: Response): Promise<MessagesApiError> {
  let message = `Request failed (${response.status})`;
  let expectedIndex: number | undefined;
  try {
    const body = (await response.json()) as {
      error?: string;
      expectedIndex?: number;
    };
    const { error: bodyError, expectedIndex: bodyExpectedIndex } = body;
    if (typeof bodyError === "string") {
      message = bodyError;
    }
    expectedIndex = bodyExpectedIndex;
  } catch {
    // fall through with the generic message
  }
  return new MessagesApiError(message, response.status, expectedIndex);
}

export async function fetchIdentity(): Promise<{
  identity: MessageIdentityPayload | null;
}> {
  const response = await fetch("/api/messages/identity", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as {
    identity: MessageIdentityPayload | null;
  };
}

export async function saveIdentity(payload: {
  encryptedPrivateKey: string;
  kdfIterations: number;
  masterKeyHash: string;
  publicKey: string;
  salt: string;
}): Promise<void> {
  const response = await fetch("/api/messages/identity", {
    body: JSON.stringify(payload),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw await parseError(response);
  }
}

export async function createConversation(
  recipientId: string
): Promise<{ conversation: MessageConversationData; isNew: boolean }> {
  const response = await fetch("/api/messages/conversations", {
    body: JSON.stringify({ recipientId }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as {
    conversation: MessageConversationData;
    isNew: boolean;
  };
}

export async function postConversationKeys(
  conversationId: string,
  keys: WrappedKeyPayload[]
): Promise<void> {
  const response = await fetch(
    `/api/messages/conversations/${conversationId}/keys`,
    {
      body: JSON.stringify({ keys }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
  if (!response.ok) {
    throw await parseError(response);
  }
}

export async function fetchConversationList(
  cursor?: string
): Promise<ConversationListResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`/api/messages/conversations${query}`, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as ConversationListResponse;
}

export async function fetchConversationDetail(
  conversationId: string
): Promise<ConversationDetailResponse> {
  const response = await fetch(
    `/api/messages/conversations/${conversationId}`,
    {
      credentials: "same-origin",
    }
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as ConversationDetailResponse;
}

export async function fetchMessages(
  conversationId: string,
  cursor?: string
): Promise<MessagePage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(
    `/api/messages/conversations/${conversationId}/messages${query}`,
    { credentials: "same-origin" }
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as MessagePage;
}

export interface MessageMediaUpload {
  height: number | null;
  kind: "gif" | "image";
  url: string;
  width: number | null;
}

export async function uploadMessageMedia(
  file: File,
  kind: "gif" | "image"
): Promise<MessageMediaUpload> {
  // Message attachments live inside E2EE ciphertext and can't be linked to a
  // post, so the pipeline skips post-linking; they still go through the full
  // scan -> publish lifecycle. The stored URL is the app proxy path, never a
  // raw object-storage address.
  const result = await uploadMediaFile(file, { purpose: "message" });
  if (result.status === "REJECTED") {
    throw new Error("Attachment was rejected by moderation scanning");
  }
  return {
    height: null,
    kind,
    url: `/api/media/${result.mediaId}`,
    width: null,
  };
}

export async function sendEncryptedMessage(
  conversationId: string,
  rootKey: Uint8Array,
  senderId: string,
  ratchetIndex: number,
  payload: MessagePayload
): Promise<MessageData> {
  const encrypted = await encryptMessage(
    rootKey,
    senderId,
    ratchetIndex,
    conversationId,
    payload
  );
  const response = await fetch(
    `/api/messages/conversations/${conversationId}/messages`,
    {
      body: JSON.stringify({
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        ratchetIndex: encrypted.ratchetIndex,
      }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  const json = (await response.json()) as { message: MessageData };
  return json.message;
}

export async function sendTypingIndicator(
  conversationId: string
): Promise<void> {
  try {
    await fetch(`/api/messages/conversations/${conversationId}/typing`, {
      credentials: "same-origin",
      method: "POST",
    });
  } catch {
    // Typing indicators are best-effort; a dropped heartbeat is harmless.
  }
}

export async function markConversationRead(
  conversationId: string
): Promise<void> {
  const response = await fetch(
    `/api/messages/conversations/${conversationId}/read`,
    { credentials: "same-origin", method: "POST" }
  );
  if (!response.ok) {
    throw await parseError(response);
  }
}

export async function deleteMessage(messageId: string): Promise<void> {
  const response = await fetch(`/api/messages/messages/${messageId}`, {
    credentials: "same-origin",
    method: "DELETE",
  });
  if (!response.ok) {
    throw await parseError(response);
  }
}

export async function searchMessageUsers(
  query: string
): Promise<SearchUserResult[]> {
  const response = await fetch(
    `/api/messages/search?q=${encodeURIComponent(query)}`,
    { credentials: "same-origin" }
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  const json = (await response.json()) as { users: SearchUserResult[] };
  return json.users;
}

export async function fetchPresenceUsers(): Promise<PresenceUser[]> {
  const response = await fetch("/api/messages/presence", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  const json = (await response.json()) as { users: PresenceUser[] };
  return json.users;
}

export async function heartbeatPresence(): Promise<void> {
  try {
    await fetch("/api/messages/presence", {
      credentials: "same-origin",
      method: "POST",
    });
  } catch {
    // Presence is best-effort; a failed heartbeat just means the user drops
    // off the online rail sooner.
  }
}

export async function fetchUnreadMessageCount(): Promise<number> {
  const response = await fetch("/api/messages/unread-count", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    return 0;
  }
  const json = (await response.json()) as { unreadCount: number };
  return json.unreadCount;
}

// Appends a message to the last page of an infinite-query message list unless
// it is already present. The sender folds the POST response into the cache and
// the SSE stream echoes the same message, so both paths must dedupe by id to
// avoid duplicate keys in the thread.
export function appendMessageToLastPage<
  T extends { id: string },
  P extends { messages: T[] },
>(pages: P[], message: T): P[] | null {
  const pagesCopy = [...pages];
  const lastPage = pagesCopy.at(-1);
  if (!lastPage || lastPage.messages.some((m) => m.id === message.id)) {
    return null;
  }
  pagesCopy[pagesCopy.length - 1] = {
    ...lastPage,
    messages: [...lastPage.messages, message],
  };
  return pagesCopy;
}

// Unwraps the root key of a conversation using the current user's private key
// and the other member's public key. Memoized per conversation so the
// expensive ECDH+HKDF only runs once per session.
export function createRootKeyStore(privateKey: CryptoKey) {
  const cache = new Map<string, Promise<Uint8Array>>();

  function getRootKey(
    conversationId: string,
    myWrappedKey: EncryptedBlob,
    peerPublicKeyBase64: string
  ): Promise<Uint8Array> {
    const cached = cache.get(conversationId);
    if (cached) {
      return cached;
    }
    const promise = (async () => {
      const peerPublicKey = await publicKeyBase64ToJwk(peerPublicKeyBase64);
      const peerKey = await importPublicKey(peerPublicKey);
      return unwrapRootKey(privateKey, peerKey, conversationId, myWrappedKey);
    })();
    cache.set(conversationId, promise);
    // A rejected derivation must not poison the cache forever: drop the entry
    // so a later call can retry, but only if this exact promise is still the
    // cached one (a newer retry may already have replaced it).
    void (async () => {
      try {
        await promise;
      } catch {
        if (cache.get(conversationId) === promise) {
          cache.delete(conversationId);
        }
      }
    })();
    return promise;
  }

  return { getRootKey };
}

// Wraps the root key for a peer during conversation creation.
export async function wrapRootKeyForPeer(
  myPrivateKey: CryptoKey,
  peerPublicKeyBase64: string,
  conversationId: string,
  rootKey: Uint8Array
): Promise<EncryptedBlob> {
  const peerPublicKey = await publicKeyBase64ToJwk(peerPublicKeyBase64);
  const peerKey = await importPublicKey(peerPublicKey);
  return wrapRootKey(myPrivateKey, peerKey, conversationId, rootKey);
}

function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
}

// Makes sure a conversation has wrapped root keys for both members, then
// returns the unwrapped root key. Handles the heal cases: a conversation
// created before this device had keys (both missing → generate + wrap both),
// or a crash that left only one member's key posted (unwrap mine → wrap for
// the peer). Idempotent: posting keys upserts.
export async function ensureConversationKeys(
  conversation: MessageConversationData,
  privateKey: CryptoKey,
  myUserId: string
): Promise<Uint8Array | null> {
  const peer = conversation.members.find(
    (member) => member.userId !== myUserId
  );
  const peerPublicKeyBase64 = peer?.user.messageIdentity?.publicKey;
  if (!peerPublicKeyBase64 || !peer) {
    return null;
  }
  const peerPublicKey = await publicKeyBase64ToJwk(peerPublicKeyBase64);
  const peerKey = await importPublicKey(peerPublicKey);

  const myKey = conversation.keys.find((key) => key.ownerUserId === myUserId);
  const peerKeyRow = conversation.keys.find(
    (key) => key.ownerUserId === peer.userId
  );

  if (myKey && peerKeyRow) {
    return unwrapRootKey(privateKey, peerKey, conversation.id, {
      ciphertext: myKey.encryptedKey,
      iv: myKey.iv,
    });
  }

  if (myKey) {
    const rootKey = await unwrapRootKey(privateKey, peerKey, conversation.id, {
      ciphertext: myKey.encryptedKey,
      iv: myKey.iv,
    });
    const wrappedForPeer = await wrapRootKey(
      privateKey,
      peerKey,
      conversation.id,
      rootKey
    );
    await postConversationKeys(conversation.id, [
      { encryptedKey: wrappedForPeer, ownerUserId: peer.userId },
    ]);
    return rootKey;
  }

  const rootKey = generateRootKey();
  // The wrap is symmetric (both members derive the same shared secret), so one
  // encrypted blob serves both entries - no need to derive and wrap twice.
  const wrapped = await wrapRootKey(
    privateKey,
    peerKey,
    conversation.id,
    rootKey
  );
  await postConversationKeys(conversation.id, [
    { encryptedKey: wrapped, ownerUserId: myUserId },
    { encryptedKey: wrapped, ownerUserId: peer.userId },
  ]);
  return rootKey;
}

export function decryptMessagePayload(
  rootKey: Uint8Array,
  senderId: string,
  conversationId: string,
  message: Pick<MessageData, "ciphertext" | "iv" | "ratchetIndex">
): Promise<MessagePayload> {
  return decryptMessage(rootKey, senderId, conversationId, message);
}
