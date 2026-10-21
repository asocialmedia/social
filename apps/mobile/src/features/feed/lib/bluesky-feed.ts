import type { ExternalPost } from "@asm/protocols/contracts";
import {
  canRetryRead,
  FeedReadError,
  readDiscoveryPage,
  readDiscoveryWindow,
} from "@asm/protocols/discovery";
import type { DiscoveryMode, DiscoveryPage } from "@asm/protocols/discovery";

export interface BlueskyReadContext {
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
  let expiry: ReturnType<typeof setTimeout> | undefined;
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
    controller = current;
    update({
      error: null,
      loadingMore: !replace,
      status: state.pages.length === 0 ? "loading" : state.status,
    });
    try {
      const options = {
        ...context,
        baseUrl: apiBase,
        cursor,
        fetch: baseFetch,
        following,
        mode,
        signal: current.signal,
      };
      let expired = false;
      const page = await (
        replace
          ? readDiscoveryPage(options)
          : readDiscoveryWindow(
              options,
              new Set(
                state.pages.flatMap((entry) =>
                  entry.items.map((item) => item.id)
                )
              )
            )
      ).catch(async (error: unknown) => {
        if (cursor && error instanceof FeedReadError && error.status === 410) {
          expired = true;
          return await readDiscoveryPage({ ...options, cursor: null });
        }
        throw error;
      });
      if (generation !== requestGeneration || current.signal.aborted) {
        return;
      }
      failedRead = null;
      retryable = false;
      update({
        newItems: replace ? [] : state.newItems,
        pages: replace || expired ? [page] : [...state.pages, page],
        status: "success",
      });
    } catch (error) {
      if (generation === requestGeneration && !current.signal.aborted) {
        failedRead = { cursor, replace };
        retryable = canRetryRead(error);
        retryAt =
          Date.now() +
          Math.max(
            error instanceof FeedReadError ? error.retryAfter : 0,
            30_000
          );
        update({
          error: "Bluesky is temporarily unavailable. Try again shortly.",
          status: "error",
        });
      }
    } finally {
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
        ...context,
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
      clearTimeout(expiry);
      if (
        state.pages.length === 0 ||
        (failedRead && retryable && Date.now() >= retryAt)
      ) {
        void load(null, true);
      }
    },
    dispose: () => {
      clearTimeout(expiry);
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
      if (cursor && (!state.error || retryable)) {
        return load(cursor, false);
      }
      return Promise.resolve();
    },
    pause: () => {
      cancel();
      update({ loadingMore: false });
      clearTimeout(expiry);
      expiry = setTimeout(
        () => update({ newItems: [], pages: [], status: "loading" }),
        120_000
      );
      expiry.unref?.();
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
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
