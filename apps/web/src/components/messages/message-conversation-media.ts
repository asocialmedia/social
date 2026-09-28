import { getMediaImages } from "@/lib/messages/crypto";
import type { DecryptEntry } from "@/lib/messages/decryptor";
import type { SharedMediaItem } from "@/lib/messages/shared-refs-format";
import { getMessageMediaId } from "@/lib/utils/image-url";

// Flattens every decrypted media attachment across a conversation into one
// chronologically-ordered list, so the fullscreen viewer can page through all
// images - not just the album a tile was tapped in - and the details panel can
// lay them out as a grid.
//
// Pure apart from a module-level derivation cache, so ordering, flattening, and
// reuse rules stay unit-testable. Only DECRYPTED media payloads become items: a
// message's type is unknowable until its ciphertext is decrypted, so the index is
// a view of what the thread has already decrypted (plus whatever the viewer asks
// for).
//
// SCALE. This is rebuilt on every decrypt tick and every prepend, so each row's
// attachment list is memoized by message id (conversation-index-cache.ts). A
// rebuild is then one map lookup per row plus the array assembly, which is what
// keeps a very large window from re-walking every album on every tick. The cache
// also hands back the SAME item objects, so a memoized grid row still skips
// re-rendering when an unrelated message decrypts.

// Minimal shape the index needs from a transcript row. Keeping it structural
// avoids coupling this module to the full database message type.
//
// `createdAt` and `senderId` are here because the item the index produces carries
// them, and the panel's media tab sorts by time. A row without them would produce
// an item that cannot be merged with a stored one.
export interface ConversationMediaMessage {
  createdAt: Date | string;
  deletedAt: Date | null;
  id: string;
  senderId: string;
}

// The shared media item, plus the two fields the fullscreen viewer's own
// download and sizing paths use. Extending the shared type rather than
// restating it is what makes the live index and the stored rows interchangeable:
// a component that takes the shared type can take either.
export type ConversationMediaItem = SharedMediaItem & {
  height?: number;
  width?: number;
};

export interface ConversationMediaIndex {
  // flatKey -> position in `items`. Rebuilt each pass; cheap (media is sparse).
  indexByKey: Map<string, number>;
  items: ConversationMediaItem[];
  // The decryptor revision this index was built from. Carried so callers can
  // treat the index as a memo key without a second external-store read.
  revision: number;
}

export function mediaFlatKey(messageId: string, imageIndex: number): string {
  return `${messageId}:${imageIndex}`;
}

// Message ids are cuids (no colons), so the final separator reliably splits the
// image index back off.
export function messageIdFromFlatKey(flatKey: string): string {
  const separator = flatKey.lastIndexOf(":");
  return separator === -1 ? flatKey : flatKey.slice(0, separator);
}

// The attachments one decrypted media payload contributes, in send order, keyed
// by the payload OBJECT (not the message id: an edit re-decrypts into a new
// object, and a stale id-keyed entry would keep listing a replaced album).
//
// A WeakMap needs no eviction policy of its own — an entry dies with the payload
// object, and the decryptor's cache cap bounds how many of those exist. It is
// what keeps a rebuild (every decrypt tick, every prepend) to one lookup per row
// while still handing back the SAME item objects, so a memoized grid row skips
// re-rendering when an unrelated message decrypts.
const derivations = new WeakMap<object, ConversationMediaItem[]>();

// Index is the image's position WITHIN its message, so the keys are stable when
// an older page prepends.
function deriveMediaItems(
  message: ConversationMediaMessage,
  payload: Extract<DecryptEntry, object> & { type: "media" }
): ConversationMediaItem[] {
  const images = getMediaImages(payload);
  const items: ConversationMediaItem[] = [];
  for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
    const image = images[imageIndex];
    if (!image?.url) {
      continue;
    }
    items.push({
      createdAt: new Date(message.createdAt).getTime(),
      flatKey: mediaFlatKey(message.id, imageIndex),
      height: image.height,
      imageIndex,
      kind: payload.kind,
      mediaId: getMessageMediaId(image.url),
      messageId: message.id,
      senderId: message.senderId,
      url: image.url,
      width: image.width,
    });
  }
  return items;
}

export function buildConversationMediaIndex(
  messages: readonly ConversationMediaMessage[],
  getPayload: (id: string) => DecryptEntry | undefined,
  revision = 0
): ConversationMediaIndex {
  const items: ConversationMediaItem[] = [];
  const indexByKey = new Map<string, number>();

  for (const message of messages) {
    if (message.deletedAt) {
      continue;
    }
    const payload = getPayload(message.id);
    if (!payload || payload === "error" || payload === "pending") {
      continue;
    }
    if (payload.type !== "media") {
      continue;
    }
    let derived = derivations.get(payload);
    if (!derived) {
      derived = deriveMediaItems(message, payload);
      derivations.set(payload, derived);
    }
    for (const item of derived) {
      indexByKey.set(item.flatKey, items.length);
      items.push(item);
    }
  }

  return { indexByKey, items, revision };
}

// Test-only: whether a payload's attachments are already derived, so a test can
// assert the memo is doing its job without reaching into the cache.
export function hasConversationMediaDerivation(payload: object): boolean {
  return derivations.has(payload);
}
