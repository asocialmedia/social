import type { ExternalPost } from "@asm/protocols/contracts";
import {
  abortable,
  canRetryRead,
  FeedReadError,
  readDiscoveryPage,
  readDiscoveryWindow,
} from "@asm/protocols/discovery";
import type { DiscoveryMode, DiscoveryPage } from "@asm/protocols/discovery";

export interface BlueskyReadContext {
  timeoutMs?: number;
  scope?: string;
  content?: "all" | "video";
  locale?: string;
  profile?: string;
  surface?: "home" | "explore";
}

interface DiscoveryState {
  newItems: ExternalPost[];
  error: string | null;
  loadingMore: boolean;
  pages: DiscoveryPage[];
  status: "loading" | "success" | "error";
}

export function createBlueskyFeed(
  apiBase: string,
  mode: DiscoveryMode,
  baseFetch: (url: string, init: RequestInit) => Promise<Response> = fetch,
  following = false,
  context: BlueskyReadContext = {}
) {
  const { timeoutMs = 30_000, ...readContext } = context;
  let state: DiscoveryState = {
    error: null,
    loadingMore: false,
    newItems: [],
    pages: [],
    status: "loading",
  };
  let controller: AbortController | null = null;
  let headController: AbortController | null = null;
  let generation = 0;
  let retryable = false;
  let retryAt = 0;
  let failedRead: { cursor: string | null; replace: boolean } | null = null;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<DiscoveryState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      listener();
    }
  };
  async function load(cursor: string | null, replace: boolean) {
    if (controller) {
      return;
    }
    const current = new AbortController();
    const requestGeneration = generation;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      current.abort();
    }, timeoutMs);
    controller = current;
    update({
      error: null,
      loadingMore: !replace,
      status: state.pages.length === 0 ? "loading" : state.status,
    });
    try {
      const options = {
        ...readContext,
        baseUrl: apiBase,
        cursor,
        fetch: baseFetch,
        following,
        mode,
        signal: current.signal,
      };
      let expired = false;
      // Initial pages can be empty after server-side filtering and still have
      // a continuation. Advance those too: an empty list cannot be scrolled
      // to trigger onEndReached and would otherwise never load the next page.
      const knownIds = replace
        ? []
        : state.pages.flatMap((entry) => entry.items.map((item) => item.id));
      const read = (async () => {
        try {
          return await readDiscoveryWindow(options, new Set(knownIds));
        } catch (error) {
          if (
            cursor &&
            error instanceof FeedReadError &&
            error.status === 410
          ) {
            expired = true;
            return await readDiscoveryWindow(
              { ...options, cursor: null },
              new Set()
            );
          }
          throw error;
        }
      })();
      const page = await abortable(read, current.signal);
      if (generation !== requestGeneration || current.signal.aborted) {
        return;
      }
      // A bounded window that still has no new rows must wait for an explicit
      // retry. Auto-paging it again can loop forever on repeated cursors.
      if (page.items.length === 0 && page.cursor) {
        throw new FeedReadError(502);
      }
      failedRead = null;
      retryable = false;
      update({
        newItems: replace ? [] : state.newItems,
        pages: replace || expired ? [page] : [...state.pages, page],
        status: "success",
      });
    } catch (error) {
      if (
        generation === requestGeneration &&
        (!current.signal.aborted || timedOut)
      ) {
        const failure = timedOut ? new FeedReadError(408) : error;
        failedRead = { cursor, replace };
        retryable = canRetryRead(failure);
        retryAt =
          Date.now() +
          Math.max(
            failure instanceof FeedReadError ? failure.retryAfter : 0,
            30_000
          );
        update({
          error: "Bluesky is temporarily unavailable. Try again shortly.",
          status: "error",
        });
      }
    } finally {
      clearTimeout(timer);
      if (controller === current) {
        controller = null;
        update({ loadingMore: false });
      }
    }
  }
  const cancel = () => {
    generation += 1;
    controller?.abort();
    controller = null;
    headController?.abort();
    headController = null;
  };
  const probe = async () => {
    if (headController || controller) {
      return;
    }
    if (state.pages.length === 0) {
      return load(null, true);
    }
    const current = new AbortController();
    headController = current;
    try {
      const page = await readDiscoveryPage({
        ...readContext,
        baseUrl: apiBase,
        cursor: null,
        fetch: baseFetch,
        following,
        mode,
        refresh: following,
        signal: current.signal,
      });
      if (current.signal.aborted) {
        return;
      }
      const known = new Set(
        state.pages.flatMap((entry) => entry.items.map((item) => item.id))
      );
      const pending = new Set(state.newItems.map((post) => post.id));
      const fresh = page.items.filter(
        (item) => !known.has(item.id) && !pending.has(item.id)
      );
      const [first] = state.pages;
      if (first && fresh.length) {
        update({ newItems: [...fresh, ...state.newItems].slice(0, 100) });
      }
    } catch {
      // A background failure retains both the visible content and continuation cursor.
    } finally {
      if (headController === current) {
        headController = null;
      }
    }
  };
  return {
    acceptNew: () => {
      const [first, ...rest] = state.pages;
      if (first && state.newItems.length) {
        update({
          newItems: [],
          pages: [
            { ...first, items: [...state.newItems, ...first.items] },
            ...rest,
          ],
        });
      }
    },
    activate: () => {
      if (
        state.pages.length === 0 ||
        (failedRead && retryable && Date.now() >= retryAt)
      ) {
        void load(null, true);
      }
    },
    dispose: () => {
      cancel();
      failedRead = null;
      retryable = false;
      update({
        error: null,
        loadingMore: false,
        newItems: [],
        pages: [],
        status: "loading",
      });
    },
    fetchNext: () => {
      const cursor = state.pages.at(-1)?.cursor;
      if (cursor && !state.error) {
        return load(cursor, false);
      }
      return Promise.resolve();
    },
    // Backgrounding a tab only cancels in-flight reads. Loaded pages stay
    // cached (like the native feedCache) so returning paints instantly and
    // never refetches: the background wipe used to drop scrolled pages and
    // reshuffle the mixed rows on return.
    pause: () => {
      cancel();
      update({ loadingMore: false });
    },
    probe,
    recover: () => {
      if (failedRead && retryable && Date.now() >= retryAt) {
        return load(failedRead.cursor, failedRead.replace);
      }
      return Promise.resolve();
    },
    refresh: () => {
      cancel();
      return load(null, true);
    },
    // A manual retry of whatever read failed, ignoring the background backoff:
    // a failed later page re-reads its cursor and keeps the loaded pages.
    retry: () => {
      if (failedRead) {
        return load(failedRead.cursor, failedRead.replace);
      }
      return load(null, true);
    },
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
