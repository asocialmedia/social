"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SearchIndexStore } from "@/lib/messages/search-index-format";
import {
  sharedRefToLinkItem,
  sharedRefToMediaItem,
  sharedRefToPostItem,
} from "@/lib/messages/shared-refs-format";
import type {
  SharedLinkItem,
  SharedMediaItem,
  SharedPostItem,
  SharedRefKind,
} from "@/lib/messages/shared-refs-format";
import { postIdFromUrl } from "@/lib/posts/post-url";

import type { SharedContentMessage } from "./conversation-shared-content";
import { useConversationMediaIndex } from "./use-conversation-media";
import { useConversationSharedContent } from "./use-conversation-shared-content";

// Reads the three shared-content tabs from the LOCAL INDEX rather than from the
// decrypted window, and falls back to the window when there is no index to read.
//
// The fallback is not a nicety, it is the whole reason the store can be treated
// as the primary source: IndexedDB is absent in private browsing on some engines,
// the memory backend is per-session, and a conversation opened for the first time
// has no rows yet. In every one of those cases the tabs must still show what the
// thread has decrypted, which is exactly what the in-memory indexers build.
//
// So the two are never merged. Merging would mean deduplicating two orderings and
// two key schemes on every read, to arrive at a list the store already had; and
// the store is strictly better where it exists, because it covers history the
// decryptor has long since evicted. The window is used only when the store cannot
// answer, and the reader says so rather than implying the tab is empty.
//
// Paging is keyset, one page at a time, appended to a list the virtualizer
// measures. That is the same shape the transcript uses, and it is what keeps a
// conversation with 200k messages at a couple of dozen mounted rows: the store
// read is O(page), not O(conversation).

// Rows per read. Large enough that a few fills cover a scrolling grid, small
// enough that the first paint of a tab is one cheap range read.
export const SHARED_REFS_PAGE_SIZE = 60;

export type SharedRefsReadState =
  | "indexed"
  // No index to read: IndexedDB is unavailable, the store is not resolved yet, or
  // every read failed. The tabs fall back to the decrypted window.
  | "window"
  | "indexing";

export interface SharedRefsReader {
  // Per-kind totals across the whole conversation, for the tab labels. Zero when
  // unknown, which is why the label only appears once it means something.
  counts: { link: number; media: number; post: number };
  links: SharedLinkItem[];
  linksError: boolean;
  loadMoreLinks: () => void;
  loadMorePosts: () => void;
  loadMoreMedia: () => void;
  media: SharedMediaItem[];
  mediaError: boolean;
  posts: SharedPostItem[];
  postsError: boolean;
  state: SharedRefsReadState;
}

const EMPTY_COUNTS = { link: 0, media: 0, post: 0 };

// One page cursor per kind. Kept in a ref so a re-render mid-page cannot reset it
// and re-read page one, which is the failure a `useState` cursor invites.
interface PagingState {
  after: Record<SharedRefKind, string | undefined>;
  done: Record<SharedRefKind, boolean>;
  inFlight: Record<SharedRefKind, boolean>;
  // The index token these cursors belong to. A read started under an older token
  // is discarded on arrival: a walk that committed while it was in flight has
  // already added rows above its cursor, so appending its page puts a newer
  // message's page below an older one and the tab's order is wrong for good.
  token: number;
}

function newPagingState(token: number): PagingState {
  return {
    after: { link: undefined, media: undefined, post: undefined },
    done: { link: false, media: false, post: false },
    inFlight: { link: false, media: false, post: false },
    token,
  };
}

export type ReadMode = "more" | "refresh";

// Folds a page into the rows a kind already holds.
//
// "more" appends. That is safe with no sort: the store returned rows strictly
// below the cursor, so the list stays newest-first by construction.
//
// "refresh" PREPENDS the rows it has not seen, and this is where the seam matters.
// The top page overlaps the rows already held as soon as a user has scrolled past
// the first screen, so appending would duplicate them and prepending
// unconditionally would repeat the whole overlap on every live message. The flat
// key is the identity to dedupe on: message plus ref position, which is what the
// store recorded and what a mounted virtualized row is anchored on.
//
// The order survives: new refs are newer than everything held, so they go in
// front, and the older rows keep their relative order behind them.
export function mergeRefs<T extends { flatKey: string }>(
  current: T[],
  page: T[],
  mode: ReadMode
): T[] {
  if (mode === "more") {
    return current.length === 0 ? page : [...current, ...page];
  }
  if (page.length === 0 || current.length === 0) {
    return current.length === 0 ? page : current;
  }
  const held = new Set(current.map((item) => item.flatKey));
  const fresh = page.filter((item) => !held.has(item.flatKey));
  return fresh.length === 0 ? current : [...fresh, ...current];
}

export function useSharedRefsReader(input: {
  conversationId: string;
  // Bumped by the thread whenever the index commits, so the tabs re-read what a
  // walk or a live message just wrote. The transcript already bumps this for
  // search; the refs ride the same signal rather than adding a subscription of
  // their own.
  refreshToken: number;
  store: SearchIndexStore | null;
  messages: readonly SharedContentMessage[];
  // A run in progress, so the tabs can say "indexing" instead of implying the
  // list is complete.
  indexing: boolean;
}): SharedRefsReader {
  const { conversationId, indexing, messages, refreshToken, store } = input;
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [media, setMedia] = useState<SharedMediaItem[]>([]);
  const [posts, setPosts] = useState<SharedPostItem[]>([]);
  const [links, setLinks] = useState<SharedLinkItem[]>([]);
  const [errors, setErrors] = useState({
    links: false,
    media: false,
    posts: false,
  });
  const [indexedUsable, setIndexedUsable] = useState(false);
  const paging = useRef<PagingState>(newPagingState(refreshToken));

  // The decrypted-window fallbacks. Both are computed unconditionally: they are
  // cheap when the store answers (the derivation is memoized per payload) and they
  // are the whole answer when it does not.
  const windowMedia = useConversationMediaIndex(messages);
  const windowShared = useConversationSharedContent(messages);

  // One read, in one of two modes.
  //
  // "more" continues from the kind's cursor, which is what a "load older" tap
  // means, and it is the only mode that moves that cursor.
  //
  // "refresh" reads from the TOP and merges. The index grew, so the new refs sit
  // above everything held. Restarting the list instead would throw away every page
  // a user had already scrolled into, on every live message, which turns a busy
  // conversation into a grid that keeps resetting under the finger.
  const readPage = useCallback(
    async (kind: SharedRefKind, mode: ReadMode) => {
      const state = paging.current;
      if (!store || state.inFlight[kind]) {
        return;
      }
      if (mode === "more" && state.done[kind]) {
        return;
      }
      const { token } = state;
      state.inFlight[kind] = true;
      // A nested function so the in-flight flag clears on ONE tail statement
      // rather than a `finally`, which the React compiler cannot lower and which
      // would opt this whole callback out of compilation.
      const read = async (): Promise<void> => {
        try {
          const page = await store.readSharedRefs(conversationId, kind, {
            after: mode === "more" ? state.after[kind] : undefined,
            limit: SHARED_REFS_PAGE_SIZE,
          });
          if (paging.current !== state || state.token !== token) {
            // A newer read for this conversation replaced this one, or the index
            // committed a page above our cursor while this one was in flight.
            // Either way this page is stale: appending it would put newer rows
            // below older ones, and the tab's order stays wrong.
            return;
          }
          if (mode === "more") {
            state.after[kind] = page.after;
            state.done[kind] = !page.hasMore;
          }
          if (kind === "media") {
            setMedia((current) =>
              mergeRefs(current, page.items.map(sharedRefToMediaItem), mode)
            );
          } else if (kind === "post") {
            setPosts((current) =>
              mergeRefs(current, page.items.map(sharedRefToPostItem), mode)
            );
          } else {
            setLinks((current) =>
              mergeRefs(current, page.items.map(sharedRefToLinkItem), mode)
            );
          }
          setIndexedUsable(true);
          setErrors((current) => ({ ...current, [kind]: false }));
        } catch {
          // A read failure is "no index for this tab", not a crash: the tab falls
          // back to the decrypted window, and the next open tries again.
          setErrors((current) => ({ ...current, [kind]: true }));
          state.done[kind] = true;
        }
      };
      await read();
      // Cleared on every path. The flag lives on the paging state, so a stale
      // `true` here cannot block a retry of the current conversation.
      state.inFlight[kind] = false;
    },
    [conversationId, store]
  );

  // First page per kind, and the labels. Re-runs when the store resolves, when
  // the thread commits an index write, and on a conversation change.
  useEffect(() => {
    if (!store) {
      return;
    }
    let cancelled = false;
    // A committed write re-reads the top of each kind and merges, which is how a
    // live message's media appears while the tab is open. The rows already held
    // and the "more" cursors are left alone, so paged-in history survives.
    paging.current.token = refreshToken;
    void (async () => {
      try {
        const stored = await store.readSharedRefsCounts(conversationId);
        if (cancelled) {
          return;
        }
        if (stored) {
          setCounts({
            link: stored.link,
            media: stored.media,
            post: stored.post,
          });
        }
      } catch {
        // No labels rather than a wrong one.
      }
      await Promise.all([
        readPage("media", "refresh"),
        readPage("post", "refresh"),
        readPage("link", "refresh"),
      ]);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, readPage, refreshToken, store]);

  const loadMore = useCallback(
    (kind: SharedRefKind) => {
      void readPage(kind, "more");
    },
    [readPage]
  );

  // The in-app/external split, at READ time. The stored row is just a URL, because
  // the answer depends on the site origin and a row written on a dev origin would
  // be wrong in production. A link that resolves to an in-app post is a POST
  // share, so it moves between the two tabs here and is never listed twice.
  const origin =
    typeof window === "undefined" ? undefined : window.location.origin;
  const { classifiedLinks, classifiedPosts } = useMemo(
    () => classifyRefs(posts, links, origin),
    [links, origin, posts]
  );

  const useWindow = !indexedUsable;
  // "window" is a whole-conversation claim, so it outranks the other two: while
  // the reader is on the live fallback the counts ARE the window, and telling the
  // user it is "indexing" would promise a backfill this device may not be running.
  let state: SharedRefsReadState = "indexed";
  if (indexing) {
    state = "indexing";
  }
  if (useWindow) {
    state = "window";
  }

  return {
    counts: useWindow
      ? {
          link: windowShared.links.length,
          media: windowMedia.items.length,
          post: windowShared.posts.length,
        }
      : counts,
    links: useWindow ? windowShared.links : classifiedLinks,
    linksError: !useWindow && errors.links,
    loadMoreLinks: useCallback(() => loadMore("link"), [loadMore]),
    loadMoreMedia: useCallback(() => loadMore("media"), [loadMore]),
    loadMorePosts: useCallback(() => loadMore("post"), [loadMore]),
    media: useWindow ? windowMedia.items : media,
    mediaError: !useWindow && errors.media,
    posts: useWindow ? windowShared.posts : classifiedPosts,
    postsError: !useWindow && errors.posts,
    state,
  };
}

interface ClassifiedRefs {
  classifiedLinks: SharedLinkItem[];
  classifiedPosts: SharedPostItem[];
}

// Splits stored link rows into in-app post shares and external links, and folds
// the in-app ones into the post list. Pure so the rule is testable without a store.
export function classifyRefs(
  posts: readonly SharedPostItem[],
  links: readonly SharedLinkItem[],
  origin: string | undefined
): ClassifiedRefs {
  if (!origin) {
    return { classifiedLinks: [...links], classifiedPosts: [...posts] };
  }
  const classifiedLinks: SharedLinkItem[] = [];
  const extraPosts: SharedPostItem[] = [];
  for (const link of links) {
    const postId = postIdFromUrl(link.url, origin);
    if (postId) {
      // The flatKey is the LINK's key, which is already stable per message and
      // position; reusing it keeps a virtualized row's key from changing when a
      // link is reclassified as a post on a later open.
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
