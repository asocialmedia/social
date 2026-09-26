import type {
  MessageConversationData,
  MessageData,
  MessagePage,
} from "@asm/db";

import { uploadMediaFile } from "@/lib/media/media-upload-client";
import type { UploadStage } from "@/lib/media/media-upload-client";

import {
  decryptMessage,
  encryptMessage,
  generateRootKey,
  publicKeyBase64ToJwk,
  unwrapRootKey,
  wrapRootKey,
} from "./crypto";
import type { EncryptedBlob, EncryptedMessage, MessagePayload } from "./crypto";
import { HistoryThrottledError } from "./history-throttle";

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
  // Root-key epoch this wrap belongs to. Omitted on legacy payloads, which are
  // epoch 1.
  version?: number;
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
  let retryAfterSeconds: number | undefined;
  try {
    const body = (await response.json()) as {
      error?: string;
      expectedIndex?: number;
      retryAfterSeconds?: number;
    };
    const {
      error: bodyError,
      expectedIndex: bodyExpectedIndex,
      retryAfterSeconds: bodyRetryAfter,
    } = body;
    if (typeof bodyError === "string") {
      message = bodyError;
    }
    expectedIndex = bodyExpectedIndex;
    if (typeof bodyRetryAfter === "number") {
      retryAfterSeconds = bodyRetryAfter;
    }
  } catch {
    // fall through with the generic message
  }
  // A throttled history read is not a failure the caller should treat as fatal:
  // the backfill waits and retries the same page. Anything else stays a plain
  // MessagesApiError.
  if (response.status === 429) {
    const headerRetry = Number(response.headers.get("retry-after"));
    const wait =
      retryAfterSeconds ?? (Number.isFinite(headerRetry) ? headerRetry : 1);
    throw new HistoryThrottledError(wait);
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

// Drops this account's server-side identity and its own conversation-key wraps
// so the next bootstrap provisions a fresh keypair. The recovery path when the
// stored identity row can no longer be read on any device. Messages are
// untouched: the caller's pre-reset history becomes unreadable to them, while
// the peer's own wraps remain, so the peer keeps the full history. Callers must
// confirm with the user before invoking this.
export async function resetMessageIdentity(): Promise<void> {
  const response = await fetch("/api/messages/identity", {
    credentials: "same-origin",
    method: "DELETE",
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

// The three paging axes. Mutually exclusive server-side; each carries the id it
// pages from, so a caller can never build an ambiguous request.
//   - older:  `cursor` is the oldest id already loaded. Omitted means "the
//              newest page", which is how a transcript starts.
//   - around: a window centered on one message, for jumping into history.
//   - newer:  `cursor` is the newest id already loaded, growing upward.
// Per-request options. `signal` aborts the fetch: search jumps fire one anchored
// read per arrow press, and a press that supersedes the previous jump must not
// leave its slow request running behind the new one.
export interface FetchMessagesOptions {
  signal?: AbortSignal;
}

export type MessagePageAxis =
  // `walk` marks a search backfill paging through a whole conversation for
  // indexing. It changes nothing about the response, only which request budget
  // applies, so it lives on the axis the walker actually uses.
  | { cursor?: string; kind: "older"; walk?: boolean }
  | { kind: "around"; messageId: string }
  | { cursor: string; kind: "newer" };

export async function fetchMessages(
  conversationId: string,
  cursor?: string,
  limit?: number,
  options?: FetchMessagesOptions
): Promise<MessagePage>;
export async function fetchMessages(
  conversationId: string,
  axis: MessagePageAxis,
  limit?: number,
  options?: FetchMessagesOptions
): Promise<MessagePage>;
export async function fetchMessages(
  conversationId: string,
  axisOrCursor?: string | MessagePageAxis,
  limit?: number,
  options?: FetchMessagesOptions
): Promise<MessagePage> {
  const params = new URLSearchParams();
  if (typeof axisOrCursor === "string") {
    if (axisOrCursor) {
      params.set("cursor", axisOrCursor);
    }
  } else if (axisOrCursor) {
    switch (axisOrCursor.kind) {
      case "older": {
        if (axisOrCursor.cursor) {
          params.set("cursor", axisOrCursor.cursor);
        }
        if (axisOrCursor.walk) {
          params.set("walk", "1");
        }
        break;
      }
      case "around": {
        params.set("around", axisOrCursor.messageId);
        break;
      }
      case "newer": {
        params.set("after", axisOrCursor.cursor);
        break;
      }
      default: {
        // Exhaustiveness guard: a new axis variant must decide its query param
        // here rather than silently falling back to the newest page.
        break;
      }
    }
  }
  // Larger pages speed up full-history walks (in-conversation search indexing);
  // the server clamps to its own maximum.
  if (limit !== undefined) {
    params.set("limit", String(limit));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const response = await fetch(
    `/api/messages/conversations/${conversationId}/messages${query}`,
    { credentials: "same-origin", signal: options?.signal }
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as MessagePage;
}

export interface MessageMediaUpload {
  height: number | null;
  kind: "gif" | "image";
  mediaId: string;
  url: string;
  width: number | null;
}

export interface MessageMediaUploadOptions {
  // Fires as the bytes go up (0-100), letting the staging strip render a real
  // progress bar instead of a spinner.
  onProgress?: (percent: number) => void;
  // Fires as the pipeline advances through scan/process, so the tile can label
  // the current phase.
  onStage?: (stage: UploadStage) => void;
  // Reports the media id as soon as the server row exists, with `owned` false
  // when the row was reused via dedup (so callers know not to discard it).
  onMediaId?: (mediaId: string, meta: { owned: boolean }) => void;
  // Aborts the upload when the sender removes the attachment or unmounts.
  signal?: AbortSignal;
}

export async function uploadMessageMedia(
  file: File,
  kind: "gif" | "image",
  conversationId: string,
  options: MessageMediaUploadOptions = {}
): Promise<MessageMediaUpload> {
  // Message attachments live inside message ciphertext and can't be linked to a
  // post, so the pipeline skips post-linking; they still go through the full
  // scan -> publish lifecycle. The stored URL is the app proxy path, never a
  // raw object-storage address. The row is bound to the conversation so the
  // peer passes the serving gate; natural dimensions ride along in the
  // encrypted payload so receivers reserve the bubble box up front. The await
  // resolves only once the pipeline is READY: the serving route gates on that
  // status, so sending earlier would hand the peer a 404.
  const dimensions = await readImageDimensions(file);
  const result = await uploadMediaFile(file, {
    height: dimensions?.height ?? null,
    messageConversationId: conversationId,
    onMediaId: options.onMediaId,
    onProgress: options.onProgress,
    onStage: options.onStage,
    purpose: "message",
    signal: options.signal,
    width: dimensions?.width ?? null,
  });
  if (result.status === "REJECTED") {
    throw new Error("Attachment was rejected by moderation scanning");
  }
  return {
    height: dimensions?.height ?? null,
    kind,
    mediaId: result.mediaId,
    url: `/api/media/${result.mediaId}`,
    width: dimensions?.width ?? null,
  };
}

// Best-effort discard for a staged message attachment the sender removed before
// sending. The endpoint refuses rows the caller does not own, and detaches the
// conversation link so the cleanup job can reclaim the objects and quota.
// Failures are non-fatal: message media has no server-side abandoned-upload
// sweep (the pipeline cannot link ciphertext to a media row), so a discard that
// never reaches the server leaves the row orphaned.
export async function discardMessageMedia(mediaId: string): Promise<void> {
  try {
    await fetch(`/api/media/${mediaId}/message-discard`, {
      credentials: "same-origin",
      // keepalive lets the request survive a navigation/unmount, so a staged
      // attachment is still reclaimed when the sender leaves the thread.
      keepalive: true,
      method: "DELETE",
    });
  } catch {
    // Best-effort: a dropped discard request is not worth interrupting the UI.
  }
}

// Best-effort (re)bind for a message attachment the sender owns. Message media
// is bound to its thread at upload; rows created before that binding existed
// are unlinked, which leaves the uploader able to read them (unlinked rows are
// owner-readable) while the peer 404s on every fetch — a one-sided message.
// The sender's client is the only party that knows the media ids (they live
// inside the encrypted payload), so it re-asserts the link when it renders its own
// media message. Failures are non-fatal and retried on the next mount.
export async function linkMessageMedia(
  mediaId: string,
  conversationId: string
): Promise<boolean> {
  try {
    const response = await fetch(`/api/media/${mediaId}/message-link`, {
      body: JSON.stringify({ conversationId }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Natural image dimensions from the file's first frame, so the sender can
// encrypt them into the payload and receivers avoid layout shift. Null when
// the browser cannot decode the file; bubbles fall back to a fixed ratio.
async function readImageDimensions(
  file: File
): Promise<{ height: number; width: number } | null> {
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      const dimensions = { height: bitmap.height, width: bitmap.width };
      bitmap.close();
      if (dimensions.width > 0 && dimensions.height > 0) {
        return dimensions;
      }
    }
  } catch {
    // Decoding failures surface at upload/scan time; dimensions stay unknown.
  }
  return null;
}

// Re-encrypts an existing message under the exact root-key epoch it was
// originally written with, so an edit stays readable to the peer. The message
// row stores only the ratchet index, not the epoch, so the epoch is discovered
// by trial-decrypting the current ciphertext against each candidate root (the
// wrong epoch fails its AES-GCM tag cleanly). Returns null when none of the
// available roots can read the message — the caller then refuses the edit
// instead of writing ciphertext nobody, including the peer, could decrypt.
export async function reencryptMessageForEdit(params: {
  conversationId: string;
  current: EncryptedMessage;
  editedPayload: MessagePayload;
  rootKeys: Uint8Array[];
  senderId: string;
}): Promise<EncryptedMessage | null> {
  const { conversationId, current, editedPayload, rootKeys, senderId } = params;
  // oxlint-disable no-await-in-loop -- ordered epoch probe with early exit
  for (const rootKey of rootKeys) {
    try {
      // Prove this epoch owns the message before re-encrypting under it; the
      // wrong epoch fails the AES-GCM tag and falls through to the next.
      await decryptMessage(rootKey, senderId, conversationId, {
        ciphertext: current.ciphertext,
        iv: current.iv,
        ratchetIndex: current.ratchetIndex,
      });
    } catch {
      continue;
    }
    return await encryptMessage(
      rootKey,
      senderId,
      current.ratchetIndex,
      conversationId,
      editedPayload
    );
  }
  // oxlint-enable no-await-in-loop
  return null;
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

// "Delete for me": hide one or more messages from this account only. Batched so
// selecting a run of messages is one request. Returns how many were hidden
// (ids outside the conversation are ignored by the server).
export async function hideMessages(
  conversationId: string,
  messageIds: string[]
): Promise<number> {
  const response = await fetch(
    `/api/messages/conversations/${conversationId}/hide`,
    {
      body: JSON.stringify({ messageIds }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  const json = (await response.json()) as { hidden?: number };
  return json.hidden ?? 0;
}

// Reports that this browser received a peer message, moving the member's
// delivery watermark forward so the sender can show Delivered. Best-effort at
// the call site: a dropped ack is reconciled from the conversation detail.
export async function ackMessageDelivered(
  conversationId: string,
  messageId: string
): Promise<void> {
  const response = await fetch(
    `/api/messages/conversations/${conversationId}/delivered`,
    {
      body: JSON.stringify({ messageId }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
  if (!response.ok) {
    throw await parseError(response);
  }
}

// Rewrites a message's ciphertext in place (the server keeps the ratchet index,
// so the receiver re-decrypts the row instead of appending one). Returns the
// updated row so the caller can fold it into the transcript cache.
export async function editMessage(
  messageId: string,
  encrypted: Pick<EncryptedMessage, "ciphertext" | "iv">
): Promise<MessageData> {
  const response = await fetch(`/api/messages/messages/${messageId}`, {
    body: JSON.stringify({
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
    }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  const json = (await response.json()) as { message?: MessageData };
  if (!json.message) {
    throw new Error("Edit succeeded but no message was returned");
  }
  return json.message;
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

// Replaces an existing message row in place across an infinite-query page list,
// matching by id. Returns null when no page holds the id (an edit for a message
// this session has not loaded), so callers can skip a needless cache write.
// The edit never changes the row's position: the same id stays in the same
// slot, so virtualizer keys, order, and scroll anchoring are unaffected.
export function updateMessageInPages<
  T extends { id: string },
  P extends { messages: T[] },
>(pages: P[], message: T): P[] | null {
  let changed = false;
  const nextPages = pages.map((page) => {
    if (!page.messages.some((m) => m.id === message.id)) {
      return page;
    }
    changed = true;
    return {
      ...page,
      messages: page.messages.map((m) => (m.id === message.id ? message : m)),
    };
  });
  return changed ? nextPages : null;
}

// Removes one or more message rows across an infinite-query page list. Used by
// "delete for me", where the rows must disappear from the transcript entirely
// (not just be marked deleted). Returns null when nothing was present so
// callers can skip a needless cache write.
export function removeMessagesFromPages<
  T extends { id: string },
  P extends { messages: T[] },
>(pages: P[], ids: ReadonlySet<string>): P[] | null {
  let changed = false;
  const nextPages = pages.map((page) => {
    const messages = page.messages.filter((message) => !ids.has(message.id));
    if (messages.length === page.messages.length) {
      return page;
    }
    changed = true;
    return { ...page, messages };
  });
  return changed ? nextPages : null;
}

// Marks rows as globally deleted in place (the "delete for everyone" optimistic
// fold), keeping the same slot so virtualizer keys and scroll anchoring hold.
export function markMessagesDeletedInPages<
  T extends { deletedAt: Date | string | null; id: string },
  P extends { messages: T[] },
>(pages: P[], ids: ReadonlySet<string>, deletedAt: Date): P[] | null {
  let changed = false;
  const nextPages = pages.map((page) => {
    if (!page.messages.some((message) => ids.has(message.id))) {
      return page;
    }
    changed = true;
    return {
      ...page,
      messages: page.messages.map((message) =>
        ids.has(message.id) ? { ...message, deletedAt } : message
      ),
    };
  });
  return changed ? nextPages : null;
}

// Unwraps the root key of a conversation using the current user's private key
// and the other member's public key. Memoized per conversation so the
// expensive ECDH+HKDF only runs once per session.
export function createRootKeyStore(privateKey: CryptoKey) {
  // Keyed by conversation, holding the signature of the inputs that produced it.
  //
  // Keying on the conversation alone was wrong: a peer reset or a re-provisioned
  // identity publishes new wraps under the SAME conversation id, so the cached
  // roots were returned unchanged and decryption silently continued with
  // superseded keys. The thread already detects this (it recomputes a
  // keySignature of the wraps and the peer key), but it only clears the
  // decryptor's own cache, not this one, so the stale entry survived. Deriving
  // the cache key from the inputs makes invalidation self-healing instead of
  // depending on every call site remembering to clear.
  const cache = new Map<
    string,
    { promise: Promise<Uint8Array[]>; signature: string }
  >();

  // Unwraps every one of my wraps for the conversation, newest epoch first, so
  // a message sent under any epoch the member can still read is decryptable. A
  // wrap created for a superseded identity fails to unwrap (its ECDH pairing no
  // longer holds) and is dropped from the candidate list rather than failing the
  // whole set; only a conversation where nothing unwraps rejects.
  function getRootKeys(
    conversationId: string,
    myWrappedKeys: { encryptedKey: EncryptedBlob; version: number }[],
    peerPublicKeyBase64: string
  ): Promise<Uint8Array[]> {
    // The peer key is part of the signature because a new peer key produces
    // different ECDH results from the same wraps.
    const signature = `${myWrappedKeys
      .map(
        (wrapped) =>
          `${wrapped.version}:${wrapped.encryptedKey.ciphertext}:${wrapped.encryptedKey.iv}`
      )
      .join("|")}#${peerPublicKeyBase64}`;
    const cached = cache.get(conversationId);
    if (cached && cached.signature === signature) {
      return cached.promise;
    }
    const promise = (async () => {
      const peerPublicKey = await publicKeyBase64ToJwk(peerPublicKeyBase64);
      const peerKey = await importPublicKey(peerPublicKey);
      const ordered = [...myWrappedKeys].toSorted(
        (left, right) => right.version - left.version
      );
      // Independent unwraps, one per epoch: run them together and keep the ones
      // that succeed, dropping wraps left over from a superseded identity.
      const unwrapped = await Promise.all(
        ordered.map(async (wrapped) => {
          try {
            return await unwrapRootKey(
              privateKey,
              peerKey,
              conversationId,
              wrapped.encryptedKey
            );
          } catch {
            return null;
          }
        })
      );
      const roots = unwrapped.filter(
        (root): root is Uint8Array => root !== null
      );
      if (roots.length === 0) {
        throw new Error(
          `No unwrappable conversation key for ${conversationId}`
        );
      }
      return roots;
    })();
    // Replacing the entry rather than adding one keeps a conversation that
    // rotates repeatedly from growing the cache without bound.
    cache.set(conversationId, { promise, signature });
    // A rejected derivation must not poison the cache forever: drop the entry
    // so a later call can retry, but only if this exact promise is still the
    // cached one (a newer retry may already have replaced it).
    void (async () => {
      try {
        await promise;
      } catch {
        if (cache.get(conversationId)?.promise === promise) {
          cache.delete(conversationId);
        }
      }
    })();
    return promise;
  }

  return { getRootKeys };
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

// Signature of the material a key decision depends on: my wraps for the
// conversation (ciphertext per epoch) and the peer's identity public key. Used
// to tell a genuinely stale snapshot from an unchanged refetch, so a rotate
// cannot silently wrap for a peer key that has been superseded.
function conversationKeySignature(
  conversation: MessageConversationData,
  myUserId: string
): string {
  const wraps = conversation.keys
    .filter((key) => key.ownerUserId === myUserId)
    .map((key) => `${key.version ?? 1}:${key.encryptedKey}:${key.iv}`)
    .toSorted()
    .join("|");
  const peer = conversation.members.find(
    (member) => member.userId !== myUserId
  );
  return `${wraps}#${peer?.user.messageIdentity?.publicKey ?? ""}`;
}

// Unwraps the newest wrap this device can read, healing a missing peer wrap for
// that epoch. Returns null when nothing unwraps, which means the stored wraps
// belong to a superseded identity and the caller must rotate.
async function unwrapExistingKey(
  conversation: MessageConversationData,
  privateKey: CryptoKey,
  myUserId: string,
  peerUserId: string,
  peerKey: CryptoKey
): Promise<Uint8Array | null> {
  // Newest epoch first. The first wrap I can actually unwrap is my current
  // epoch; a wrap left over from a superseded identity simply fails to unwrap
  // and falls through. Sequential on purpose: each iteration's await depends on
  // the previous failure, and the first success exits the loop.
  const myKeys = conversation.keys
    .filter((key) => key.ownerUserId === myUserId)
    .toSorted((left, right) => (right.version ?? 1) - (left.version ?? 1));
  // oxlint-disable no-await-in-loop -- ordered epoch probe with early exit
  for (const myKey of myKeys) {
    let rootKey: Uint8Array;
    try {
      rootKey = await unwrapRootKey(privateKey, peerKey, conversation.id, {
        ciphertext: myKey.encryptedKey,
        iv: myKey.iv,
      });
    } catch {
      continue;
    }
    const version = myKey.version ?? 1;
    // Heal a missing peer wrap for this exact epoch (a crash between posting
    // the two entries, or a peer who has not fetched the rotation yet). The
    // wrap is symmetric, so one blob serves both entries.
    const peerHasEpoch = conversation.keys.some(
      (key) => key.ownerUserId === peerUserId && (key.version ?? 1) === version
    );
    if (!peerHasEpoch) {
      const wrappedForPeer = await wrapRootKey(
        privateKey,
        peerKey,
        conversation.id,
        rootKey
      );
      await postConversationKeys(conversation.id, [
        { encryptedKey: wrappedForPeer, ownerUserId: peerUserId, version },
      ]);
    }
    return rootKey;
  }
  // oxlint-enable no-await-in-loop
  return null;
}

// Rotates to a fresh epoch: a new root key wrapped for both members at the next
// version. Used when this device's identity changed (reset) and no stored wrap
// unwraps, so the peer's older wraps stay intact and keep their history.
async function rotateConversationEpoch(
  conversation: MessageConversationData,
  privateKey: CryptoKey,
  myUserId: string,
  peerUserId: string,
  peerKey: CryptoKey
): Promise<Uint8Array> {
  let maxVersion = 0;
  for (const key of conversation.keys) {
    maxVersion = Math.max(maxVersion, key.version ?? 1);
  }
  const nextVersion = maxVersion + 1;
  const rootKey = generateRootKey();
  const wrapped = await wrapRootKey(
    privateKey,
    peerKey,
    conversation.id,
    rootKey
  );
  await postConversationKeys(conversation.id, [
    { encryptedKey: wrapped, ownerUserId: myUserId, version: nextVersion },
    { encryptedKey: wrapped, ownerUserId: peerUserId, version: nextVersion },
  ]);
  return rootKey;
}

// Makes sure a conversation has wrapped root keys for both members, then
// returns the unwrapped root key. Handles the heal cases: a conversation
// created before this device had keys (both missing → generate + wrap both), a
// crash that left only one member's key posted (unwrap mine → wrap for the
// peer), and an identity reset (my old wraps no longer unwrap → rotate to a
// new epoch and wrap it for both). Idempotent: posting keys is append-only.
//
// `refreshConversation` is the stale-snapshot guard for the rotate case: when
// nothing unwraps we cannot tell "my identity reset" from "I am holding an
// outdated snapshot of a conversation the peer already rotated". Rotating on
// the latter would mint a fresh epoch wrapped for the peer's OLD public key,
// which they can never unwrap, so their new messages stay unreadable. When a
// refresh is supplied it is consulted once before rotating; if the key material
// changed, the freshest snapshot is used instead.
export async function ensureConversationKeys(
  conversation: MessageConversationData,
  privateKey: CryptoKey,
  myUserId: string,
  options?: {
    refreshConversation?: () => Promise<MessageConversationData | null>;
  }
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

  const existing = await unwrapExistingKey(
    conversation,
    privateKey,
    myUserId,
    peer.userId,
    peerKey
  );
  if (existing) {
    return existing;
  }

  // Nothing unwraps. Before rotating, confirm our snapshot is current.
  const refresh = options?.refreshConversation;
  if (refresh) {
    const before = conversationKeySignature(conversation, myUserId);
    const fresh = await refresh();
    if (fresh && conversationKeySignature(fresh, myUserId) !== before) {
      const freshPeer = fresh.members.find(
        (member) => member.userId !== myUserId
      );
      const freshPeerPublicKey = freshPeer?.user.messageIdentity?.publicKey;
      if (freshPeer && freshPeerPublicKey) {
        const freshPeerKey = await importPublicKey(
          await publicKeyBase64ToJwk(freshPeerPublicKey)
        );
        const healed = await unwrapExistingKey(
          fresh,
          privateKey,
          myUserId,
          freshPeer.userId,
          freshPeerKey
        );
        if (healed) {
          return healed;
        }
        // Still nothing on the freshest snapshot: rotate against it so the
        // peer wrap uses their current public key.
        return rotateConversationEpoch(
          fresh,
          privateKey,
          myUserId,
          freshPeer.userId,
          freshPeerKey
        );
      }
    }
  }

  return rotateConversationEpoch(
    conversation,
    privateKey,
    myUserId,
    peer.userId,
    peerKey
  );
}
