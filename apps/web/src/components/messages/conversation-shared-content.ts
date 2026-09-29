import type { DecryptEntry } from "@/lib/messages/decryptor";
import { extractSharedRefs } from "@/lib/messages/message-shared-refs";
import type {
  SharedLinkItem,
  SharedPostItem,
} from "@/lib/messages/shared-refs-format";
import { postIdFromUrl } from "@/lib/posts/post-url";

// Derives the two "shared content" views of a conversation — the in-app posts
// people sent, and the links they pasted — from the loaded transcript. Same
// premise as message-conversation-media.ts: a payload's type is unknowable until
// its ciphertext is decrypted, so the index is a view of what the thread has
// already decrypted and grows as history pages load.
//
// One pass produces both lists, because a single walk over the transcript is the
// only expensive part and every payload is inspected once for both.
//
// Every occurrence is kept, in send order, and each share lands in EXACTLY ONE
// list: a link that resolves to an in-app post is a post share (it renders as
// the rich card), everything else is an external link. Splitting by what the
// link IS rather than by where it was typed is what keeps a pasted post URL from
// showing up in both tabs.
//
// SCALE. The walk is O(loaded rows) per rebuild and rebuilds happen on every
// decrypt tick and every prepend, so the per-row work is memoized behind
// `derivations` (see conversation-index-cache.ts): a row already seen costs one
// map lookup instead of a linkify pass over its body. What is left is O(rows)
// map reads, which is what makes a very large window survivable at all.

// Minimal shape the index needs from a transcript row. `createdAt` and
// `senderId` are here because the items carry them: the panel's tabs merge this
// index with the stored one, and a row without them would produce an item that
// cannot be merged.
export interface SharedContentMessage {
  createdAt: Date | string;
  deletedAt: Date | null;
  id: string;
  senderId: string;
}

export interface SharedContentIndex {
  links: SharedLinkItem[];
  posts: SharedPostItem[];
  // The decryptor revision this index was built from, so callers can treat the
  // index as a memo key without a second external-store read.
  revision: number;
}

// What one message contributes. Kept as a single record so the cache can hold
// both lists from one lookup.
interface MessageContribution {
  links: SharedLinkItem[];
  posts: SharedPostItem[];
}

export function sharedContentFlatKey(messageId: string, index: number): string {
  return `${messageId}:${index}`;
}

// What one decrypted payload contributes, memoized by the PAYLOAD OBJECT.
//
// The key is object identity rather than the message id, and that is the whole
// design:
//
//   - Exact. A message id survives an edit, so an id-keyed cache would keep
//     serving a rewritten message's old links and posts. A re-decrypt (edit, error
//     heal, identity reset) produces a new payload object, so the key changes and
//     the entry is re-derived.
//   - Free to bound. A WeakMap entry dies with the payload object, and the
//     decryptor already caps cached payloads, so this cache cannot outlive or
//     outgrow it — no eviction policy of its own to get wrong.
//   - Survives the churn that actually happens. These indexes are rebuilt on
//     every decrypt tick and every prepend, and the derivation is the expensive
//     part: `extractPostUrls` is a linkify-it pass over the body, measured at
//     about 20x the cost of the media index's work for the same row, and
//     rebuilding a 200k-row window from scratch measured 3.2 SECONDS per pass.
//     With this, a rebuild is one WeakMap read per row.
//
// Link classification reads the site origin, which cannot change within a page
// load (and a load resets this module), so the origin is not part of the key.
const derivations = new WeakMap<
  object,
  { links: SharedLinkItem[]; posts: SharedPostItem[] }
>();

// A payload that actually decrypted. The indexer only ever calls this with one,
// so the derivation is typed against the payload union rather than the
// decryptor's entry union, and its fields narrow without a second guard.
type DecryptedPayload = Exclude<DecryptEntry, "error" | "pending">;

// Derives one message's shares. Only the DECRYPTED payload matters, and an
// undecryptable one contributes nothing — the row is simply absent until it
// lands, at which point the derivation happens for the first time.
//
// This runs the SHARED extractor rather than re-deriving post ids, media and
// links here. That is the point of the extractor: the live index and the rows the
// local index persists have to come from one implementation, because when they
// disagreed the panel would list what the thread does not render.
function deriveContribution(
  message: SharedContentMessage,
  payload: DecryptedPayload,
  origin: string | undefined
): MessageContribution {
  const messageId = message.id;
  const createdAt = new Date(message.createdAt).getTime();
  const posts: SharedPostItem[] = [];
  const links: SharedLinkItem[] = [];

  // Item indices are per-message, exactly like the media index's imageIndex. A
  // conversation-global counter would renumber every later item when an older
  // page prepends, and a virtualized list anchored on a stable key would then
  // remount rows the user is looking at.
  let postIndex = 0;
  let linkIndex = 0;

  const extracted = extractSharedRefs(payload);
  if (!extracted) {
    return { links, posts };
  }

  for (const postId of extracted.postIds) {
    posts.push({
      // A caption belongs to the EXPLICIT share only. A post link pasted into a
      // body has no caption of its own, and the body is already in the text index.
      caption: postIndex === 0 ? payload.content : undefined,
      createdAt,
      flatKey: sharedContentFlatKey(messageId, postIndex),
      messageId,
      postId,
      senderId: message.senderId,
    });
    postIndex += 1;
  }

  // An in-app post link counts as a post share, matching what the thread renders:
  // the bubble shows the rich post card for it, not a link preview. Stored rows
  // cannot be classified this way, because the answer depends on the site origin
  // and a row written on one origin would be wrong on another — so the READER
  // does the same split there. One rule, named in both places.
  for (const url of extracted.links) {
    const postId = postIdFromUrl(url, origin);
    if (postId) {
      posts.push({
        createdAt,
        flatKey: sharedContentFlatKey(messageId, postIndex),
        messageId,
        postId,
        senderId: message.senderId,
      });
      postIndex += 1;
      continue;
    }
    links.push({
      createdAt,
      flatKey: sharedContentFlatKey(messageId, linkIndex),
      messageId,
      senderId: message.senderId,
      url,
    });
    linkIndex += 1;
  }

  return { links, posts };
}

export function buildConversationSharedContentIndex(
  messages: readonly SharedContentMessage[],
  getPayload: (id: string) => DecryptEntry | undefined,
  origin?: string,
  revision = 0
): SharedContentIndex {
  const posts: SharedPostItem[] = [];
  const links: SharedLinkItem[] = [];

  for (const message of messages) {
    if (message.deletedAt) {
      continue;
    }
    const payload = getPayload(message.id);
    if (!payload || payload === "error" || payload === "pending") {
      continue;
    }
    let contribution = derivations.get(payload);
    if (!contribution) {
      contribution = deriveContribution(message, payload, origin);
      derivations.set(payload, contribution);
    }
    for (const item of contribution.posts) {
      posts.push(item);
    }
    for (const item of contribution.links) {
      links.push(item);
    }
  }

  return { links, posts, revision };
}
