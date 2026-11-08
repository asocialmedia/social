import { orderedCopy } from "@/lib/format/ordered-copy";

import { getMediaImages } from "./crypto";
import type { DecryptEntry } from "./decryptor";
import type { MessageData } from "./types";

// Cross-message media windowing keys and page merging for the fullscreen viewer.
// Ported from apps/web/src/components/messages/message-conversation-media.ts.
//
// The fullscreen viewer walks a flat chrono list of every photo in the thread,
// not just the message it opened from. Rows are keyed `messageId:imageIndex`
// where the index is the photo's ordinal WITHIN its message, so the keys stay
// stable when an older page prepends above them.

// The fullscreen viewer's window cap. At most this many items are held while
// paging across messages.
export const CONVERSATION_MEDIA_VIEWER_WINDOW_LIMIT = 100;

export type ConversationMediaPageDirection = "initial" | "newer" | "older";

export function mediaFlatKey(messageId: string, imageIndex: number): string {
  return `${messageId}:${imageIndex}`;
}

// Message ids are cuids (no colons), so the final separator reliably splits the
// image index back off.
export function messageIdFromFlatKey(flatKey: string): string {
  const separator = flatKey.lastIndexOf(":");
  return separator === -1 ? flatKey : flatKey.slice(0, separator);
}

export interface ConversationMediaItem {
  createdAt: number;
  flatKey: string;
}

export interface ViewerMediaItem extends ConversationMediaItem {
  url: string;
}

// Flattens every decrypted photo/GIF across the loaded transcript into one
// chrono list, so the fullscreen viewer pages through all images in the
// thread, not just the album it opened from. Ported from web's
// buildConversationMediaIndex: only decrypted media payloads become items,
// index keys are the photo's ordinal within its message, and the order is
// (createdAt, messageId, imageIndex).
export function buildViewerMediaItems(
  messages: readonly MessageData[],
  getEntry: (messageId: string) => DecryptEntry | undefined,
  apiBase: string
): ViewerMediaItem[] {
  const items: ViewerMediaItem[] = [];
  for (const message of messages) {
    if (message.deletedAt) {
      continue;
    }
    const entry = getEntry(message.id);
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    if (entry.type !== "media") {
      continue;
    }
    const images = getMediaImages(entry);
    for (const [imageIndex, image] of images.entries()) {
      const url = image.url.startsWith("http")
        ? image.url
        : `${apiBase}${image.url}`;
      items.push({
        createdAt: new Date(message.createdAt).getTime(),
        flatKey: mediaFlatKey(message.id, imageIndex),
        url,
      });
    }
  }
  return orderedCopy(
    items,
    (a, b) => a.createdAt - b.createdAt || a.flatKey.localeCompare(b.flatKey)
  );
}

// Position of the tapped album tile inside the flattened viewer list. Falls
// back to the nearest end so a tile whose row has not decrypted yet still
// opens the viewer instead of nothing.
export function viewerAnchorIndex(
  items: readonly ViewerMediaItem[],
  messageId: string,
  imageIndex: number
): number {
  const at = items.findIndex(
    (item) => item.flatKey === mediaFlatKey(messageId, imageIndex)
  );
  if (at !== -1) {
    return at;
  }
  return items.length > 0 ? items.length - 1 : 0;
}

// Merges one incoming page of viewer items into the held window: dedupes by
// flatKey, time-sorts, and caps at the viewer limit. Paging older keeps the
// head, paging newer keeps the tail, and an initial/anchor read centers on the
// anchor (or falls back to the tail when the anchor is unknown).
export function mergeConversationMediaPage<T extends ConversationMediaItem>(
  current: readonly T[],
  incoming: readonly T[],
  direction: ConversationMediaPageDirection,
  anchorKey?: string,
  limit: number = CONVERSATION_MEDIA_VIEWER_WINDOW_LIMIT
): T[] {
  const capped = Math.min(
    CONVERSATION_MEDIA_VIEWER_WINDOW_LIMIT,
    Math.max(1, Math.trunc(limit))
  );
  const byKey = new Map<string, T>();
  for (const item of [...incoming, ...current]) {
    byKey.set(item.flatKey, item);
  }
  const sorted = orderedCopy(
    [...byKey.values()],
    (a, b) => a.createdAt - b.createdAt || a.flatKey.localeCompare(b.flatKey)
  );
  if (sorted.length <= capped) {
    return sorted;
  }
  if (direction === "older") {
    return sorted.slice(0, capped);
  }
  if (direction === "newer") {
    return sorted.slice(-capped);
  }
  const anchor = sorted.find((item) => item.flatKey === anchorKey);
  const centeredIndex = anchor ? sorted.indexOf(anchor) : sorted.length - 1;
  const startIndex = Math.max(
    0,
    Math.min(centeredIndex - Math.floor(capped / 2), sorted.length - capped)
  );
  return sorted.slice(startIndex, startIndex + capped);
}
