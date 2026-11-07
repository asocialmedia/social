// Pure read rules for the three shared-content tabs (media / posts / links).
// Ported from apps/web/src/components/messages/use-shared-refs-reader.ts.
//
// The native tabs read from the server (`fetchSharedConversationItems`) rather
// than from a local search index, so the store read/poll machinery has no
// native twin. What IS shared is everything that decides what the tabs show
// once rows arrive: where a kind's cursor goes after a page lands, how a live
// message's refs merge into held rows, and which link rows are really in-app
// post shares. Those rules are pure here so both clients page and merge the
// same way.

// Rows per read. Large enough that a few fills cover a scrolling grid, small
// enough that the first paint of a tab is one cheap range read.
export const SHARED_REFS_PAGE_SIZE = 60;

export type SharedRefKind = "link" | "media" | "post";
export type SharedRefsReadMode = "more" | "refresh";

// Where a kind's cursor goes after a page lands.
//
// The cursor names the OLDEST row the list holds, so the read that FIRST fills
// the list has to set it -- not just the reads that extend it. Filling is a
// top-of-list read, which legitimately leaves the returned cursor alone because
// prepending a page does not move the oldest row; without this rule the first
// "load older" would go out with no cursor and get page one back -- the newest
// sixty rows -- which the "more" merge would then APPEND, growing a second
// copy of the first screen at the bottom.
export function nextPagingCursor(input: {
  // The cursor the page just returned, i.e. `page.after`.
  after: string | undefined;
  // The kind's cursor as it stands.
  currentAfter: string | undefined;
  currentDone: boolean;
  hasMore: boolean;
  mode: SharedRefsReadMode;
  started: boolean;
}): { after: string | undefined; done: boolean } {
  if (input.mode === "more" || !input.started) {
    return { after: input.after, done: !input.hasMore };
  }
  return { after: input.currentAfter, done: input.currentDone };
}

// History indexing can discover older refs after the first screen has loaded.
// Merge by identity and timestamp, rather than assuming every refresh is newer.
export function mergeRefs<T extends { flatKey: string; createdAt: number }>(
  current: T[],
  page: T[],
  _mode: SharedRefsReadMode
): T[] {
  if (current.length === 0) {
    return page;
  }
  const held = new Set(current.map((item) => item.flatKey));
  const fresh = page.filter((item) => !held.has(item.flatKey));
  return fresh.length === 0
    ? current
    : [...current, ...fresh].toSorted(
        (a, b) =>
          b.createdAt - a.createdAt || a.flatKey.localeCompare(b.flatKey)
      );
}

export interface SharedLinkRow {
  createdAt: number;
  flatKey: string;
  messageId: string;
  senderId: string;
  url: string;
}

export interface SharedPostRow {
  createdAt: number;
  flatKey: string;
  messageId: string;
  postId: string;
  senderId: string;
}

// Splits stored link rows into in-app post shares and external links, and folds
// the in-app ones into the post list. Pure so the rule is testable without a
// store. The device has no window origin, so the caller passes a classifier
// (native: message-links postIdFromUrl with the API + production origins).
export function classifyRefs(
  posts: readonly SharedPostRow[],
  links: readonly SharedLinkRow[],
  postIdFromLinkUrl: (url: string) => string | null
): { classifiedLinks: SharedLinkRow[]; classifiedPosts: SharedPostRow[] } {
  const classifiedLinks: SharedLinkRow[] = [];
  const extraPosts: SharedPostRow[] = [];
  for (const link of links) {
    const postId = postIdFromLinkUrl(link.url);
    if (postId) {
      // The flatKey is the LINK's key, which is already stable per message and
      // position; reusing it keeps a row's key from changing when a link is
      // reclassified as a post on a later open.
      extraPosts.push({
        createdAt: link.createdAt,
        flatKey: link.flatKey,
        messageId: link.messageId,
        postId,
        senderId: link.senderId,
      });
    } else {
      classifiedLinks.push(link);
    }
  }
  return {
    classifiedLinks,
    // Newest first overall, and the two sources are already each ordered, so a
    // merge by time is enough.
    classifiedPosts: [...posts, ...extraPosts].toSorted(
      (a, b) => b.createdAt - a.createdAt
    ),
  };
}
