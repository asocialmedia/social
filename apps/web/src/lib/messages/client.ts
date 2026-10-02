import type { DenRole } from "@asm/db";

import { uploadMediaFile } from "@/lib/media/media-upload-client";
import type { UploadStage } from "@/lib/media/media-upload-client";
import type {
  MessageConversationData,
  MessageConversationKey,
  MessageData,
  MessagePage,
} from "@/lib/messages/types";

import {
  decryptMessage,
  encryptMessage,
  generateRootKey,
  publicKeyBase64ToJwk,
  selfPublicKeyBase64,
  unwrapRootKey,
  wrapRootKeyForMembers,
} from "./crypto";
import type {
  EncryptedBlob,
  EncryptedMessage,
  MessagePayload,
  WrapRecipient,
} from "./crypto";
import { HistoryThrottledError } from "./history-throttle";
import {
  applyMembershipSeq,
  lastAppliedMembershipSeq,
  readMembershipSeq,
} from "./membership-seq";

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
  // The member who performed this wrap and the public key they used, as stored on
  // the row. Null on every DM row written before these columns existed, where
  // the wrapper is unambiguously the single peer, and on any den row written by a
  // client too old to name itself.
  wrapperPublicKey?: string | null;
  wrapperUserId?: string | null;
}

// One of my wraps, paired with the public key it was actually made against.
//
// `wrapperPublicKeyBase64` is null when the row names no wrapper (a DM, where
// the caller supplies the peer key instead) and when a den row names a wrapper
// who cannot be paired at all — they left the den before their key was
// snapshotted, so there is nothing left to pair with. Such a wrap is dropped
// rather than paired with a guess.
export interface ConversationWrap {
  encryptedKey: EncryptedBlob;
  version: number;
  wrapperPublicKeyBase64: string | null;
}

export interface ConversationPrefs {
  // ISO timestamp of when this member muted the thread, or null when not muted.
  // Preserved across re-mutes, so it reads as "muted since".
  mutedAt: string | null;
  // Chat theme key, or null for the app default.
  themeKey: string | null;
  // How dark the wallpaper is painted, 0-100, or null for the app default.
  // A plain percentage rather than an index into a table of named stops, so the
  // member can pick any level and the thumb, the level label and the overlay the
  // thread paints are all just this one number.
  wallpaperDim: number | null;
  // Chat wallpaper key, or null for the app default. Mutually exclusive with
  // `wallpaperMediaId`: setting one clears the other, so "which wallpaper" is
  // answered by whichever is non-null.
  wallpaperKey: string | null;
  // The member's own uploaded wallpaper, or null. Wins over `wallpaperKey` if
  // both are somehow set.
  wallpaperMediaId: string | null;
}

export interface ConversationDetailResponse {
  conversation: MessageConversationData;
  keys: WrappedKeyPayload[];
  mySentCount: number;
  // The caller's own preferences for this conversation. Separate from the
  // member list so no consumer has to pick "my" row out of a two-element array.
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
  status: "idle" | "online";
  username: string;
}

export class MessagesApiError extends Error {
  // A den route's domain outcome, forwarded verbatim. The status cannot always
  // carry it: several codes share a status - 400 is INVALID_INPUT, INVALID_ROLE
  // and MEMBERS_REQUIRED, and 409 is ALREADY_MEMBER, LIMIT_REACHED, NOT_A_DEN and
  // SELF_ACTION - so a client that wants copy specific to one of them has nothing
  // to branch on without the code. (It is not carried by the STATUS any more than
  // it used to be: BLOCKED and FORBIDDEN shared a 403 once, but there is no
  // BLOCKED code any more, because a block is a DM-only rule and a den admits
  // regardless of it. 400 and 409 still carry the argument.) Optional because the
  // DM routes never write one and a caller must not have to check.
  readonly code: string | undefined;
  readonly expectedIndex: number | undefined;
  readonly status: number;

  constructor(
    message: string,
    status: number,
    expectedIndex?: number,
    code?: string
  ) {
    super(message);
    this.name = "MessagesApiError";
    this.status = status;
    this.expectedIndex = expectedIndex;
    this.code = code;
  }
}

// The error fields every route writes, read once so the two parsers below cannot
// drift on which body fields they honour.
interface ApiErrorBody {
  code?: string;
  error?: string;
  expectedIndex?: number;
  retryAfterSeconds?: number;
}

interface ParsedErrorBody {
  code: string | undefined;
  expectedIndex: number | undefined;
  message: string;
  retryAfterSeconds: number | undefined;
}

async function readErrorBody(response: Response): Promise<ParsedErrorBody> {
  let code: string | undefined;
  let message = `Request failed (${response.status})`;
  let expectedIndex: number | undefined;
  let retryAfterSeconds: number | undefined;
  try {
    const body = (await response.json()) as ApiErrorBody;
    const {
      code: bodyCode,
      error: bodyError,
      expectedIndex: bodyExpectedIndex,
      retryAfterSeconds: bodyRetryAfter,
    } = body;
    if (typeof bodyCode === "string") {
      code = bodyCode;
    }
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
  return { code, expectedIndex, message, retryAfterSeconds };
}

// Seconds to wait after a 429: the route's own field when it sent one, then the
// header, then one second.
function retryAfterWait(body: number | undefined, response: Response): number {
  const headerRetry = Number(response.headers.get("retry-after"));
  return body ?? (Number.isFinite(headerRetry) ? headerRetry : 1);
}

async function parseError(response: Response): Promise<MessagesApiError> {
  const body = await readErrorBody(response);
  // A throttled history read is not a failure the caller should treat as fatal:
  // the backfill waits and retries the same page. Anything else stays a plain
  // MessagesApiError.
  if (response.status === 429) {
    throw new HistoryThrottledError(
      retryAfterWait(body.retryAfterSeconds, response)
    );
  }
  return new MessagesApiError(
    body.message,
    response.status,
    body.expectedIndex
  );
}

// A den route's 429 is a refusal the caller has to handle, not a backfill pause:
// a throttled add-members or invite rotation has to surface as something the
// member reads. Same body and status as the history read, different consequence,
// so it stays a MessagesApiError instead of becoming the backfill's retry signal.
// The server already writes these refusals for a human, and the dialogs show the
// message verbatim.
//
// The `code` comes along for the same reason the message does, and because
// several refusals share a status - 400 and 409 each cover four or five codes -
// so a caller that wants copy specific to one of them has to read which one this
// was. See the comment on the field above.
async function parseDenError(response: Response): Promise<MessagesApiError> {
  const body = await readErrorBody(response);
  return new MessagesApiError(
    body.message,
    response.status,
    body.expectedIndex,
    body.code
  );
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
  const body = (await response.json()) as {
    conversation: MessageConversationData;
    isNew: boolean;
  };
  noteConversationUpdatedAt(body.conversation);
  noteConversationMembershipSeq(body.conversation);
  return body;
}

// A den (group conversation). The same route as a DM, discriminated by `type`, so
// the response lands on the same conversation cache entry the thread already
// reads and the client lands on the same `?c=<id>` deep link.
//
// `inviteCode` is the door, and it comes back exactly once: at creation. The
// details route withholds it from anybody who is not a manager, so the creator
// is the only one who ever sees this value from this call.
export async function createDen(input: {
  avatarMediaId?: string | null;
  description?: string | null;
  memberIds: string[];
  name: string;
}): Promise<{
  conversation: MessageConversationData;
  inviteCode: string;
  isNew: boolean;
}> {
  const response = await fetch("/api/messages/conversations", {
    body: JSON.stringify({
      // The explicit discriminator, so a malformed DM body can never be read as a
      // request for a group.
      type: "DEN",
      ...(input.avatarMediaId === undefined
        ? {}
        : { avatarMediaId: input.avatarMediaId }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      memberIds: input.memberIds,
      name: input.name,
    }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw await parseDenError(response);
  }
  const body = (await response.json()) as {
    conversation: MessageConversationData;
    inviteCode: string;
    isNew: boolean;
  };
  // Recorded like a DM read, because a create is a membership mutation too: the
  // stale-snapshot guard in ensureConversationKeys has to know the server has
  // already moved this conversation row forward.
  noteConversationUpdatedAt(body.conversation);
  noteConversationMembershipSeq(body.conversation);
  return body;
}

// One member of a den roster, as the members route reports it. Deliberately not
// MessageSender: the roster carries display fields only, because the details
// panel draws names and roles and never needs a member's message identity (the
// root-key fan-out reads those off the conversation payload the thread holds).
export interface DenMember {
  avatarUrl: string | null;
  badge: string | null;
  badges: string[];
  displayName: string;
  id: string;
  // Absent for the creator and for anybody who arrived through an invite link.
  invitedById: string | null;
  role: DenRole;
  username: string;
}

// The den's own shape for the details panel: who may manage it, what it is
// called, and the caller's role so the panel can decide which affordances to
// render without a second call.
//
// `inviteCode` is null for anybody who is not a manager. That is the server's
// decision and it is the right one, so the client renders the invite controls
// only when both the code and `canManage` are present.
export interface DenDetailResponse {
  canManage: boolean;
  den: {
    avatarMediaId: string | null;
    description: string | null;
    inviteCode: string | null;
    memberCount: number;
    name: string | null;
    ownerId: string | null;
  };
  membership: { role: DenRole };
}

export async function fetchDen(
  conversationId: string
): Promise<DenDetailResponse> {
  const response = await fetch(`/api/messages/dens/${conversationId}`, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw await parseDenError(response);
  }
  return (await response.json()) as DenDetailResponse;
}

// Renames a den, changes its description, or swaps its avatar. The fields are
// independent, matching the route: an absent key is left alone, and an explicit
// null clears. So a rename must send only `name`, never the description it did
// not mean to change.
export async function updateDenDetails(
  conversationId: string,
  input: {
    avatarMediaId?: string | null;
    description?: string | null;
    name?: string;
  }
): Promise<void> {
  const response = await fetch(`/api/messages/dens/${conversationId}`, {
    body: JSON.stringify(input),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
  if (!response.ok) {
    throw await parseDenError(response);
  }
}

// The roster, owner first. `limit` is the route's own page size; it defaults
// server-side to 50 and is capped at DEN_LIMITS.membersMax, so a den can never
// page more than it holds.
export async function fetchDenMembers(
  conversationId: string,
  limit?: number
): Promise<DenMember[]> {
  const query =
    limit === undefined ? "" : `?limit=${encodeURIComponent(String(limit))}`;
  const response = await fetch(
    `/api/messages/dens/${conversationId}/members${query}`,
    { credentials: "same-origin" }
  );
  if (!response.ok) {
    throw await parseDenError(response);
  }
  const body = (await response.json()) as { members: DenMember[] };
  return body.members;
}

// Adds members. Returns the ids actually added rather than the ids requested:
// the root key has to be rotated for exactly those, and a client that asked for
// five and got three needs to know which three.
export async function addDenMembers(
  conversationId: string,
  memberIds: string[]
): Promise<string[]> {
  const response = await fetch(`/api/messages/dens/${conversationId}/members`, {
    body: JSON.stringify({ memberIds }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw await parseDenError(response);
  }
  const body = (await response.json()) as { added?: string[] };
  return body.added ?? [];
}

export async function removeDenMember(
  conversationId: string,
  userId: string
): Promise<void> {
  const response = await fetch(
    `/api/messages/dens/${conversationId}/members/${encodeURIComponent(userId)}`,
    { credentials: "same-origin", method: "DELETE" }
  );
  if (!response.ok) {
    throw await parseDenError(response);
  }
}

// Only ADMIN and MEMBER are assignable. Ownership moves by leaving or by
// dissolving and never by promotion, so the UI offers no promote-to-owner and
// the route refuses one.
export async function setDenMemberRole(
  conversationId: string,
  userId: string,
  role: "ADMIN" | "MEMBER"
): Promise<void> {
  const response = await fetch(`/api/messages/dens/${conversationId}/role`, {
    body: JSON.stringify({ role, userId }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw await parseDenError(response);
  }
}

// Leaves. The response says what happened to the den, because the caller's next
// move depends on it: a dissolved den has nowhere to navigate back to, while a
// transferred one stays open under somebody else's ownership.
export async function leaveDen(conversationId: string): Promise<{
  dissolved: boolean;
  newOwnerId: string | null;
}> {
  const response = await fetch(`/api/messages/dens/${conversationId}/leave`, {
    credentials: "same-origin",
    method: "POST",
  });
  if (!response.ok) {
    throw await parseDenError(response);
  }
  const body = (await response.json()) as {
    dissolved?: boolean;
    newOwnerId?: string | null;
  };
  return {
    dissolved: body.dissolved === true,
    newOwnerId: body.newOwnerId ?? null,
  };
}

// Dissolves the den outright. Owner only, and the one operation here that is
// not undoable, which is why its confirmation is its own dialog.
export async function dissolveDen(conversationId: string): Promise<void> {
  const response = await fetch(`/api/messages/dens/${conversationId}/leave`, {
    credentials: "same-origin",
    method: "DELETE",
  });
  if (!response.ok) {
    throw await parseDenError(response);
  }
}

// Retires the current join code and mints a new one. The old code stops
// resolving the moment this returns, which is the revocation step for a code
// that leaked into a screenshot or a forwarded thread.
export async function rotateDenInvite(conversationId: string): Promise<string> {
  const response = await fetch(`/api/messages/dens/${conversationId}/invite`, {
    credentials: "same-origin",
    method: "POST",
  });
  if (!response.ok) {
    throw await parseDenError(response);
  }
  const body = (await response.json()) as { inviteCode?: string };
  if (!body.inviteCode) {
    throw new Error("The new join link did not come back");
  }
  return body.inviteCode;
}

// What a join link shows before anybody commits to it: the den's name, how many
// people are in it, and whether the viewer is already one of them. Nothing
// else, because possession of a code is not a reason to enumerate a roster.
export interface DenInvitePreviewResponse {
  den: { id: string; memberCount: number; name: string | null };
  isMember: boolean;
}

export async function fetchDenInvitePreview(
  code: string
): Promise<DenInvitePreviewResponse> {
  const response = await fetch(
    `/api/messages/dens/join/${encodeURIComponent(code)}`,
    { credentials: "same-origin" }
  );
  if (!response.ok) {
    throw await parseDenError(response);
  }
  return (await response.json()) as DenInvitePreviewResponse;
}

// Joins through an invite code. `alreadyMember` is a success, not a failure: a
// re-opened link navigates without an error toast.
export async function joinDen(
  code: string
): Promise<{ alreadyMember: boolean; conversationId: string }> {
  const response = await fetch(
    `/api/messages/dens/join/${encodeURIComponent(code)}`,
    { credentials: "same-origin", method: "POST" }
  );
  if (!response.ok) {
    throw await parseDenError(response);
  }
  const body = (await response.json()) as {
    alreadyMember?: boolean;
    conversationId?: string;
  };
  if (!body.conversationId) {
    throw new Error("The den joined but no conversation came back");
  }
  return {
    alreadyMember: body.alreadyMember === true,
    conversationId: body.conversationId,
  };
}

// Posts wrapped root keys for a conversation. The result says how many of the rows
// this call actually stored, which is how a caller learns that a rotation lost the
// race for its epoch (see rotateConversationEpoch).
export async function postConversationKeys(
  conversationId: string,
  keys: WrappedKeyPayload[]
): Promise<{ applied: number }> {
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
  const body = (await response.json()) as { applied?: number };
  // A server that does not report it predates the field; assume the write landed,
  // which is what the client did before the field existed.
  return {
    applied: typeof body.applied === "number" ? body.applied : keys.length,
  };
}

// The newest `updatedAt` the server has reported for a conversation, from every
// detail and list read this tab has made.
//
// A den's roster moves without this client hearing about it: a membership
// mutation bumps the conversation row, and until the client refetches, its cached
// detail still lists the removed member, still shows no departed holder and no
// newcomer, and still reads its newest epoch perfectly. Nothing in that snapshot
// says the epoch is contaminated, so a send under it hands a message to exactly
// the member who was just removed. The composer refetches after every send, which
// bounds that window rather than closing it, so the send path compares its snapshot
// against what the server has already told us instead of trusting it.
//
// A message send moves the same row, so the watermark advances for ordinary
// activity too and the guard can fire without a membership change behind it. That
// costs one refetch on the send path — which already carries one — and never a
// wrong epoch. The alternative is a narrower signal nobody has today: separating
// roster movement from transcript movement needs its own column.
//
// It has one now. `membershipSeq` moves only for the roster, so the check below is
// now two axes rather than one, and this comment is what keeps the older axis from
// being deleted as redundant: it is the second, independent line of defence, and
// it still fires for a server that never reports a counter. What it must never
// become is the only one again, which is why `touchDen` no longer relies on it.
const serverReportedConversationUpdatedAt = new Map<string, number>();

// Records the newest report for a conversation. Later reads only ever move it
// forward, so an out-of-order response cannot walk the watermark back.
function noteConversationUpdatedAt(conversation: {
  id: string;
  updatedAt: Date | string | number | null | undefined;
}): void {
  const reported = toMillis(conversation.updatedAt);
  if (reported === null) {
    return;
  }
  const seen = serverReportedConversationUpdatedAt.get(conversation.id);
  if (seen === undefined || reported > seen) {
    serverReportedConversationUpdatedAt.set(conversation.id, reported);
  }
}

// The sibling of the above, for the roster-only counter. Kept in its own module
// (`./membership-seq`) rather than folded into the `updatedAt` map, because the two
// answer different questions: one says "this row moved at some point", the other
// says "the roster moved N times". Merging them would make a message send look
// like a membership change, which is the cost this column exists to remove.
//
// Records whatever the response carried and asks nothing of the caller here: a
// detail, list or create response IS the fresh data, so the caller has nothing to
// refetch. The send path is the one response that is not, and it uses the returned
// plan - see `sendEncryptedMessage`.
function noteConversationMembershipSeq(conversation: {
  id: string;
  membershipSeq?: number | null;
}): void {
  applyMembershipSeq(conversation.id, conversation.membershipSeq);
}

// Whether this snapshot has already been overtaken by something the server told
// this tab about it. Unknown conversations (nothing reported yet) are never stale,
// so the check costs nothing on a conversation read for the first time.
//
// Two axes, OR-ed, each independent:
//
//   - `updatedAt`: the second line of defence, kept rather than removed. Coarse
//     (millisecond resolution, and it moves on every send) and it can fire without
//     any membership change behind it, but it needs nothing from a newer server.
//   - `membershipSeq`: the sound one. It moves only for the roster, so a value
//     ahead of this snapshot's is proof that the roster moved and this tab never
//     heard it - which is exactly the case the timestamp cannot distinguish from
//     ordinary activity.
//
// Either way the answer is the same for the caller, which is why they are one
// predicate: `ensureConversationKeys` refetches before sending, or refuses the
// send when it cannot.
export function isConversationSnapshotStale(
  conversation: MessageConversationData
): boolean {
  return (
    isUpdatedAtSnapshotBehind(conversation) ||
    isMembershipSeqSnapshotBehind(conversation)
  );
}

function isUpdatedAtSnapshotBehind(
  conversation: MessageConversationData
): boolean {
  const reported = serverReportedConversationUpdatedAt.get(conversation.id);
  if (reported === undefined) {
    return false;
  }
  const snapshot = toMillis(conversation.updatedAt);
  return snapshot !== null && snapshot < reported;
}

// A snapshot that carries no counter cannot be behind on that axis, and neither
// can one from a tab that has never been told a value for it. Both are the common
// case - a DM, a payload cached before the column existed - and both must resolve
// to "not stale", or every send on the hottest path in the app would pay a refetch.
function isMembershipSeqSnapshotBehind(
  conversation: MessageConversationData
): boolean {
  const snapshot = readMembershipSeq(conversation.membershipSeq);
  const reported = lastAppliedMembershipSeq(conversation.id);
  if (snapshot === null || reported === null) {
    return false;
  }
  return snapshot < reported;
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
  const body = (await response.json()) as ConversationListResponse;
  for (const item of body.conversations) {
    noteConversationUpdatedAt(item);
    noteConversationMembershipSeq(item);
  }
  return body;
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
  const body = (await response.json()) as ConversationDetailResponse;
  noteConversationUpdatedAt(body.conversation);
  noteConversationMembershipSeq(body.conversation);
  return body;
}

// Writes the caller's own DM preferences. Only the keys present in `prefs` are
// sent, so a mute toggle cannot clear the theme and a theme pick cannot unmute.
// Returns the stored values so the caller can reconcile its optimistic state
// with the server's answer (the mute timestamp in particular is server-owned:
// re-muting keeps the original one).
export async function updateConversationPrefs(
  conversationId: string,
  prefs: {
    muted?: boolean;
    themeKey?: string | null;
    wallpaperDim?: number | null;
    wallpaperKey?: string | null;
  }
): Promise<ConversationPrefs> {
  const response = await fetch(
    `/api/messages/conversations/${conversationId}/prefs`,
    {
      body: JSON.stringify(prefs),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    }
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  const body = (await response.json()) as { prefs: ConversationPrefs };
  return body.prefs;
}

// Links the caller's own uploaded image as this conversation's custom wallpaper.
// The image must already be a finished (`READY`) pipeline upload; the route
// re-checks ownership, type and dimensions against what the decoder measured.
// Returns the server's refreshed prefs so the caller can paint from the truth
// rather than from its own optimism.
export async function setConversationWallpaperUpload(
  conversationId: string,
  mediaId: string
): Promise<ConversationPrefs> {
  const response = await fetch(
    `/api/messages/conversations/${conversationId}/wallpaper`,
    {
      body: JSON.stringify({ mediaId }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  const body = (await response.json()) as { prefs: ConversationPrefs };
  return body.prefs;
}

// Unlinks the custom upload, returning the chat to the app default (or whatever
// preset was last chosen). The route schedules the freed image for cleanup.
export async function clearConversationWallpaperUpload(
  conversationId: string
): Promise<ConversationPrefs> {
  const response = await fetch(
    `/api/messages/conversations/${conversationId}/wallpaper`,
    {
      credentials: "same-origin",
      method: "DELETE",
    }
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  const body = (await response.json()) as { prefs: ConversationPrefs };
  return body.prefs;
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
//
// Exported because the wallpaper uploader needs the same pre-flight read to
// reject an image that is too small before spending an upload on it.
export async function readImageDimensions(
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

// A send is the one response a member whose `den.membership.changed` was lost will
// ever see: the realtime channel is best-effort, so nothing else is guaranteed to
// reach them. The route echoes the conversation's current roster counter alongside
// the message, and this records it.
//
// If it comes back AHEAD of the last counter this tab applied, then a roster
// changed and the announcement never arrived, and this tab's cached conversation
// is holding a roster that no longer exists. The send itself has already committed
// - the message is written either way, and refusing it here would only lose the
// user's text - so what this does is mark the cached snapshot as known-behind.
// `ensureConversationKeys` reads that on the NEXT send and refetches the detail
// before it may write into an epoch, or refuses the send when it cannot refetch.
// Same mechanism as the `updatedAt` watermark, on a signal that cannot fire for
// ordinary traffic.
//
// A response with no counter (an older server, a transaction that returned no
// row) records nothing and changes no behaviour: `applyMembershipSeq` reports it
// as unsequenced and this tab carries on exactly as it did before.
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
  const json = (await response.json()) as {
    membershipSeq?: number | null;
    message: MessageData;
  };
  applyMembershipSeq(conversationId, json.membershipSeq);
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
// and the public key each wrap was made against. Memoized per conversation so
// the expensive ECDH+HKDF only runs once per session.
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
  //
  // The pairing is per WRAP, not per conversation: a den has many wrappers, and
  // each of my rows was made by whichever member rotated that epoch. A wrap that
  // names no wrapper (a DM row) pairs with `peerPublicKeyBase64`, the single
  // peer — unchanged, and still the whole story for a DM.
  function getRootKeys(
    conversationId: string,
    myWrappedKeys: {
      encryptedKey: EncryptedBlob;
      version: number;
      wrapperPublicKeyBase64?: string | null;
    }[],
    peerPublicKeyBase64: string
  ): Promise<Uint8Array[]> {
    // The pairing keys are part of the signature because a wrap re-pointed at a
    // different wrapper's public key produces different ECDH results from the
    // same ciphertext, exactly as a new peer key did for a DM.
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
      // One import per distinct pairing key, shared by every wrap made against
      // it. A den normally has a handful of wrappers across all of its epochs,
      // so this is a few imports rather than one per row.
      const imported = new Map<string, Promise<CryptoKey>>();
      const importPairingKey = (publicKeyBase64: string) => {
        const existing = imported.get(publicKeyBase64);
        if (existing) {
          return existing;
        }
        const key = importPublicKeyBase64(publicKeyBase64);
        imported.set(publicKeyBase64, key);
        return key;
      };
      const ordered = [...myWrappedKeys].toSorted(
        (left, right) => right.version - left.version
      );
      // Independent unwraps, one per epoch: run them together and keep the ones
      // that succeed, dropping wraps left over from a superseded identity.
      const unwrapped = await Promise.all(
        ordered.map(async (wrapped) => {
          // Falling back to the peer only when the row names no wrapper, which is
          // the DM case and the pairing the DM path has always used.
          const pairingKey =
            wrapped.wrapperPublicKeyBase64 ?? peerPublicKeyBase64;
          if (!pairingKey) {
            return null;
          }
          try {
            return await unwrapRootKey(
              privateKey,
              await importPairingKey(pairingKey),
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

// The public key a wrap row was paired with, resolved through the WRAPPER.
//
// The row's own `wrapperPublicKey` snapshot wins when it is there. That snapshot
// was written in the same request as the blob, from the private key that
// performed the wrap, so it IS the pairing the reader has to reconstruct — the
// row is self-describing and immutable, and re-pairing it against anything else
// can only fail. The wrapper's live identity key is the fallback for a row that
// names no snapshot (one written by a client older than the column), and it is
// what keeps such an epoch readable while the wrapper is still around.
//
// The ordering matters after an identity reset. A reset deletes the identity
// row and a re-provision writes a NEW one, so a wrapper who is still on the
// roster can be holding a live key that is not the one their old wraps were made
// against. Resolving through that key drops the wrap, and because the dropped
// wrap is the pairing for EVERYBODY'S copy of that epoch, the wrapper strands
// their own history for the whole den. The snapshot exists precisely so that
// cannot happen, and it outlives the wrapper: a member who left the den is still
// the wrapper for epochs the remaining members must keep reading.
//
// A DM row names no wrapper (the column is null on every row written before it
// existed) and null here means "use the peer", which is the DM pairing this path
// has always used. Null overall means the wrapper cannot be paired at all, and
// the caller must drop the wrap rather than guess.
function wrapperPublicKeyFor(
  wrap: { wrapperPublicKey?: string | null; wrapperUserId?: string | null },
  conversation: MessageConversationData
): string | null {
  if (!wrap.wrapperUserId) {
    return null;
  }
  const snapshot = wrap.wrapperPublicKey;
  if (typeof snapshot === "string" && snapshot.length > 0) {
    return snapshot;
  }
  const live = conversation.members.find(
    (member) => member.userId === wrap.wrapperUserId
  )?.user.messageIdentity?.publicKey;
  return typeof live === "string" && live.length > 0 ? live : null;
}

// Adapts the server's key ROWS to the wrapped-key payload shape. The two differ
// only in how the blob is carried — `encryptedKey` and `iv` as sibling strings on
// a row, nested as one object in a payload — and both shapes reach the client,
// because the conversation payload carries rows and the conversation detail
// carries payloads. Adapting in one place is what stops the wrapper columns from
// being dropped by one of the two callers.
export function toWrappedKeyPayloads(
  keys: readonly MessageConversationKey[]
): WrappedKeyPayload[] {
  return keys.map((key) => ({
    encryptedKey: { ciphertext: key.encryptedKey, iv: key.iv },
    ownerUserId: key.ownerUserId,
    version: key.version,
    wrapperPublicKey: key.wrapperPublicKey,
    wrapperUserId: key.wrapperUserId,
  }));
}

// My wraps for a conversation, newest epoch first, each paired with the key it
// was wrapped against. Shared by the decrypt path (one root per epoch to try) and
// the send path (the newest epoch is the only one a new message may be written
// under), which must agree on exactly which epoch that is.
//
// The `?? 1` here belongs to the WIRE shape, where an omitted version is how a
// client older than epochs still says "epoch 1". A stored key row has a
// non-optional version (see MessageConversationKey), so everywhere a row is read
// back there is no fallback to write.
export function resolveMyConversationWraps(
  keys: readonly WrappedKeyPayload[],
  conversation: MessageConversationData,
  myUserId: string
): ConversationWrap[] {
  return keys
    .filter((key) => key.ownerUserId === myUserId)
    .map((key) => ({
      encryptedKey: key.encryptedKey,
      version: key.version ?? 1,
      wrapperPublicKeyBase64: wrapperPublicKeyFor(key, conversation),
    }))
    .toSorted((left, right) => right.version - left.version);
}

// Signature of the material a key decision depends on: my wraps for the
// conversation (epoch, ciphertext and wrapper per row) plus every member's
// identity public key. Used to tell a genuinely stale snapshot from an unchanged
// refetch, so a rotate cannot mint an epoch wrapped for a key that has since been
// superseded. A den can be rotated by any member, so every roster key counts.
function conversationKeySignature(
  conversation: MessageConversationData,
  myUserId: string
): string {
  const wraps = conversation.keys
    .filter((key) => key.ownerUserId === myUserId)
    .map(
      (key) =>
        `${key.version}:${key.encryptedKey}:${key.iv}:${key.wrapperUserId ?? ""}:${key.wrapperPublicKey ?? ""}`
    )
    .toSorted()
    .join("|");
  // Sorted so roster order alone cannot move the signature.
  const members = conversation.members
    .map(
      (member) =>
        `${member.userId}:${member.user.messageIdentity?.publicKey ?? ""}`
    )
    .toSorted()
    .join("|");
  return `${wraps}#${members}`;
}

// The newest root-key epoch in the conversation, or 0 when it has no wraps at
// all. Epochs are conversation-wide: every member's wrap for a version denotes
// the same root, so the ceiling is the highest version on any row.
//
// `version` is non-optional on a key row, so there is no `?? 1` here. That
// fallback belongs to the wire payload, where an omitted version is how a client
// older than epochs still writes "epoch 1" (see WrappedKeyPayload).
function newestEpoch(conversation: MessageConversationData): number {
  let highest = 0;
  for (const key of conversation.keys) {
    highest = Math.max(highest, key.version);
  }
  return highest;
}

// The peer key to fall back on for a wrap that names no wrapper. A DM has one
// peer and that peer is unambiguously the wrapper, so the fallback is the whole
// story there. A den has no single peer: pairing a wrapper-less row against an
// arbitrary member would mint a wrap nobody can read, so there is no fallback and
// the row is left for the rotation below to supersede.
function peerFallbackPublicKey(
  conversation: MessageConversationData,
  myUserId: string
): string | null {
  if (conversation.type !== "DM") {
    return null;
  }
  return (
    conversation.members.find((member) => member.userId !== myUserId)?.user
      .messageIdentity?.publicKey ?? null
  );
}

// Unwraps the newest epoch of mine that this identity can actually read, and
// reports which epoch it was. Null means every one of my wraps belongs to a
// superseded identity, which is the caller's signal to rotate.
//
// Newest first on purpose: the epoch a new message may be written under is the
// newest readable one and only that one. A wrap left over from a superseded
// identity simply fails to unwrap and falls through. Sequential because each
// iteration's await depends on the previous failure and the first success ends
// the loop.
async function unwrapNewestReadableEpoch(
  conversation: MessageConversationData,
  privateKey: CryptoKey,
  myUserId: string,
  peerPublicKeyBase64: string | null
): Promise<{ rootKey: Uint8Array; version: number } | null> {
  const wraps = resolveMyConversationWraps(
    toWrappedKeyPayloads(conversation.keys),
    conversation,
    myUserId
  );
  // oxlint-disable no-await-in-loop -- ordered epoch probe with early exit
  for (const wrap of wraps) {
    const pairingKey = wrap.wrapperPublicKeyBase64 ?? peerPublicKeyBase64;
    if (!pairingKey) {
      continue;
    }
    let rootKey: Uint8Array;
    try {
      rootKey = await unwrapRootKey(
        privateKey,
        await importPublicKeyBase64(pairingKey),
        conversation.id,
        wrap.encryptedKey
      );
    } catch {
      continue;
    }
    return { rootKey, version: wrap.version };
  }
  // oxlint-enable no-await-in-loop
  return null;
}

// Members of the conversation holding no wrap for `version`.
function membersMissingEpoch(
  conversation: MessageConversationData,
  version: number
): string[] {
  const holders = new Set(
    conversation.keys
      .filter((key) => key.version === version)
      .map((key) => key.ownerUserId)
  );
  return conversation.members
    .map((member) => member.userId)
    .filter((userId) => !holders.has(userId));
}

// Users who still hold a wrap for `version` but are no longer in the
// conversation. A key row hangs off the conversation, not off the membership, so
// removing somebody from a den leaves their wraps readable. That is deliberate
// (it is their history, and Phase 1's reset path depends on the same shape), and
// it doubles as the signal that this epoch is now contaminated — see
// ensureConversationKeys.
function departedEpochHolders(
  conversation: MessageConversationData,
  version: number
): string[] {
  const members = new Set(conversation.members.map((member) => member.userId));
  return [
    ...new Set(
      conversation.keys
        .filter((key) => key.version === version)
        .map((key) => key.ownerUserId)
    ),
  ].filter((userId) => !members.has(userId));
}

// Milliseconds for a value that may arrive as a Date (an in-process payload) or
// as an ISO string (the same payload over JSON). Null when there is nothing to
// read, and every caller treats null as "cannot tell".
function toMillis(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  const millis = new Date(value).getTime();
  return Number.isNaN(millis) ? null : millis;
}

// When the newest epoch started being written, from the earliest wrap row at that
// version. Null when any row at the version carries no usable timestamp — an
// absent or unparseable one, which is the only shape a deleted timestamp takes
// over the wire. Every caller reads null as "cannot tell", and "cannot tell"
// resolves in favour of a ROTATION (see cannotHealIntoEpoch): a heal on a guess
// hands a newcomer the whole history, while a rotation costs one fresh epoch.
function epochStartedAt(
  conversation: MessageConversationData,
  version: number
): number | null {
  let earliest: number | null = null;
  for (const key of conversation.keys) {
    if (key.version !== version) {
      continue;
    }
    const writtenAt = toMillis(key.createdAt);
    if (writtenAt === null) {
      return null;
    }
    earliest = earliest === null ? writtenAt : Math.min(earliest, writtenAt);
  }
  return earliest;
}

// Whether `userId` must NOT be handed the current epoch's root by a heal, so the
// caller rotates instead.
//
// The heal is the one path in the protocol that can hand an existing root to a
// member who does not hold it, so it is also the one place a pre-join leak could
// be written. It is permitted only when the member is PROVABLY in the room, and
// every signal below fails closed:
//
//   - A DM has nothing to prove. Both membership rows are written in the same
//     transaction as the conversation, so no message under any DM epoch predates
//     the peer, and a legacy partial wrap is the only gap there can be. The whole
//     epoch discipline is for a roster that changes, and a DM roster does not.
//
//   - A member holding no wrap for ANY epoch was never in the room when any root
//     was fanned out, which makes them a true newcomer: the interrupted fan-out
//     this path exists to repair always leaves the member holding an OLDER
//     epoch's wrap. This is the structural signal the millisecond-truncated clock
//     cannot provide — it is a fact about the wrap set, so a join landing in the
//     same millisecond as the mint, or at any other boundary at all, is classified
//     the same way every time.
//
//   - An unknown epoch start proves nothing about anybody, so it blocks every
//     heal. One row at this version with an unreadable timestamp used to read as
//     "no newcomers" and unlock a full-history fan-out; it now costs an epoch.
//
//   - A member who holds an older wrap but not this one, and who joined at or
//     after the mint, left and came back. Their old wrap survives the round trip
//     because a key row hangs off the conversation rather than the membership, so
//     the wrap set cannot tell them apart from an interrupted fan-out; the join
//     timestamp can, because a rejoin is strictly later than the epoch it missed.
//
// `>=` rather than `>` on that last comparison, for the case where even that is
// ambiguous: a rejoin whose membership row lands in the same millisecond the epoch
// was written in. Two events the database put in one millisecond cannot be ordered
// against each other, so equality has to read as "at or after". It cannot loop:
// the rotation this decision forces writes the new epoch's wrap for that member,
// and a member who already holds the newest epoch is never a heal candidate again,
// so two joins and a rotation inside one millisecond cost exactly one extra epoch.
function cannotHealIntoEpoch(
  conversation: MessageConversationData,
  userId: string,
  epochStart: number | null
): boolean {
  if (conversation.type !== "DEN") {
    return false;
  }
  const holdsAnOlderEpoch = conversation.keys.some(
    (key) => key.ownerUserId === userId
  );
  if (!holdsAnOlderEpoch) {
    return true;
  }
  if (epochStart === null) {
    return true;
  }
  const joinedAt = toMillis(
    conversation.members.find((member) => member.userId === userId)?.createdAt
  );
  return joinedAt === null || joinedAt >= epochStart;
}

// Wrap recipients among `userIds`: the rotator from their own private key, every
// other member from the roster.
//
// The rotator is derived rather than read because their identity row is not
// always in the snapshot being rotated from, while their public key always is —
// they are holding it. Every other member comes from the roster, and one with no
// identity there is left out and reported by the fan-out rather than dropped
// silently.
function wrapRecipients(
  conversation: MessageConversationData,
  myPublicKeyBase64: string,
  myUserId: string,
  userIds: readonly string[]
): WrapRecipient[] {
  return userIds.map((userId) =>
    userId === myUserId
      ? { publicKeyBase64: myPublicKeyBase64, userId }
      : {
          publicKeyBase64:
            conversation.members.find((member) => member.userId === userId)
              ?.user.messageIdentity?.publicKey ?? "",
          userId,
        }
  );
}

// Wraps `rootKey` once per member in `userIds` and posts every wrap at the SAME
// epoch, in one write. They all denote the same root, so a member who unwraps any
// one of them decrypts the same messages.
//
// One write is what keeps an epoch from being half-written: the route applies the
// batch atomically, so an epoch is either fanned out to everybody it names or it
// does not exist. Posting member by member would leave it half-covered for as
// long as the loop took, which is a window in which a message encrypted under it
// is unreadable for somebody.
async function postEpochWraps(params: {
  conversation: MessageConversationData;
  myUserId: string;
  privateKey: CryptoKey;
  rootKey: Uint8Array;
  userIds: readonly string[];
  version: number;
}): Promise<{ applied: number; skipped: string[]; wrapped: number }> {
  const { conversation, myUserId, privateKey, rootKey, userIds, version } =
    params;
  const myPublicKeyBase64 = await selfPublicKeyBase64(privateKey);
  const fanOut = await wrapRootKeyForMembers(
    privateKey,
    wrapRecipients(conversation, myPublicKeyBase64, myUserId, userIds),
    conversation.id,
    rootKey
  );
  if (fanOut.wrapped.length === 0) {
    // Nothing to write. Posting an empty batch would be refused, and each caller
    // decides what a batch of nothing means: a heal has simply nothing left to
    // report, while a rotation cannot mint an epoch this device is not in.
    return { applied: 0, skipped: fanOut.skipped, wrapped: 0 };
  }
  let applied: number;
  try {
    ({ applied } = await postConversationKeys(
      conversation.id,
      fanOut.wrapped.map((wrap) => ({
        encryptedKey: wrap.encryptedKey,
        ownerUserId: wrap.userId,
        version,
        wrapperPublicKey: myPublicKeyBase64,
        wrapperUserId: myUserId,
      }))
    ));
  } catch (error) {
    // A 409 from the keys route is a lost race for the epoch, not a failure: the
    // route refuses any batch that would complete, contradict, or race an epoch
    // another member already owns. Reporting it as "stored nothing" is exactly
    // what both callers below already handle — a rotation refreshes and sends
    // under the winner's root, a heal simply has nothing left to write — so a
    // refusal never reaches the user as "Message not sent".
    if (error instanceof MessagesApiError && error.status === 409) {
      return {
        applied: 0,
        skipped: fanOut.skipped,
        wrapped: fanOut.wrapped.length,
      };
    }
    throw error;
  }
  return { applied, skipped: fanOut.skipped, wrapped: fanOut.wrapped.length };
}

// Heals a membership gap: wraps the CURRENT epoch's root for the members holding
// no wrap for it and posts only those.
//
// The member list is the caller's, not this function's: `userIds` has already been
// reduced to the members a heal is allowed to touch (see cannotHealIntoEpoch), and
// recomputing it here would silently reintroduce the newcomers this path exists to
// keep out. A newcomer must never be healed into an epoch minted before they
// arrived. What is left is an interrupted fan-out — the member holds an older
// epoch's wrap and predates this one — and it is a no-op when everybody already
// holds the epoch, which is the common case: this runs on the send path, so the
// happy path must not fan out at all.
async function healMissingMemberWraps(params: {
  conversation: MessageConversationData;
  myUserId: string;
  onUnwrappableMembers?: (userIds: string[]) => void;
  privateKey: CryptoKey;
  rootKey: Uint8Array;
  userIds: readonly string[];
  version: number;
}): Promise<void> {
  const { conversation, myUserId, privateKey, rootKey, userIds, version } =
    params;
  if (userIds.length === 0) {
    return;
  }
  const result = await postEpochWraps({
    conversation,
    myUserId,
    privateKey,
    rootKey,
    userIds,
    version,
  });
  params.onUnwrappableMembers?.(result.skipped);
}

// Rotates to a fresh epoch: a brand new root key wrapped for every member at
// max+1, with this device as the wrapper on every row.
//
// Every older epoch is left exactly as it is. A member removed since an older
// epoch therefore keeps reading everything written up to the rotation and
// receives nothing after it, which is the forward-secrecy property the den needs
// and the reason a wrap is never overwritten or deleted.
//
// Null means another member minted this epoch first. Two members can pick the same
// next version from the same snapshot, and the server will not let the second one
// write a second root key under a version the first already owns — so the root key
// minted here is not the den's root key, and a message encrypted under it would be
// unreadable for everyone, the sender included. The winner's root is resolved
// instead, and null is only returned when there is no fresh snapshot to resolve it
// from, which leaves the caller to report that the keys are not ready rather than
// send something undecryptable.
async function rotateConversationEpoch(
  conversation: MessageConversationData,
  privateKey: CryptoKey,
  myUserId: string,
  options?: {
    onUnwrappableMembers?: (userIds: string[]) => void;
    refreshConversation?: () => Promise<MessageConversationData | null>;
  }
): Promise<Uint8Array | null> {
  const rootKey = generateRootKey();
  const result = await postEpochWraps({
    conversation,
    myUserId,
    privateKey,
    rootKey,
    userIds: conversation.members.map((member) => member.userId),
    version: newestEpoch(conversation) + 1,
  });
  options?.onUnwrappableMembers?.(result.skipped);
  if (result.wrapped === 0) {
    // The rotator is always wrapable from the key they are holding, so this is a
    // guard rather than a path: an epoch this device is not in would make every
    // message it sends unreadable, including to itself.
    throw new Error(`No member of ${conversation.id} could be wrapped for`);
  }
  if (result.applied > 0) {
    return rootKey;
  }
  // Every wrap we asked for was already on file, so this epoch belongs to somebody
  // else's rotation. Read theirs.
  const fresh = await options?.refreshConversation?.();
  if (!fresh) {
    return null;
  }
  const unwrapped = await unwrapNewestReadableEpoch(
    fresh,
    privateKey,
    myUserId,
    peerFallbackPublicKey(fresh, myUserId)
  );
  return unwrapped?.rootKey ?? null;
}

// Makes sure the conversation has a root key this device can send under, then
// returns it. The returned key is ALWAYS the newest epoch's, because a new
// message must never be written under an older one: a member removed since that
// epoch was minted still holds it, so anything sent under it would be readable
// by somebody no longer in the den.
//
// That single rule is what makes the triggers fall out as they do. A new epoch is
// minted when:
//   - nothing unwraps for this device: a conversation created before this device
//     had keys, an identity reset, or a member who just joined and holds no
//     epoch at all;
//   - the newest readable epoch is older than the newest epoch: somebody else
//     rotated without covering me;
//   - the newest epoch still holds a wrap for somebody who is no longer a member:
//     a removed member, or somebody who left, can still read that epoch;
//   - somebody who holds no wrap at all has to be given one, which means a new
//     epoch, and so does anybody whose membership row is too recent to prove they
//     were in the room when this one was minted — including every case where that
//     cannot be told at all. See cannotHealIntoEpoch.
//
// Otherwise the current epoch is good enough to send under, and the only work left
// is a heal: a member who was already in the room when it was minted has no wrap
// for it, which means an interrupted fan-out or a legacy client that wrote one row
// where this code writes all of them. Those are the only wraps a heal posts, which
// is what keeps a membership change from costing the den a fresh epoch it does not
// need.
//
// Both paths are idempotent, because posting keys is append-only and never
// overwrites, and the happy path — already keyed, roster unchanged — does exactly
// one unwrap and no writes at all, so the per-member ECDH fan-out never runs on a
// send.
//
// A member with no message identity cannot be wrapped for. They are skipped and
// reported through `onUnwrappableMembers` rather than failing the epoch: refusing
// to rotate would cost every other member their next message over somebody who has
// not turned messages on, and an epoch that skipped them is still complete for
// everyone who can read, which is what keeps a skipped member from being locked
// out. They are picked up by the next heal or rotation, by which time they have an
// identity; the one case that writes nothing is a heal whose only gap is
// unwrappable, which is not a reason to refuse a message everybody else can read.
//
// `refreshConversation` is the stale-snapshot guard, and it answers two questions.
// The first is the rotate case: when nothing unwraps we cannot tell "my identity
// reset" from "I am holding an outdated snapshot of a conversation that was already
// rotated". Rotating on the latter would mint a fresh epoch wrapped for keys that
// have been superseded, which nobody can unwrap, so their new messages would stay
// unreadable. The second is membership: a snapshot the server has already reported
// as moved past is never a basis for a send or a rotation, because the roster it
// names may no longer exist and its newest epoch may be one a removed member still
// holds. When a refresh is supplied it is consulted before either; if the key
// material changed, or the snapshot was known stale, the freshest snapshot is used
// instead.
//
// Null means the caller must not send. Three ways to get here: another member's
// rotation won the race for this epoch and there was no fresh snapshot to resolve
// theirs from; the conversation has nobody this device could ever be wrapped with;
// or the snapshot is known to be behind the server and there was no way to fetch a
// current one. All are recoverable on the next attempt, which is why the failure
// is a null rather than a throw.
export async function ensureConversationKeys(
  conversation: MessageConversationData,
  privateKey: CryptoKey,
  myUserId: string,
  options?: {
    onUnwrappableMembers?: (userIds: string[]) => void;
    refreshConversation?: () => Promise<MessageConversationData | null>;
  }
): Promise<Uint8Array | null> {
  // A snapshot the server has already moved past is not a basis for anything: it
  // can name a member who has since been removed, and it offers as sendable the
  // exact epoch that removed member already holds. Skipping the whole decision is
  // what closes the window the composer's post-send refetch only bounds.
  const stale = isConversationSnapshotStale(conversation);
  if (!stale) {
    const current = await resolveSendableEpoch(
      conversation,
      privateKey,
      myUserId,
      options
    );
    if (current) {
      return current.rootKey;
    }
  }

  // Nothing sendable. Before rotating, confirm our snapshot is current.
  const refresh = options?.refreshConversation;
  if (!refresh) {
    // Without a fresher answer there is nothing to rotate against that is known to
    // be true, so a stale snapshot is refused rather than minted or sent on.
    return stale
      ? null
      : await rotateConversationEpoch(
          conversation,
          privateKey,
          myUserId,
          options
        );
  }
  const before = conversationKeySignature(conversation, myUserId);
  const fresh = await refresh();
  // The signature covers the roster and the key material, so an unchanged
  // signature means the refetch proved the snapshot was current after all. A stale
  // snapshot has to be re-decided either way: only its updatedAt moved, and
  // updatedAt is exactly what a membership change moves.
  if (
    fresh &&
    (stale || conversationKeySignature(fresh, myUserId) !== before)
  ) {
    const healed = await resolveSendableEpoch(
      fresh,
      privateKey,
      myUserId,
      options
    );
    if (healed) {
      return healed.rootKey;
    }
    // Still nothing on the freshest snapshot: rotate against it, so every wrap
    // uses the current key of its member rather than a superseded one.
    return await rotateConversationEpoch(fresh, privateKey, myUserId, options);
  }

  return stale
    ? null
    : await rotateConversationEpoch(
        conversation,
        privateKey,
        myUserId,
        options
      );
}

// The root key to send under, or null when the conversation needs a new epoch.
// Split out of ensureConversationKeys so the pre-rotation refresh can re-run
// exactly the same decision against a fresher snapshot.
async function resolveSendableEpoch(
  conversation: MessageConversationData,
  privateKey: CryptoKey,
  myUserId: string,
  options?: { onUnwrappableMembers?: (userIds: string[]) => void }
): Promise<{ rootKey: Uint8Array } | null> {
  const unwrapped = await unwrapNewestReadableEpoch(
    conversation,
    privateKey,
    myUserId,
    peerFallbackPublicKey(conversation, myUserId)
  );
  const newest = newestEpoch(conversation);
  // An older readable epoch is deliberately not good enough: see the note on
  // ensureConversationKeys about removed members holding older epochs.
  if (!unwrapped || unwrapped.version !== newest) {
    return null;
  }
  // The epoch is readable by somebody who has left. Mint a new one rather than
  // write anything else into it.
  if (departedEpochHolders(conversation, newest).length > 0) {
    return null;
  }
  // The heal is the only thing left that can hand a root to somebody, so it
  // decides on exactly the members missing one. Deciding on the whole roster
  // instead would rotate for a newcomer who is already covered, on every send,
  // forever; deciding on the missing set makes the decision self-cancelling,
  // because the rotation it forces gives that member a wrap for the new epoch.
  const missing = membersMissingEpoch(conversation, newest);
  const epochStart = epochStartedAt(conversation, newest);
  if (
    missing.some((userId) =>
      cannotHealIntoEpoch(conversation, userId, epochStart)
    )
  ) {
    return null;
  }
  await healMissingMemberWraps({
    conversation,
    myUserId,
    onUnwrappableMembers: options?.onUnwrappableMembers,
    privateKey,
    rootKey: unwrapped.rootKey,
    userIds: missing,
    version: newest,
  });
  return unwrapped;
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

// Import for a pairing key held as base64. Every caller is already inside a try
// that falls through to "this wrap is not mine", so a malformed key needs no
// special handling of its own.
async function importPublicKeyBase64(
  publicKeyBase64: string
): Promise<CryptoKey> {
  return importPublicKey(await publicKeyBase64ToJwk(publicKeyBase64));
}
