// Typed wrappers around the messages API plus the client-side crypto
// orchestration (unwrap a conversation key, encrypt a message), ported from
// apps/web/src/lib/messages/client.ts.
//
// WHAT CHANGED FROM WEB, AND WHY:
// - Web calls relative paths with `credentials: "same-origin"`. A device has no
//   origin, so every call takes the absolute base and the session travels as a
//   Cookie header via `withAuthHeaders`. Transport is injected (`baseFetch`), the
//   established convention across this app, so the whole file runs under
//   `bun test` with a stub fetch and no device.
// - `uploadMessageMedia` is absent. Media uploads already have a native
//   implementation in @/features/media-upload with the byte transport
//   (`new File(uri).upload`) that keeps file contents out of the JS heap, which
//   a fetch-with-Blob port would throw away. The messages client exposes
//   `linkMessageMedia`/`discardMessageMedia` because those are message-specific,
//   and the composer calls the native uploader with `purpose: "message"`.

import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { withAuthHeaders } from "@/lib/auth-headers";
import { getWithTimeout } from "@/lib/http-get";
import { orderedCopy } from "@/lib/ordered-copy";

import {
  encryptMessage,
  exportPrivateKeyJwk,
  publicKeyJwkToBase64,
  generateRootKey,
  publicKeyBase64ToJwk,
  importPublicKeyJwk,
  unwrapRootKey,
  wrapRootKey,
} from "./crypto";
import type { EncryptedBlob, EncryptedMessage, MessagePayload } from "./crypto";
import type { EcdhPrivateKey } from "./crypto-primitives";
import { HistoryThrottledError } from "./history-throttle";
import type {
  MessageConversationData,
  MessageData,
  MessagePage,
} from "./types";

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
  wrapperPublicKey?: string | null;
  wrapperUserId?: string | null;
  encryptedKey: EncryptedBlob;
  ownerUserId: string;
  // Root-key epoch this wrap belongs to. Omitted on legacy payloads, which are
  // epoch 1.
  version?: number;
}

export interface ConversationPrefs {
  wallpaperKey?: string | null;
  wallpaperDim?: number | null;
  wallpaperMediaId?: string | null;
  // ISO timestamp of when this member muted the thread, or null when not muted.
  // Preserved across re-mutes, so it reads as "muted since".
  mutedAt: string | null;
  themeKey: string | null;
}

export interface ConversationDetailResponse {
  conversation: MessageConversationData;
  keys: WrappedKeyPayload[];
  mySentCount: number;
  // The caller's own preferences for this conversation.
  prefs: ConversationPrefs;
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
  isFollowing?: boolean;
  status: "idle" | "online";
  username: string;
}

// A messages API failure. A stale install token is NOT modelled as its own error:
// `runWithInstallToken` recognises the server's `install-token-required` body and
// retries the request, so by the time an error reaches a caller it is a real
// failure rather than something the app can fix by asking again.
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

async function parseError(response: Response): Promise<Error> {
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
  // the loader waits and retries the same page.
  if (response.status === 429) {
    const headerRetry = Number(response.headers.get("retry-after"));
    const wait =
      retryAfterSeconds ?? (Number.isFinite(headerRetry) ? headerRetry : 1);
    throw new HistoryThrottledError(wait);
  }
  return new MessagesApiError(message, response.status, expectedIndex);
}

async function request<T>(
  path: string,
  options: ApiCallOptions,
  init?: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
    signal?: AbortSignal;
  }
): Promise<T> {
  const baseFetch = options.baseFetch ?? fetch;
  const url = `${options.apiBase}${path}`;
  const requestInit = {
    ...init,
    headers: withAuthHeaders(
      { "Content-Type": "application/json", ...init?.headers },
      options.cookie
    ),
  };
  // A cancellable history page owns its transport; aborting it must remain
  // independent of shared screen reads.
  const response =
    (init?.method ?? "GET") === "GET" && !init?.signal
      ? await getWithTimeout(url, requestInit, { baseFetch })
      : await baseFetch(url, requestInit);
  if (!response.ok) {
    throw await parseError(response);
  }
  // The mutation endpoints answer 200 with no body, so there is nothing to parse
  // and no value to hand back; `undefined as T` is the honest cast for that.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function fetchIdentity(
  options: ApiCallOptions
): Promise<{ identity: MessageIdentityPayload | null }> {
  return request("/api/messages/identity", options);
}

export async function saveIdentity(
  payload: {
    encryptedPrivateKey: string;
    kdfIterations: number;
    masterKeyHash: string;
    publicKey: string;
    salt: string;
  },
  options: ApiCallOptions
): Promise<void> {
  await request("/api/messages/identity", options, {
    body: JSON.stringify(payload),
    method: "POST",
  });
}

// Drops this account's server-side identity and its own conversation-key wraps so
// the next bootstrap provisions a fresh keypair. The recovery path when the stored
// identity row can no longer be read. Messages are untouched: the caller's
// pre-reset history becomes unreadable to them, while the peer's wraps remain.
export async function resetMessageIdentity(
  options: ApiCallOptions
): Promise<void> {
  await request("/api/messages/identity", options, { method: "DELETE" });
}

export function createConversation(
  recipientId: string,
  options: ApiCallOptions
): Promise<{ conversation: MessageConversationData; isNew: boolean }> {
  return request("/api/messages/conversations", options, {
    body: JSON.stringify({ recipientId }),
    method: "POST",
  });
}

export async function postConversationKeys(
  conversationId: string,
  keys: WrappedKeyPayload[],
  options: ApiCallOptions
): Promise<{ applied: number }> {
  const body = await request<{ applied?: number }>(
    `/api/messages/conversations/${conversationId}/keys`,
    options,
    { body: JSON.stringify({ keys }), method: "POST" }
  );
  return {
    applied: typeof body?.applied === "number" ? body.applied : keys.length,
  };
}

export function fetchConversationList(
  options: ApiCallOptions,
  cursor?: string
): Promise<ConversationListResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request(`/api/messages/conversations${query}`, options);
}

export function fetchConversationDetail(
  conversationId: string,
  options: ApiCallOptions
): Promise<ConversationDetailResponse> {
  return request(`/api/messages/conversations/${conversationId}`, options);
}

// Writes the caller's own DM preferences. Only the keys present in `prefs` are
// sent, so a mute toggle cannot clear the theme and a theme pick cannot unmute.
export async function updateConversationPrefs(
  conversationId: string,
  prefs: {
    muted?: boolean;
    themeKey?: string | null;
    wallpaperKey?: string | null;
    wallpaperDim?: number | null;
  },
  options: ApiCallOptions
): Promise<ConversationPrefs> {
  const body = await request<{ prefs: ConversationPrefs }>(
    `/api/messages/conversations/${conversationId}/prefs`,
    options,
    { body: JSON.stringify(prefs), method: "PATCH" }
  );
  return body.prefs;
}

// The three paging axes. Mutually exclusive server-side; each carries the id it
// pages from, so a caller can never build an ambiguous request.
//   - older:  `cursor` is the oldest id already loaded. Omitted means "the newest
//              page", which is how a transcript starts.
//   - around: a window centred on one message, for jumping into history.
//   - newer:  `cursor` is the newest id already loaded, growing upward.
export interface FetchMessagesOptions {
  signal?: AbortSignal;
}

export type MessagePageAxis =
  | { cursor?: string; kind: "older" }
  | { kind: "around"; messageId: string }
  | { cursor: string; kind: "newer" };

export function fetchMessages(
  conversationId: string,
  axis: MessagePageAxis | undefined,
  options: ApiCallOptions,
  limit?: number,
  fetchOptions?: FetchMessagesOptions
): Promise<MessagePage> {
  const params = new URLSearchParams();
  if (axis) {
    switch (axis.kind) {
      case "older": {
        if (axis.cursor) {
          params.set("cursor", axis.cursor);
        }
        break;
      }
      case "around": {
        params.set("around", axis.messageId);
        break;
      }
      case "newer": {
        params.set("after", axis.cursor);
        break;
      }
      default: {
        // Exhaustiveness guard: a new axis variant must decide its query param
        // here rather than silently falling back to the newest page.
        break;
      }
    }
  }
  if (limit !== undefined) {
    params.set("limit", String(limit));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request(
    `/api/messages/conversations/${conversationId}/messages${query}`,
    options,
    { signal: fetchOptions?.signal }
  );
}

// Best-effort discard for a staged attachment the sender removed before sending.
// The endpoint refuses rows the caller does not own, and detaches the conversation
// link so the cleanup job can reclaim the objects and quota.
export async function discardMessageMedia(
  mediaId: string,
  options: ApiCallOptions
): Promise<void> {
  try {
    await request(`/api/media/${mediaId}/message-discard`, options, {
      method: "DELETE",
    });
  } catch {
    // Best-effort: a dropped discard request is not worth interrupting the UI.
  }
}

// Best-effort (re)bind for an attachment the sender owns. Rows created before the
// conversation binding existed are unlinked, which leaves the uploader able to
// read them while the peer 404s on every fetch. The sender's client is the only
// party that knows the media ids (they live inside the encrypted payload).
export async function linkMessageMedia(
  mediaId: string,
  conversationId: string,
  options: ApiCallOptions
): Promise<boolean> {
  try {
    const body = await request<{ linked: boolean }>(
      `/api/media/${mediaId}/message-link`,
      options,
      { body: JSON.stringify({ conversationId }), method: "POST" }
    );
    return body.linked;
  } catch {
    return false;
  }
}

// Re-encrypts an existing message under the exact root-key epoch it was
// originally written with, so an edit stays readable to the peer. The row stores
// only the ratchet index, not the epoch, so the epoch is discovered by
// trial-decrypting against each candidate root (the wrong epoch fails its AES-GCM
// tag cleanly). Returns null when none can read the message, and the caller then
// refuses the edit instead of writing ciphertext nobody could decrypt.
export async function reencryptMessageForEdit(params: {
  conversationId: string;
  current: EncryptedMessage;
  editedPayload: MessagePayload;
  rootKeys: Uint8Array[];
  senderId: string;
}): Promise<EncryptedMessage | null> {
  const { conversationId, current, editedPayload, rootKeys, senderId } = params;
  const { decryptMessage } = await import("./crypto");
  // oxlint-disable no-await-in-loop -- ordered epoch probe with early exit
  for (const rootKey of rootKeys) {
    try {
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
  payload: MessagePayload,
  options: ApiCallOptions
): Promise<MessageData> {
  let index = ratchetIndex;
  for (let attempt = 0; ; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- a conflict must be re-encrypted at the authoritative index before retrying
      return await sendEncryptedMessageAtIndex(
        conversationId,
        rootKey,
        senderId,
        index,
        payload,
        options
      );
    } catch (error) {
      if (
        attempt >= 2 ||
        !(error instanceof MessagesApiError) ||
        error.status !== 409 ||
        !Number.isSafeInteger(error.expectedIndex) ||
        error.expectedIndex === undefined ||
        error.expectedIndex < 0
      ) {
        throw error;
      }
      index = error.expectedIndex;
    }
  }
}

async function sendEncryptedMessageAtIndex(
  conversationId: string,
  rootKey: Uint8Array,
  senderId: string,
  ratchetIndex: number,
  payload: MessagePayload,
  options: ApiCallOptions
): Promise<MessageData> {
  const encrypted = await encryptMessage(
    rootKey,
    senderId,
    ratchetIndex,
    conversationId,
    payload
  );
  const body = await request<{ message: MessageData }>(
    `/api/messages/conversations/${conversationId}/messages`,
    options,
    {
      body: JSON.stringify({
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        ratchetIndex: encrypted.ratchetIndex,
      }),
      method: "POST",
    }
  );
  if (!body.message?.id) {
    throw new Error(
      "The server did not acknowledge this message. Please retry."
    );
  }
  return body.message;
}

export async function sendTypingIndicator(
  conversationId: string,
  options: ApiCallOptions
): Promise<void> {
  try {
    await request(
      `/api/messages/conversations/${conversationId}/typing`,
      options,
      { method: "POST" }
    );
  } catch {
    // Typing indicators are best-effort; a dropped heartbeat is harmless.
  }
}

export async function markConversationRead(
  conversationId: string,
  options: ApiCallOptions
): Promise<void> {
  await request(`/api/messages/conversations/${conversationId}/read`, options, {
    method: "POST",
  });
}

export async function deleteMessage(
  messageId: string,
  options: ApiCallOptions
): Promise<void> {
  await request(`/api/messages/messages/${messageId}`, options, {
    method: "DELETE",
  });
}

// "Delete for me": hide one or more messages from this account only. Batched so
// selecting a run of messages is one request.
export async function hideMessages(
  conversationId: string,
  messageIds: string[],
  options: ApiCallOptions
): Promise<number> {
  const body = await request<{ hidden?: number }>(
    `/api/messages/conversations/${conversationId}/hide`,
    options,
    { body: JSON.stringify({ messageIds }), method: "POST" }
  );
  return body.hidden ?? 0;
}

// Reports that this client received a peer message, moving the member's delivery
// watermark forward so the sender can show Delivered. Best-effort at the call site.
export async function ackMessageDelivered(
  conversationId: string,
  messageId: string,
  options: ApiCallOptions
): Promise<void> {
  await request(
    `/api/messages/conversations/${conversationId}/delivered`,
    options,
    { body: JSON.stringify({ messageId }), method: "POST" }
  );
}

// Rewrites a message's ciphertext in place (the server keeps the ratchet index, so
// the receiver re-decrypts the row instead of appending one).
export async function editMessage(
  messageId: string,
  encrypted: Pick<EncryptedMessage, "ciphertext" | "iv">,
  options: ApiCallOptions
): Promise<MessageData> {
  const json = await request<{ message?: MessageData }>(
    `/api/messages/messages/${messageId}`,
    options,
    {
      body: JSON.stringify({
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
      }),
      method: "PATCH",
    }
  );
  if (!json.message) {
    throw new Error("Edit succeeded but no message was returned");
  }
  return json.message;
}

export async function searchMessageUsers(
  query: string,
  options: ApiCallOptions
): Promise<SearchUserResult[]> {
  const json = await request<{ users: SearchUserResult[] }>(
    `/api/messages/search?q=${encodeURIComponent(query)}`,
    options
  );
  return json.users;
}

export async function fetchPresenceUsers(
  options: ApiCallOptions
): Promise<PresenceUser[]> {
  const json = await request<{ users: PresenceUser[] }>(
    "/api/messages/presence",
    options
  );
  return json.users;
}

export async function heartbeatPresence(
  options: ApiCallOptions
): Promise<void> {
  try {
    await request("/api/messages/presence", options, { method: "POST" });
  } catch {
    // Best-effort; a failed heartbeat just means the user drops off the online
    // rail sooner.
  }
}

export async function fetchUnreadMessageCount(
  options: ApiCallOptions
): Promise<number> {
  const json = await request<{ unreadCount: number }>(
    "/api/messages/unread-count",
    options
  );
  return json.unreadCount;
}

// ---- cache reducers -----------------------------------------------------------

// Appends a message to the last page unless it is already present. The sender
// folds the POST response into its transcript and the SSE stream echoes the same
// message, so both paths must dedupe by id to avoid a duplicate row.
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

// Replaces an existing message row in place across a page list, matching by id.
// Returns null when no page holds the id (an edit for a message this session has
// not loaded). The edit never changes the row's position, so list keys, order and
// scroll anchoring are unaffected.
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

// Removes message rows across a page list ("delete for me"). Returns null when
// nothing was present so callers can skip a needless cache write.
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
// fold), keeping the same slot so keys and scroll anchoring hold.
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

// ---- conversation key orchestration ------------------------------------------

// Unwraps the root keys of a conversation using the current user's private key and
// the other member's public key. Memoized per conversation so the expensive
// ECDH+HKDF only runs once per session.
//
// Keyed on the conversation AND a signature of the material that produced it.
// Keying on the conversation alone was wrong: a peer reset or a re-provisioned
// identity publishes new wraps under the SAME conversation id, so the cached
// roots came back unchanged and decryption silently continued with superseded
// keys. Deriving the cache key from the inputs makes invalidation self-healing.
export function createRootKeyStore(privateKey: EcdhPrivateKey) {
  const cache = new Map<
    string,
    { promise: Promise<Uint8Array[]>; signature: string }
  >();

  function getRootKeys(
    conversationId: string,
    myWrappedKeys: {
      encryptedKey: EncryptedBlob;
      version: number;
      wrapperPublicKeyBase64?: string | null;
    }[],
    peerPublicKeyBase64: string
  ): Promise<Uint8Array[]> {
    // The peer key is part of the signature because a new peer key produces
    // different ECDH results from the same wraps.
    const signature = `${myWrappedKeys
      .map(
        (wrapped) =>
          `${wrapped.version}:${wrapped.encryptedKey.ciphertext}:${wrapped.encryptedKey.iv}:${wrapped.wrapperPublicKeyBase64 ?? ""}`
      )
      .join("|")}#${peerPublicKeyBase64}`;
    const cached = cache.get(conversationId);
    if (cached && cached.signature === signature) {
      return cached.promise;
    }
    const promise = (async () => {
      const ordered = orderedCopy(
        myWrappedKeys,
        (left, right) => right.version - left.version
      );
      // Independent unwraps, one per epoch: run them together and keep the ones
      // that succeed, dropping wraps left over from a superseded identity.
      const unwrapped = await Promise.all(
        ordered.map(async (wrapped) => {
          try {
            const pairing =
              wrapped.wrapperPublicKeyBase64 ?? peerPublicKeyBase64;
            if (!pairing) {
              return null;
            }
            return await unwrapRootKey(
              privateKey,
              importPublicKeyJwk(publicKeyBase64ToJwk(pairing)),
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
    // A rejected derivation must not poison the cache forever.
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
export function wrapRootKeyForPeer(
  myPrivateKey: EcdhPrivateKey,
  peerPublicKeyBase64: string,
  conversationId: string,
  rootKey: Uint8Array
): Promise<EncryptedBlob> {
  const peerKey = importPublicKeyJwk(publicKeyBase64ToJwk(peerPublicKeyBase64));
  return wrapRootKey(myPrivateKey, peerKey, conversationId, rootKey);
}

// Modern rows carry their wrapper's immutable public key; legacy DMs use the peer.
export function resolveMyConversationWraps(
  keys: readonly WrappedKeyPayload[],
  conversation: MessageConversationData,
  myUserId: string
) {
  return orderedCopy(
    keys
      .filter((key) => key.ownerUserId === myUserId)
      .map((key) => ({
        encryptedKey: key.encryptedKey,
        version: key.version ?? 1,
        wrapperPublicKeyBase64:
          key.wrapperPublicKey ||
          (key.wrapperUserId
            ? (conversation.members.find(
                (member) => member.userId === key.wrapperUserId
              )?.user.messageIdentity?.publicKey ?? null)
            : null),
      })),
    (left, right) => right.version - left.version
  );
}

export function toWrappedKeyPayloads(
  keys: readonly MessageConversationData["keys"][number][]
): WrappedKeyPayload[] {
  return keys.map((key) => ({
    encryptedKey: { ciphertext: key.encryptedKey, iv: key.iv },
    ownerUserId: key.ownerUserId,
    version: key.version,
    wrapperPublicKey: key.wrapperPublicKey,
    wrapperUserId: key.wrapperUserId,
  }));
}

function canHealMemberEpoch(
  conversation: MessageConversationData,
  memberId: string,
  version: number
): boolean {
  if (conversation.type !== "DEN") {
    return true;
  }
  if (!conversation.keys.some((key) => key.ownerUserId === memberId)) {
    return false;
  }
  const times = conversation.keys
    .filter((key) => key.version === version)
    .map((key) => Date.parse(key.createdAt));
  if (times.length === 0 || times.some((time) => !Number.isFinite(time))) {
    return false;
  }
  const epochStart = Math.min(...times);
  return (
    conversation.members
      .find((member) => member.userId === memberId)
      ?.membershipWindows?.some((window) => {
        const after = window.after ? Date.parse(window.after) : Number.NaN;
        const before = window.before
          ? Date.parse(window.before)
          : Number.POSITIVE_INFINITY;
        return (
          Number.isFinite(after) && epochStart > after && epochStart < before
        );
      }) ?? false
  );
}

// Read the current roster before every write; never send under an epoch held by departed members.
export async function ensureConversationKeys(
  conversation: MessageConversationData,
  privateKey: EcdhPrivateKey,
  myUserId: string,
  options: {
    postKeys: (
      conversationId: string,
      keys: WrappedKeyPayload[]
    ) => Promise<void> | Promise<{ applied: number }>;
    refreshConversation?: () => Promise<MessageConversationData | null>;
  }
): Promise<Uint8Array | null> {
  const current = options.refreshConversation
    ? await options.refreshConversation()
    : conversation;
  if (!current) {
    return null;
  }
  const active = current.members.filter((member) => !member.leftAt);
  if (!active.some((member) => member.userId === myUserId)) {
    return null;
  }
  const peerPublic =
    current.type === "DEN"
      ? null
      : active.find((member) => member.userId !== myUserId)?.user
          .messageIdentity?.publicKey;
  if (current.type !== "DEN" && !peerPublic) {
    return null;
  }
  let newest = 0;
  for (const key of current.keys) {
    newest = Math.max(newest, key.version ?? 1);
  }
  const mine = resolveMyConversationWraps(
    toWrappedKeyPayloads(current.keys),
    current,
    myUserId
  );
  let root: Uint8Array | null = null;
  for (const wrap of mine.filter((entry) => entry.version === newest)) {
    const pairing = wrap.wrapperPublicKeyBase64 ?? peerPublic;
    if (!pairing) {
      continue;
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- probe the current epoch until an authenticated unwrap succeeds
      root = await unwrapRootKey(
        privateKey,
        importPublicKeyJwk(publicKeyBase64ToJwk(pairing)),
        current.id,
        wrap.encryptedKey
      );
      break;
    } catch {
      // Superseded identity wraps do not prevent recovery from another valid wrap.
    }
  }
  const holders = current.keys.filter((key) => key.version === newest);
  const missing = active.filter(
    (member) => !holders.some((key) => key.ownerUserId === member.userId)
  );
  const contaminated = holders.some(
    (key) => !active.some((member) => member.userId === key.ownerUserId)
  );
  const rotate =
    !root ||
    contaminated ||
    missing.some(
      (member) => !canHealMemberEpoch(current, member.userId, newest)
    );
  const recipients = rotate ? active : missing;
  if (recipients.length === 0 && root) {
    return root;
  }
  const version = rotate ? newest + 1 : newest;
  const rootKey = rotate ? generateRootKey() : root;
  if (!rootKey) {
    return null;
  }
  const selfPublic = publicKeyJwkToBase64(exportPrivateKeyJwk(privateKey));
  const wrapped = await Promise.all(
    recipients.map(async (member): Promise<WrappedKeyPayload | null> => {
      const pairing =
        member.userId === myUserId
          ? selfPublic
          : member.user.messageIdentity?.publicKey;
      if (!pairing) {
        return null;
      }
      return {
        encryptedKey: await wrapRootKey(
          privateKey,
          importPublicKeyJwk(publicKeyBase64ToJwk(pairing)),
          current.id,
          rootKey
        ),
        ownerUserId: member.userId,
        version,
        wrapperPublicKey: selfPublic,
        wrapperUserId: myUserId,
      };
    })
  );
  const keys = wrapped.filter((key): key is WrappedKeyPayload => key !== null);
  if (!keys.some((key) => key.ownerUserId === myUserId) && rotate) {
    return null;
  }
  if (keys.length > 0) {
    const written = await options.postKeys(current.id, keys);
    if (written?.applied === 0) {
      const fresh = await options.refreshConversation?.();
      return fresh
        ? ensureConversationKeys(fresh, privateKey, myUserId, {
            postKeys: options.postKeys,
          })
        : null;
    }
  }
  return rootKey;
}

export function createDen(
  input: {
    name: string;
    description?: string;
    memberIds: string[];
    avatarMediaId?: string | null;
  },
  options: ApiCallOptions
): Promise<{
  conversation: MessageConversationData;
  inviteCode: string;
  inviteShortCode: string;
  isNew: boolean;
}> {
  return request("/api/messages/conversations", options, {
    body: JSON.stringify({ ...input, type: "DEN" }),
    method: "POST",
  });
}
export interface DenInvitePreview {
  den: {
    id: string;
    name: string | null;
    memberCount: number;
    avatarMediaId?: string | null;
    ownerId?: string | null;
  };
  expired?: boolean;
  isBanned?: boolean;
  isMember: boolean;
}
export function fetchDenInvitePreview(
  code: string,
  options: ApiCallOptions
): Promise<DenInvitePreview> {
  return request(
    `/api/messages/dens/join/${encodeURIComponent(code)}`,
    options
  );
}
export function joinDen(
  code: string,
  options: ApiCallOptions
): Promise<{ alreadyMember: boolean; conversationId: string }> {
  return request(
    `/api/messages/dens/join/${encodeURIComponent(code)}`,
    options,
    { method: "POST" }
  );
}
export function leaveDen(
  conversationId: string,
  options: ApiCallOptions
): Promise<void> {
  return request(
    `/api/messages/dens/${encodeURIComponent(conversationId)}/leave`,
    options,
    { method: "POST" }
  );
}

export interface ConversationSearchPage {
  hits: { id: string; revision: number; createdAt: string; senderId: string }[];
  nextCursor: string | null;
  previousCursor: string | null;
  totalMatches: number | null;
  coverage: {
    complete: boolean;
    settled: boolean;
    unrecoverableEpochs: number;
  };
}
export function searchConversationHistory(
  conversationId: string,
  input: { query: string; cursor?: string },
  options: ApiCallOptions,
  signal?: AbortSignal
): Promise<ConversationSearchPage> {
  return request(
    `/api/messages/conversations/${encodeURIComponent(conversationId)}/search`,
    options,
    { body: JSON.stringify(input), method: "POST", signal }
  );
}
export function hydrateSearchHits(
  conversationId: string,
  hits: { id: string; revision: number }[],
  options: ApiCallOptions,
  signal?: AbortSignal
): Promise<{
  messages: MessageData[];
  unavailableIds: string[];
  deferredIds: string[];
}> {
  if (hits.length === 0) {
    return Promise.resolve({
      deferredIds: [],
      messages: [],
      unavailableIds: [],
    });
  }
  return request(
    `/api/messages/conversations/${encodeURIComponent(conversationId)}/messages/batch`,
    options,
    { body: JSON.stringify({ messages: hits }), method: "POST", signal }
  );
}

export interface DenInformation {
  canManage: boolean;
  den: {
    name: string | null;
    description: string | null;
    avatarMediaId: string | null;
    memberCount: number;
    inviteCode: string | null;
    inviteShortCode: string | null;
    ownerId: string | null;
  };
  membership: { role: "OWNER" | "ADMIN" | "MEMBER" };
}
export function fetchDenInformation(
  id: string,
  options: ApiCallOptions
): Promise<DenInformation> {
  return request(`/api/messages/dens/${encodeURIComponent(id)}`, options);
}
export function updateDenDetails(
  id: string,
  input: {
    name?: string;
    description?: string | null;
    avatarMediaId?: string | null;
  },
  options: ApiCallOptions
): Promise<void> {
  return request(`/api/messages/dens/${encodeURIComponent(id)}`, options, {
    body: JSON.stringify(input),
    method: "PATCH",
  });
}

export function changeDenMember(
  id: string,
  input: {
    userId: string;
    action:
      | "add"
      | "remove"
      | "ban"
      | "unban"
      | "promote"
      | "demote"
      | "transfer";
  },
  options: ApiCallOptions
): Promise<void> {
  const base = `/api/messages/dens/${encodeURIComponent(id)}`;
  const { action, userId } = input;
  if (action === "remove" || action === "unban") {
    return request(
      `${base}/${action === "remove" ? "members" : "bans"}/${encodeURIComponent(userId)}`,
      options,
      { method: "DELETE" }
    );
  }
  const route = {
    add: "members",
    ban: "bans",
    demote: "role",
    promote: "role",
    transfer: "transfer",
  }[action];
  let body:
    | { memberIds: string[] }
    | { userId: string; role?: "ADMIN" | "MEMBER" } = { userId };
  if (action === "add") {
    body = { memberIds: [userId] };
  }
  if (action === "promote" || action === "demote") {
    body = { role: action === "promote" ? "ADMIN" : "MEMBER", userId };
  }
  return request(`${base}/${route}`, options, {
    body: JSON.stringify(body),
    method: "POST",
  });
}

export function fetchDenBans(
  id: string,
  options: ApiCallOptions
): Promise<{
  bans: {
    id: string;
    displayName: string | null;
    username: string | null;
    reason: string | null;
  }[];
}> {
  return request(`/api/messages/dens/${encodeURIComponent(id)}/bans`, options);
}

export function renewDenInvite(
  id: string,
  kind: "link" | "code",
  durationDays: number | null,
  options: ApiCallOptions
): Promise<void> {
  return request(
    `/api/messages/dens/${encodeURIComponent(id)}/${kind === "link" ? "invite" : "invite-code"}`,
    options,
    { body: JSON.stringify({ durationDays }), method: "POST" }
  );
}

export function dissolveDen(
  id: string,
  options: ApiCallOptions
): Promise<void> {
  return request(`/api/messages/dens/${encodeURIComponent(id)}`, options, {
    method: "DELETE",
  });
}
export interface SharedConversationPage {
  items: {
    kind: "media" | "post" | "link";
    messageId: string;
    ordinal: number;
    requiredId: string | null;
    revision: number;
    createdAt: string;
    senderId: string;
  }[];
  nextCursor: string | null;
  coverageComplete: boolean;
  coverageSettled: boolean;
}
export function fetchSharedConversationItems(
  id: string,
  kind: "media" | "post" | "link",
  options: ApiCallOptions,
  cursor?: string,
  signal?: AbortSignal
): Promise<SharedConversationPage> {
  const query = new URLSearchParams({
    kind,
    limit: "20",
    ...(cursor ? { cursor } : {}),
  });
  return request(
    `/api/messages/conversations/${encodeURIComponent(id)}/shared?${query}`,
    options,
    { signal }
  );
}
export function setConversationWallpaperUpload(
  id: string,
  mediaId: string | null,
  options: ApiCallOptions
): Promise<{ prefs: ConversationPrefs }> {
  return request(
    `/api/messages/conversations/${encodeURIComponent(id)}/wallpaper`,
    options,
    {
      method: mediaId ? "POST" : "DELETE",
      ...(mediaId ? { body: JSON.stringify({ mediaId }) } : {}),
    }
  );
}
