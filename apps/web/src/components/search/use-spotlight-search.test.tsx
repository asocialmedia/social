import { afterAll, expect, mock, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";

import type { SearchSource, SearchKind } from "./spotlight-search";
import { useSpotlightSearch } from "./use-spotlight-search";

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
  navigator: dom.navigator,
  window: dom,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
const { createRoot } = await import("react-dom/client");
afterAll(async () => {
  await dom.happyDOM.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

function Probe({
  query,
  source,
  kind = "all",
}: {
  query: string;
  source: SearchSource;
  kind?: SearchKind;
}) {
  const result = useSpotlightSearch(query, source, "viewer", true, kind);
  return (
    <div
      data-asm={Boolean(result.asm.data)}
      data-bluesky={Boolean(result.bluesky.data)}
    />
  );
}

const settle = () =>
  act(async () => {
    await delay(300);
  });

test("debounces typing, renders ASM independently, reuses cached sources, and cancels stale requests", async () => {
  const fetchBefore = globalThis.fetch;
  const calls: {
    url: string;
    signal: AbortSignal | null | undefined;
    resolve: (response: Response) => void;
  }[] = [];
  globalThis.fetch = mock((input, init) => {
    const deferred = Promise.withResolvers<Response>();
    calls.push({
      resolve: deferred.resolve,
      signal: init?.signal,
      url: String(input),
    });
    return deferred.promise;
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host);
  const render = (
    query: string,
    source: SearchSource = "all",
    kind: SearchKind = "all"
  ) =>
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe query={query} source={source} kind={kind} />
        </QueryClientProvider>
      );
    });
  try {
    await render("s");
    await settle();
    expect(calls).toHaveLength(0);
    await render("soft");
    await render("software");
    expect(calls).toHaveLength(0);
    await settle();
    expect(calls.map((call) => call.url)).toEqual([
      "/api/search/spotlight?q=software&kind=all",
      "/api/protocols/bluesky/search?q=software&kind=all",
    ]);
    await act(async () => {
      calls[0]?.resolve(
        Response.json({ communities: [], posts: [], users: [] })
      );
      await delay(10);
    });
    expect(host.firstElementChild?.dataset.asm).toBe("true");
    expect(host.firstElementChild?.dataset.bluesky).toBe("false");
    await render("software", "asm");
    expect(calls).toHaveLength(2);
    await render("astronomy", "asm");
    expect(calls[1]?.signal?.aborted).toBe(true);
    await settle();
    expect(calls).toHaveLength(3);
    expect(calls[2]?.url).toBe("/api/search/spotlight?q=astronomy&kind=all");
    await render("software", "asm");
    expect(calls[2]?.signal?.aborted).toBe(true);
    await settle();
    expect(calls).toHaveLength(3);
    expect(host.firstElementChild?.dataset.asm).toBe("true");
    await render("software", "all", "community");
    await settle();
    expect(calls).toHaveLength(4);
    expect(calls[3]?.url).toBe(
      "/api/search/spotlight?q=software&kind=community"
    );
    await render("software", "bluesky", "user");
    await settle();
    expect(calls).toHaveLength(5);
    expect(calls[4]?.url).toBe(
      "/api/protocols/bluesky/search?q=software&kind=user"
    );
  } finally {
    await act(() => root.unmount());
    client.clear();
    host.remove();
    globalThis.fetch = fetchBefore;
  }
});
