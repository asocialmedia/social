import type { ExternalPost } from "@asm/protocols/contracts";
import {
  abortable,
  canRetryRead,
  feedHeadFreshMs,
  FeedReadError,
  readDiscoveryPage,
  readDiscoveryWindow,
} from "@asm/protocols/discovery";
import type {
  DiscoveryMode,
  DiscoveryPage,
  FeedSourceStatus,
} from "@asm/protocols/discovery";

export interface BlueskyReadContext {
  timeoutMs?: number;
  scope?: string;
  content?: "all" | "video";
  locale?: string;
  profile?: string;
  surface?: "home" | "explore";
  mixed?: boolean;
}

interface DiscoveryState {
  newItems: ExternalPost[];
  error: string | null;
  loadingMore: boolean;
  refreshing: boolean;
  pages: DiscoveryPage[];
  status: "loading" | "success" | "error";
  sourceStatus?: FeedSourceStatus;
}

function nextReadRetryAt(failure: unknown) {
  return (
    Date.now() +
    Math.max(failure instanceof FeedReadError ? failure.retryAfter : 0, 30_000)
  );
}

export function createBlueskyFeed(
  apiBase: string,
  mode: DiscoveryMode,
  baseFetch: (url: string, init: RequestInit) => Promise<Response> = fetch,
  following = false,
  context: BlueskyReadContext = {}
) {
  const { timeoutMs = context.mixed ? 10_000 : 30_000, ...readContext } =
    context;
  let state: DiscoveryState = {
    error: null,
    loadingMore: false,
    newItems: [],
    pages: [],
    refreshing: false,
    status: "loading",
  };
  let controller: AbortController | null = null;
  let headController: AbortController | null = null;
  let generation = 0;
  let retryable = false;
  let retryAt = 0;
  let headRetryAt = 0;
  let headLoadedAt = 0;
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
    let retryCursor = cursor;
    let retryReplace = replace;
    const timer = setTimeout(() => {
      timedOut = true;
      current.abort();
    }, timeoutMs);
    controller = current;
    update({
      error: null,
      loadingMore: !replace,
      refreshing: replace && state.pages.length > 0,
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
        retryCursor = page.cursor;
        retryReplace = replace || expired;
        throw new FeedReadError(502);
      }
      failedRead = null;
      retryable = false;
      if (!replace && page.sourceStatus) {
        update({ sourceStatus: page.sourceStatus });
        return;
      }
      if (replace && !page.sourceStatus) {
        headLoadedAt = Date.now();
        headRetryAt = 0;
      }
      update({
        newItems: replace ? [] : state.newItems,
        pages: replace || expired ? [page] : [...state.pages, page],
        sourceStatus: page.sourceStatus,
        status: "success",
      });
    } catch (error) {
      if (
        generation === requestGeneration &&
        (!current.signal.aborted || timedOut)
      ) {
        const failure = timedOut ? new FeedReadError(408) : error;
        failedRead = { cursor: retryCursor, replace: retryReplace };
        retryable = canRetryRead(failure);
        retryAt = nextReadRetryAt(failure);
        update({
          error: "Bluesky is temporarily unavailable. Try again shortly.",
          status: "error",
        });
      }
    } finally {
      clearTimeout(timer);
      if (controller === current) {
        controller = null;
        update({ loadingMore: false, refreshing: false });
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
  const probe = async (mergeHead = false) => {
    if (
      headController ||
      controller ||
      headRetryAt > Date.now() ||
      (failedRead?.replace && (!retryable || retryAt > Date.now())) ||
      (state.sourceStatus?.retryAt ?? 0) > Date.now()
    ) {
      return;
    }
    if (state.pages.length === 0) {
      return load(null, true);
    }
    const tail = state.pages.at(-1);
    const recoverContinuation = Boolean(tail?.sourceStatus && !tail.cursor);
    const current = new AbortController();
    headController = current;
    try {
      const page = await readDiscoveryPage({
        ...readContext,
        baseUrl: apiBase,
        cursor: null,
        fetch: baseFetch,
        following,
        // A restored continuation must use the feed's mode, not the latest-post probe.
        mode:
          !mergeHead &&
          !recoverContinuation &&
          !following &&
          mode === "personalized"
            ? "latest"
            : mode,
        refresh: true,
        signal: current.signal,
      });
      if (current.signal.aborted) {
        return;
      }
      const known = new Set(
        state.pages.flatMap((entry) => entry.items.map((item) => item.id))
      );
      const fresh = page.items.filter((item) => !known.has(item.id));
      const patch: Partial<DiscoveryState> = {
        sourceStatus: page.sourceStatus,
      };
      if (recoverContinuation && !page.sourceStatus) {
        const currentTail = state.pages.at(-1);
        if (!currentTail?.sourceStatus || currentTail.cursor) {
          return;
        }
        patch.pages = [
          ...state.pages.slice(0, -1),
          { ...currentTail, cursor: page.cursor, sourceStatus: undefined },
        ];
        headLoadedAt = Date.now();
      }
      if (mergeHead && !page.sourceStatus) {
        headLoadedAt = Date.now();
        headRetryAt = 0;
        if (failedRead?.replace) {
          failedRead = null;
          retryable = false;
          patch.error = null;
          patch.status = "success";
        }
        const [first, ...rest] = patch.pages ?? state.pages;
        const admitted = new Set(fresh.map((item) => item.id));
        patch.pages = [
          { ...first, items: [...fresh, ...first.items] },
          ...rest,
        ];
        patch.newItems = state.newItems.filter(
          (item) => !admitted.has(item.id)
        );
      } else {
        const pending = new Set(state.newItems.map((post) => post.id));
        const unseen = fresh.filter((item) => !pending.has(item.id));
        if (unseen.length) {
          patch.newItems = [...unseen, ...state.newItems].slice(0, 100);
        }
      }
      update(patch);
    } catch (error) {
      // A background failure retains both the visible content and continuation cursor.
      if (mergeHead && !current.signal.aborted) {
        headRetryAt = canRetryRead(error) ? nextReadRetryAt(error) : Infinity;
      }
    } finally {
      if (headController === current) {
        headController = null;
      }
    }
  };
  const recover = () => {
    if (!failedRead || !retryable || Date.now() < retryAt) {
      return Promise.resolve();
    }
    return failedRead.replace && state.pages.length > 0
      ? probe(true)
      : load(failedRead.cursor, failedRead.replace);
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
      if (controller || (state.sourceStatus?.retryAt ?? 0) > Date.now()) {
        return;
      }
      if (failedRead) {
        void recover();
      } else if (state.pages.length === 0) {
        void load(null, true);
      } else if (
        headLoadedAt > 0 &&
        Date.now() - headLoadedAt >= feedHeadFreshMs
      ) {
        void probe(true);
      }
    },
    dispose: () => {
      cancel();
      failedRead = null;
      retryable = false;
      headRetryAt = 0;
      update({
        error: null,
        loadingMore: false,
        newItems: [],
        pages: [],
        sourceStatus: undefined,
        status: "loading",
      });
    },
    fetchNext: () => {
      const cursor = state.pages.at(-1)?.cursor;
      if (cursor && !state.error && !state.sourceStatus) {
        return load(cursor, false);
      }
      return Promise.resolve();
    },
    // Keep loaded pages during short detours. Activation refreshes an expired head.
    pause: () => {
      cancel();
      update({ loadingMore: false, refreshing: false });
    },
    probe,
    recover,
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
