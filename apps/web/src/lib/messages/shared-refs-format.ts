// Storage shape and pagination contract for the shared-content refs index.
//
// WHY A SEPARATE INDEX, beside the v7 text search index rather than inside it:
//
//   - Text search is a shipping, in-use index. Adding a field to its rows would
//     make every conversation's stored rows unreadable, and the only repair is
//     re-walking all history on every device. Refs get their own versioned store
//     and backfill lazily, so search is never degraded by this feature.
//   - A ref failure must not break search. The two write paths are separate
//     methods, so a malformed ref can be dropped and re-derived while search
//     keeps working.
//   - Refs are a small fraction of messages. A separate store holds one record
//     per (message, ref) and nothing at all for the text-only majority, so its
//     footprint tracks media and links rather than history size.
//
// The key is [conversationId, kind, timeKey] with ONE record per ref, so the read
// a tab does — "the newest N media, then the next N" — is a single descending
// range read over one store, with no per-message join and no client-side sort.
// The per-message forward index exists only so a delete can find a message's refs
// without a full scan.
//
// Everything here is plaintext on the device, like the search index's own tokens
// and previews: message payloads stay encrypted, and this cache never leaves the
// device. Same bargain, same sensitivity.

import { getMessageMediaId } from "@/lib/utils/image-url";

import type { extractSharedRefs, SharedMediaRef } from "./message-shared-refs";

// Versioned independently of the search index. A record from another version
// reads as absent, and refs are re-derived by walking history, so there is no
// migration to write.
export const SHARED_REFS_FORMAT_VERSION = 1;

// The three tabs, and the three record kinds. A kind is one small string in a
// key rather than three near-identical stores.
export const SHARED_REF_KINDS = ["link", "media", "post"] as const;
export type SharedRefKind = (typeof SHARED_REF_KINDS)[number];

export function isSharedRefKind(value: unknown): value is SharedRefKind {
  return (
    typeof value === "string" &&
    (SHARED_REF_KINDS as readonly string[]).includes(value)
  );
}

// One stored ref, as it travels.
//
// `index` is the ref's position WITHIN its message among refs of the same kind,
// and it is STORED rather than derived per page. Deriving it per page is the
// obvious implementation and it is wrong: a page turn can land in the middle of
// one message's refs (a 10-image album straddles the boundary), so the same image
// would be numbered differently on two pages, its flatKey would change under a
// mounted virtualized row, and the viewer's anchor would drift. Media's index is
// the album position the fullscreen viewer already anchors on, so storing it
// costs nothing and makes that path uniform.
export interface SharedRefRecord {
  createdAt: number;
  index: number;
  mediaKind?: "gif" | "image";
  messageId: string;
  postId?: string;
  senderId: string;
  url?: string;
  version: number;
}

// A page of refs, newest first, plus whether the conversation holds more.
export interface SharedRefsPage {
  // Strictly OLDER than this, on the next read. Absent means "from the newest".
  after?: string;
  coverageComplete?: boolean;
  coveragePaused?: boolean;
  coverageSettled?: boolean;
  hasMore: boolean;
  items: SharedRefRecord[];
  window?: {
    hasNewer: boolean;
    hasOlder: boolean;
    newerCursor: string | null;
    olderCursor: string | null;
  };
}

// Per-conversation, per-kind totals, so a tab can label itself before reading a
// single ref. Maintained by the refs write path only, in a record separate from
// the search meta (which that path rewrites on every page; sharing one would
// reintroduce the read-modify-write race the row allocator exists to avoid).
export interface SharedRefsCounts {
  conversationId: string;
  link: number;
  media: number;
  post: number;
  version: number;
}

export function emptySharedRefsCounts(
  conversationId: string
): SharedRefsCounts {
  return {
    conversationId,
    link: 0,
    media: 0,
    post: 0,
    version: SHARED_REFS_FORMAT_VERSION,
  };
}

// ---- keys --------------------------------------------------------------------

// The sort key component, after the conversation and kind.
//
// Zero-padded so a STRING range is a CHRONOLOGICAL range: an unpadded millisecond
// timestamp sorts as text, and "9783072000000" would sort BEFORE "978307200000" —
// a different century — so a newest-first read would come back in the wrong order.
// The message id then make the order between messages total, so a keyset cursor
// can never land ambiguously inside a tie group.
//
// 14 digits covers every millisecond timestamp from 2001 to 2286.
const TIME_KEY_WIDTH = 14;

// The index component is stored INVERTED, and that is what makes a newest-first
// read come out right.
//
// A page walk is a descending cursor, and everything of one message's refs shares
// one timestamp, so the tiebreak is the ref's own index — which a descending walk
// visits backwards. The observable consequence: a ten-image album renders 9, 8, 7
// rather than in the order it was sent, and it gets WORSE across a page turn
// (each page reverses its own run, so a 10-image album pages as 6-9, 2-5, 0-1).
// No post-processing fixes that, because a newest-first keyset read cannot
// express "newest message first, and within a message ascending" when one
// message's refs straddle the seam.
//
// Inverting the number in the key fixes it at the source: descending text order
// over an inverted index IS ascending logical order, so the album reads in send
// order, across the seam included, with no second pass.
//
// The width must exceed the largest possible index, or the inverted strings stop
// being monotonic. MAX_MESSAGE_ATTACHMENTS (10) and MAX_POST_EMBEDS (5) bound it;
// three digits leaves an order of magnitude of headroom and is asserted below.
const INDEX_KEY_WIDTH = 3;

export function sharedRefTimeKey(
  createdAt: number,
  messageId: string,
  index: number
): string {
  const millis = Number.isFinite(createdAt)
    ? Math.max(0, Math.floor(createdAt))
    : 0;
  // Clamped rather than wrapped: an index past the ceiling cannot be expressed
  // in this width, and clamping would silently merge two refs' keys. The bound is
  // enforced where refs are built, so this only ever guards a corrupt record.
  const safeIndex = Number.isInteger(index)
    ? Math.min(Math.max(index, 0), 999)
    : 0;
  return `${millis.toString().padStart(TIME_KEY_WIDTH, "0")}:${messageId}:${(
    999 - safeIndex
  )
    .toString()
    .padStart(INDEX_KEY_WIDTH, "0")}`;
}

export function sharedRefKey(
  conversationId: string,
  kind: SharedRefKind,
  record: Pick<SharedRefRecord, "createdAt" | "index" | "messageId">
): [string, string, string] {
  return [
    conversationId,
    kind,
    sharedRefTimeKey(record.createdAt, record.messageId, record.index),
  ];
}

// The bounds for a DESCENDING read of one kind, starting at `after`.
//
// `after` is the CEILING, not the floor, which is the part that is easy to get
// backwards: a descending cursor starts at the highest key in the range and walks
// down, so bounding it from below excludes nothing it was going to visit and the
// read restarts at the newest row every time — every page an identical copy of
// page one. Both bounds are open, so the cursor's own row is never revisited.
export function sharedRefRange(
  conversationId: string,
  kind: SharedRefKind,
  after?: string
): {
  lower: [string, string, string];
  upper: [string, string, string];
} {
  return {
    lower: [conversationId, kind, ""],
    // "￿" sorts above any character a time key can contain, so an absent cursor
    // puts every key of the kind inside the range.
    upper: [conversationId, kind, after ?? "￿"],
  };
}

// True when a time key is one this build wrote, so a record from another shape
// reads as absent instead of being half-interpreted.
export function isSharedRefTimeKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > TIME_KEY_WIDTH + 1 &&
    value.codePointAt(TIME_KEY_WIDTH) === 58 // ":"
  );
}

// ---- write model -------------------------------------------------------------

// One message's refs, as the writer hands them over. Grouped per message because
// that is how a payload decrypts, and because the forward index is per message.
export interface SharedRefsWriteRow {
  createdAt: number;
  messageId: string;
  refs: NonNullable<ReturnType<typeof extractSharedRefs>>;
  senderId: string;
}

// Projects a decrypted payload into the records to store, one per ref, and the
// per-message forward index that lets a delete find them again.
//
// Returns null when the payload carries no refs, so the caller stores nothing:
// a text-only message must not create a row claiming it has no media, because
// "has no row" and "has an empty row" mean different things to coverage.
export function buildSharedRefRecords(row: SharedRefsWriteRow): {
  counts: Record<SharedRefKind, number>;
  records: SharedRefRecord[];
} {
  const records: SharedRefRecord[] = [];
  const counts: Record<SharedRefKind, number> = { link: 0, media: 0, post: 0 };

  // for...of over entries() rather than an index loop: the index is part of the
  // stored record, so it cannot be recovered from the value, and skipping the
  // array's own index would number a ref by its array position in this loop rather
  // than its position among the message's refs.
  for (const [index, postId] of row.refs.postIds.entries()) {
    if (!postId) {
      continue;
    }
    records.push({
      createdAt: row.createdAt,
      index,
      messageId: row.messageId,
      postId,
      senderId: row.senderId,
      version: SHARED_REFS_FORMAT_VERSION,
    });
    counts.post += 1;
  }
  for (const image of row.refs.media as SharedMediaRef[]) {
    records.push({
      createdAt: row.createdAt,
      index: image.imageIndex,
      mediaKind: image.kind,
      messageId: row.messageId,
      senderId: row.senderId,
      url: image.url,
      version: SHARED_REFS_FORMAT_VERSION,
    });
    counts.media += 1;
  }
  for (const [index, url] of row.refs.links.entries()) {
    if (!url) {
      continue;
    }
    records.push({
      createdAt: row.createdAt,
      index,
      messageId: row.messageId,
      senderId: row.senderId,
      url,
      version: SHARED_REFS_FORMAT_VERSION,
    });
    counts.link += 1;
  }

  return { counts, records };
}

// ---- read model --------------------------------------------------------------

// THE item shapes, and the only ones. Both the stored rows and the live
// decrypted-window index produce exactly these, which is what lets the panel
// choose a source at runtime without every row in it being a different type. The
// store's record shape never reaches a component: it is projected into these.
export interface SharedMediaItem {
  createdAt: number;
  flatKey: string;
  imageIndex: number;
  kind: "gif" | "image";
  // The viewer's download path needs this, and a stored row's only handle on the
  // media pipeline is its URL, so it is derived once at the read boundary rather
  // than re-derived by every consumer that wants to save an image.
  mediaId: string | null;
  messageId: string;
  senderId: string;
  url: string;
}

export interface SharedPostItem {
  // The caption the sender typed alongside the share, when there was one. Not
  // stored: a post's caption is not what the card renders, and storing it would
  // duplicate text the search index already holds. The live index fills it in
  // because it has the payload; the store does not, and the card does not need it.
  caption?: string;
  createdAt: number;
  flatKey: string;
  messageId: string;
  postId: string;
  senderId: string;
}

export interface SharedLinkItem {
  createdAt: number;
  flatKey: string;
  messageId: string;
  senderId: string;
  url: string;
}

export function mediaFlatKey(messageId: string, imageIndex: number): string {
  return `${messageId}:${imageIndex}`;
}

export function sharedRefFlatKey(messageId: string, index: number): string {
  return `${messageId}:${index}`;
}

export function sharedRefToMediaItem(record: SharedRefRecord): SharedMediaItem {
  const url = record.url ?? "";
  return {
    createdAt: record.createdAt,
    flatKey: mediaFlatKey(record.messageId, record.index),
    imageIndex: record.index,
    kind: record.mediaKind ?? "image",
    // Null for an external URL, which is what the media id regex is for: the
    // variant and download routes only exist for our own proxy paths.
    mediaId: url ? getMessageMediaId(url) : null,
    messageId: record.messageId,
    senderId: record.senderId,
    url,
  };
}

export function sharedRefToPostItem(record: SharedRefRecord): SharedPostItem {
  return {
    createdAt: record.createdAt,
    flatKey: sharedRefFlatKey(record.messageId, record.index),
    messageId: record.messageId,
    postId: record.postId ?? "",
    senderId: record.senderId,
  };
}

export function sharedRefToLinkItem(record: SharedRefRecord): SharedLinkItem {
  return {
    createdAt: record.createdAt,
    flatKey: sharedRefFlatKey(record.messageId, record.index),
    messageId: record.messageId,
    senderId: record.senderId,
    url: record.url ?? "",
  };
}
