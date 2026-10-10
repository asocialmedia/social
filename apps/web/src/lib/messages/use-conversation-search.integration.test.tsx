import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import type {
  OfflineSearchCacheRecord,
  OfflineSearchPage,
} from "./offline-search-cache";
import type { MessageData } from "./types";
import { useConversationSearch } from "./use-conversation-search";
import type {
  ConversationSearch,
  ConversationSearchInput,
} from "./use-conversation-search";

const scope = { recoveryGeneration: 2, userId: "search-hook-user" };
const emptyMessages: MessageData[] = [];
const noDecrypt = () => {};
const offlineSearch = mock(
  (): Promise<OfflineSearchPage<OfflineSearchCacheRecord> | null> =>
    Promise.resolve({
      hasMore: false,
      hits: [
        {
          cachedAt: 1,
          ciphertext: "encrypted",
          conversationId: "conversation-1",
          createdAt: 1,
          id: "saved-1",
          iv: "iv",
          keyEpoch: 1,
          ratchetIndex: 1,
          references: [],
          revision: 1,
          senderId: "peer",
          terms: ["needle"],
        },
      ],
      nextCursor: null,
      previousCursor: null,
      totalMatches: 1,
    })
);
const offlineIndex = mock(() =>
  Promise.resolve({ indexed: 0, skipped: 0, success: true })
);
mock.module("./offline-search-worker-client", () => ({
  offlineSearchWorkerClient: {
    activateScope: () => Promise.resolve(true),
    index: offlineIndex,
    remove: () => Promise.resolve(true),
    search: offlineSearch,
  },
}));
mock.module("./decryptor", () => ({
  messageDecryptor: {
    get: () => ({ content: "needle other", type: "text" }),
    getVersion: () => 1,
    subscribe: () => () => {},
  },
}));
mock.module("./search-hydration", () => ({
  hydrateSearchHits: (input: {
    conversationId: string;
    hits: { id: string; createdAt: string }[];
  }) =>
    input.hits.map((hit) => ({
      ...hit,
      ciphertext: "encrypted",
      conversationId: input.conversationId,
      createdAt: new Date(hit.createdAt),
      deletedAt: null,
      editedAt: null,
      iv: "iv",
      keyEpoch: 1,
      ratchetIndex: 1,
      revision: 1,
      sender: null,
      senderId: "peer",
    })),
}));

let dom: Window;
let root: Root;
let search: ConversationSearch | null = null;
let props: ConversationSearchInput;
let fetchHandler: (
  input: RequestInfo | URL,
  init?: RequestInit
) => Response | Promise<Response>;
const fetchCalls: {
  body: Record<string, unknown>;
  signal?: AbortSignal | null;
  url: string;
}[] = [];
const globals = new Map<string, PropertyDescriptor | undefined>();

function Probe(input: ConversationSearchInput) {
  const result = useConversationSearch(input);
  useLayoutEffect(() => {
    search = result;
  }, [result]);
  return null;
}

function currentSearch(): ConversationSearch {
  if (!search) {
    throw new Error("Search hook did not render");
  }
  return search;
}

async function render(overrides: Partial<ConversationSearchInput> = {}) {
  props = { ...props, ...overrides };
  await act(() => {
    root.render(<Probe {...props} />);
  });
}

async function settle(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- allow React effects and debounce timers to settle before checking the next state
    await act(async () => {
      await Bun.sleep(10);
    });
  }
  expect(predicate()).toBe(true);
}

function searchResponse(
  page: number,
  query = "needle",
  countToken: string | null = null,
  coverageComplete = true,
  coverageSettled = true
): Response {
  return Response.json({
    countToken,
    coverage: {
      complete: coverageComplete,
      paused: false,
      settled: coverageSettled,
    },
    hits: Array.from({ length: 20 }, (_, index) => ({
      createdAt: new Date(
        1_700_000_000_000 - (page * 20 + index) * 1000
      ).toISOString(),
      id: `${query}-${page}-${index}`,
      keyEpoch: 1,
      ratchetIndex: page * 20 + index,
      revision: 1,
      senderId: "peer",
    })),
    nextCursor: `older-${page}`,
    previousCursor: page === 0 ? null : `newer-${page}`,
    snapshotToken: "snapshot-1",
  });
}

function savedSearchPage(
  index: number
): OfflineSearchPage<OfflineSearchCacheRecord> {
  return {
    hasMore: index === 0,
    hits: Array.from({ length: 20 }, (_, hit) => ({
      cachedAt: 1,
      ciphertext: "encrypted",
      conversationId: "conversation-1",
      createdAt: 100 - index * 20 - hit,
      id: `saved-${index}-${hit}`,
      iv: "iv",
      keyEpoch: 1,
      ratchetIndex: index * 20 + hit,
      references: [],
      revision: 1,
      senderId: "peer",
      terms: ["needle"],
    })),
    nextCursor: index === 0 ? { createdAt: 81, id: "saved-0-19" } : null,
    previousCursor: index === 0 ? null : { createdAt: 80, id: "saved-1-0" },
    totalMatches: 40,
  };
}

beforeEach(() => {
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Event",
    "IS_REACT_ACT_ENVIRONMENT",
    "fetch",
  ]) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  dom = new Window({ url: "http://localhost:3000" });
  for (const [key, value] of Object.entries({
    Event: dom.Event,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    document: dom.document,
    navigator: dom.navigator,
    window: dom,
  })) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
  const container = dom.document.createElement("div");
  dom.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
  props = {
    allMessages: emptyMessages,
    conversationId: "conversation-1",
    enabled: true,
    listPage: 0,
    offlineSearchScope: scope,
    requestDecryptBatch: noDecrypt,
    serverSearchEnabled: true,
  };
  search = null;
  fetchCalls.length = 0;
  offlineSearch.mockClear();
  offlineIndex.mockClear();
  fetchHandler = (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      cursor?: string;
      query: string;
    };
    let page = 0;
    if (body.cursor?.startsWith("older-")) {
      page = Number(body.cursor.slice(6)) + 1;
    }
    if (body.cursor?.startsWith("newer-")) {
      page = Number(body.cursor.slice(6)) - 1;
    }
    return searchResponse(page, body.query);
  };
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        body: JSON.parse(String(init?.body)),
        signal: init?.signal,
        url: String(input),
      });
      return fetchHandler(input, init);
    },
    writable: true,
  });
});

afterEach(async () => {
  await act(() => {
    root.unmount();
  });
  await dom.happyDOM.abort();
  dom.close();
  for (const [key, descriptor] of globals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  globals.clear();
});

describe("conversation search hook cutover", () => {
  test("settled coverage refresh keeps the selected cursor page and starts exact counting", async () => {
    let searchRequests = 0;
    fetchHandler = (input, init) => {
      if (String(input).endsWith("/search/count")) {
        return Response.json({ count: 37, state: "exact" });
      }
      const body = JSON.parse(String(init?.body)) as {
        cursor?: string;
        query: string;
        snapshot?: string;
      };
      const page = body.cursor?.startsWith("older-")
        ? Number(body.cursor.slice(6)) + 1
        : 0;
      searchRequests += 1;
      return searchResponse(
        page,
        body.query,
        searchRequests > 2 ? "count-token-1" : null,
        searchRequests > 2,
        searchRequests > 2
      );
    };

    await render();
    await act(() => currentSearch().setQuery("needle"));
    await settle(() => currentSearch().results[0]?.id === "needle-0-0");
    await render({ listPage: 1 });
    await settle(() => currentSearch().results[0]?.id === "needle-1-0");
    await settle(() => currentSearch().totalMatchesExact);

    expect(currentSearch().results[0]?.id).toBe("needle-1-0");
    expect(currentSearch().resultMessages).toHaveLength(40);
    expect(currentSearch().totalMatches).toBe(37);
    expect(currentSearch().countState).toBe("exact");
    const refresh = [...fetchCalls]
      .toReversed()
      .find(
        (call) => call.url.endsWith("/search") && call.body.cursor === "older-0"
      );
    expect(refresh?.body.cursor).toBe("older-0");
    expect(fetchCalls.some((call) => call.url.endsWith("/search/count"))).toBe(
      true
    );
  });

  test("paginates readable matches when settled coverage is partial", async () => {
    fetchHandler = (input, init) => {
      if (String(input).endsWith("/search/count")) {
        return Response.json({ state: "pending" });
      }
      const body = JSON.parse(String(init?.body)) as {
        cursor?: string;
        query: string;
      };
      const page = body.cursor?.startsWith("older-")
        ? Number(body.cursor.slice(6)) + 1
        : 0;
      return searchResponse(page, body.query, null, false);
    };

    await render();
    await act(() => {
      currentSearch().setQuery("needle");
    });
    await settle(() => currentSearch().results.length === 20);

    expect(currentSearch().serverCoverageUnavailable).toBe(true);
    expect(currentSearch().serverHasMore).toBe(true);
    expect(fetchCalls).toHaveLength(1);

    await render({ listPage: 1 });
    await settle(() => currentSearch().results[0]?.id === "needle-1-0");

    expect(currentSearch().serverCoverageUnavailable).toBe(true);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1]?.body.cursor).toBe("older-0");
  });

  test("disabled-server pagination reads only the next saved page and reuses adjacent cached pages", async () => {
    offlineSearch.mockResolvedValueOnce(savedSearchPage(0));
    offlineSearch.mockResolvedValueOnce(savedSearchPage(1));
    await render({ serverSearchEnabled: false });
    await act(() => {
      currentSearch().setQuery("needle");
    });
    await settle(() => currentSearch().results.length === 20);
    await render({ listPage: 1 });
    await settle(() => currentSearch().results[0]?.id === "saved-1-0");
    expect(offlineSearch).toHaveBeenCalledTimes(2);
    expect(offlineSearch).toHaveBeenLastCalledWith({
      before: { createdAt: 81, id: "saved-0-19" },
      conversationId: "conversation-1",
      limit: 20,
      query: "needle",
      scope,
    });
    await render({ listPage: 0 });
    expect(currentSearch().results[0]?.id).toBe("saved-0-0");
    expect(offlineSearch).toHaveBeenCalledTimes(2);
    expect(fetchCalls).toHaveLength(0);
  });
  test("a disabled server uses saved history without archive or network reads", async () => {
    await render({ serverSearchEnabled: false });
    await act(() => {
      currentSearch().setQuery("needle");
    });
    await settle(() => currentSearch().results.length === 1);
    expect(fetchCalls).toHaveLength(0);
    expect(offlineSearch).toHaveBeenCalledTimes(1);
    expect(currentSearch().savedHistorySearch).toBe(true);
    expect(currentSearch().offlineSearch).toBe(false);
    expect(currentSearch().serverCoverageIncomplete).toBe(false);
  });

  test("offline searches use saved history and reconnect automatically returns to the full-history server", async () => {
    Object.defineProperty(dom.navigator, "onLine", {
      configurable: true,
      value: false,
      writable: true,
    });
    await render();
    await act(() => {
      currentSearch().setQuery("needle");
    });
    await settle(() => currentSearch().results.length === 1);
    expect(currentSearch().offlineSearch).toBe(true);
    expect(fetchCalls).toHaveLength(0);
    await act(() => {
      Object.defineProperty(dom.navigator, "onLine", {
        configurable: true,
        value: true,
        writable: true,
      });
      dom.dispatchEvent(new dom.Event("online"));
    });
    await settle(() => currentSearch().results.length === 20);
    expect(currentSearch().savedHistorySearch).toBe(false);
    expect(currentSearch().offlineSearch).toBe(false);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.body.cursor).toBeUndefined();
  });

  test("access denials fail closed, while a service outage searches only saved history", async () => {
    fetchHandler = () => new Response(null, { status: 403 });
    await render();
    await act(() => {
      currentSearch().setQuery("needle");
    });
    await settle(() => currentSearch().searchError !== null);
    expect(offlineSearch).not.toHaveBeenCalled();
    expect(currentSearch().results).toHaveLength(0);
    fetchHandler = () => new Response(null, { status: 503 });
    await act(() => {
      currentSearch().retry();
    });
    await settle(() => currentSearch().results.length === 1);
    expect(currentSearch().savedHistorySearch).toBe(true);
    expect(currentSearch().offlineSearch).toBe(false);
    fetchHandler = () => searchResponse(0);
    await act(() => currentSearch().retry());
    await settle(() => currentSearch().results.length === 20);
    expect(currentSearch().savedHistorySearch).toBe(false);
    expect(currentSearch().searchError).toBeNull();
  });

  test("unavailable saved storage shows a retryable failure instead of a false empty scope", async () => {
    offlineSearch.mockResolvedValueOnce(null);
    await render({ serverSearchEnabled: false });
    await act(() => {
      currentSearch().setQuery("needle");
    });
    await settle(() => currentSearch().searchError !== null);
    expect(currentSearch().results).toHaveLength(0);
    expect(currentSearch().savedHistorySearch).toBe(false);
    expect(fetchCalls).toHaveLength(0);
    await act(() => {
      currentSearch().retry();
    });
    await settle(() => currentSearch().results.length === 1);
    expect(currentSearch().searchError).toBeNull();
  });

  test("a recovery generation change clears displayed results and starts a new snapshot", async () => {
    await render();
    await act(() => {
      currentSearch().setQuery("needle");
    });
    await settle(() => currentSearch().results.length === 20);
    await render({ listPage: 1 });
    await settle(() => currentSearch().results[0]?.id === "needle-1-0");
    const pending = Promise.withResolvers<Response>();
    fetchHandler = () => pending.promise;
    await render({
      listPage: 0,
      offlineSearchScope: { ...scope, recoveryGeneration: 3 },
    });
    expect(currentSearch().results).toHaveLength(0);
    expect(currentSearch().totalMatches).toBe(0);
    expect(fetchCalls.at(-1)?.body.cursor).toBeUndefined();
    await act(() => {
      pending.resolve(searchResponse(0));
    });
    await settle(() => currentSearch().results[0]?.id === "needle-0-0");
  });

  test("long forward and backward navigation keeps at most three hydrated pages", async () => {
    fetchHandler = (input, init) => {
      if (String(input).endsWith("/search/count")) {
        return Response.json({ count: 999, state: "exact" });
      }
      const body = JSON.parse(String(init?.body)) as {
        cursor?: string;
        query: string;
      };
      let page = 0;
      if (body.cursor?.startsWith("older-")) {
        page = Number(body.cursor.slice(6)) + 1;
      }
      if (body.cursor?.startsWith("newer-")) {
        page = Number(body.cursor.slice(6)) - 1;
      }
      return searchResponse(
        page,
        body.query,
        body.cursor ? null : "count-token-1"
      );
    };
    await render();
    await act(() => {
      currentSearch().setQuery("needle");
    });
    await settle(() => currentSearch().results.length === 20);
    await settle(() => currentSearch().totalMatches === 999);
    for (let page = 1; page <= 8; page += 1) {
      // oxlint-disable-next-line no-await-in-loop -- page turns exercise the cursor from the previous committed page
      await render({ listPage: page });
      // oxlint-disable-next-line no-await-in-loop -- each page must settle before advancing the viewport
      await settle(() => currentSearch().results[0]?.id === `needle-${page}-0`);
      expect(currentSearch().resultMessages.length).toBeLessThanOrEqual(60);
      expect(currentSearch().totalMatches).toBe(999);
    }
    for (let page = 7; page >= 0; page -= 1) {
      // oxlint-disable-next-line no-await-in-loop -- reverse navigation traverses the nearest retained seam
      await render({ listPage: page });
      // oxlint-disable-next-line no-await-in-loop -- ensure the restored page is ready before the next turn
      await settle(() => currentSearch().results[0]?.id === `needle-${page}-0`);
      expect(currentSearch().resultMessages.length).toBeLessThanOrEqual(60);
    }
    expect(
      fetchCalls.some((call) => String(call.body.cursor).startsWith("newer-"))
    ).toBe(true);
    expect(currentSearch().totalMatches).toBe(999);
    expect(currentSearch().totalMatchesExact).toBe(true);
    expect(currentSearch().countState).toBe("exact");
    expect(
      fetchCalls.filter((call) => call.url.endsWith("/search/count"))
    ).toHaveLength(1);
  });

  test("superseding a search aborts the old request and ignores its delayed JSON", async () => {
    const delayed = Promise.withResolvers<unknown>();
    const oldResponse = new Response(null);
    Object.defineProperty(oldResponse, "json", {
      value: () => delayed.promise,
    });
    fetchHandler = (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      return body.query === "needle"
        ? oldResponse
        : searchResponse(0, body.query);
    };
    await render();
    await act(() => {
      currentSearch().setQuery("needle");
    });
    await settle(() => fetchCalls.length === 1);
    await act(() => {
      currentSearch().setQuery("other");
    });
    await settle(() => currentSearch().results[0]?.id === "other-0-0");
    expect(fetchCalls[0]?.signal?.aborted).toBe(true);
    await act(async () => {
      delayed.resolve(await searchResponse(0, "needle").json());
    });
    expect(currentSearch().results[0]?.id).toBe("other-0-0");
    await act(() => {
      root.unmount();
    });
    expect(fetchCalls.at(-1)?.signal?.aborted).toBe(true);
  });
});
