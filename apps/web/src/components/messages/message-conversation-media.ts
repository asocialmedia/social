import { getMediaImages } from "@/lib/messages/crypto";
import type { DecryptEntry } from "@/lib/messages/decryptor";
import { getMessageMediaId } from "@/lib/utils/image-url";

// Flattens every decrypted media attachment across a conversation into one
// chronologically-ordered list, so the fullscreen viewer can page through all
// images - not just the album a tile was tapped in.
//
// Pure apart from a module-level structural-sharing cache keyed by the input
// message array, so ordering, flattening, and reuse rules stay unit-testable.
// Only DECRYPTED media payloads become items: a message's type is unknowable
// until its ciphertext is decrypted, so the index is a view of what the thread
// has already decrypted (plus whatever the viewer asks for).

// Minimal shape the index needs from a transcript row. Keeping it structural
// avoids coupling this module to the full database message type.
export interface ConversationMediaMessage {
  deletedAt: Date | null;
  id: string;
}

export interface ConversationMediaItem {
  caption?: string;
  // `${messageId}:${imageIndex}` - stable across pagination, decrypt ticks, and
  // re-renders, so navigation anchors never drift when items are prepended.
  flatKey: string;
  height?: number;
  imageIndex: number;
  kind: "gif" | "image";
  mediaId: string | null;
  messageId: string;
  url: string;
  width?: number;
}

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

// One item cache per input array. The transcript array is stable across decrypt
// ticks (it only changes when query data changes), so keying on it gives
// structural sharing across ticks while letting stale caches be collected.
const cachesByMessages = new WeakMap<
  readonly ConversationMediaMessage[],
  Map<string, ConversationMediaItem>
>();

// Builds the ordered index, reusing item objects from the per-array cache so an
// unchanged attachment keeps its identity. Structural sharing stops the
// viewer's image and filmstrip from remounting on unrelated decrypt ticks.
export function buildConversationMediaIndex(
  messages: readonly ConversationMediaMessage[],
  getPayload: (id: string) => DecryptEntry | undefined,
  revision = 0
): ConversationMediaIndex {
  let cache = cachesByMessages.get(messages);
  if (!cache) {
    cache = new Map();
    cachesByMessages.set(messages, cache);
  }

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
    const images = getMediaImages(payload);
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = images[imageIndex];
      const flatKey = mediaFlatKey(message.id, imageIndex);
      let item = cache.get(flatKey);
      if (!item) {
        item = {
          caption: payload.content,
          flatKey,
          height: image.height,
          imageIndex,
          kind: payload.kind,
          mediaId: getMessageMediaId(image.url),
          messageId: message.id,
          url: image.url,
          width: image.width,
        };
        cache.set(flatKey, item);
      }
      indexByKey.set(flatKey, items.length);
      items.push(item);
    }
  }

  // Drop cached items whose message was deleted or fell out of the loaded
  // window, so the cache tracks live media instead of growing forever.
  if (cache.size > items.length) {
    for (const key of cache.keys()) {
      if (!indexByKey.has(key)) {
        cache.delete(key);
      }
    }
  }

  return { indexByKey, items, revision };
}
