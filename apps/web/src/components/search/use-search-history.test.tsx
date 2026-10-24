import { afterAll, expect, mock, test } from "bun:test";

import type { SearchHistoryItem } from "@asm/db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";

let viewer: string | null = "alice";
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: viewer ? { id: viewer } : null }),
}));
const { useSearchHistory } = await import("./use-search-history");
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
function Probe() {
  const { history } = useSearchHistory(false);
  return (
    <span>
      {history
        .map((entry) => (entry.type === "query" ? entry.query : ""))
        .join(",")}
    </span>
  );
}

test("cached account history stays isolated when switching accounts or signing out", async () => {
  const client = new QueryClient();
  const alice: SearchHistoryItem[] = [
    { query: "alice-private-query", type: "query" },
  ];
  const bob: SearchHistoryItem[] = [
    { query: "bob-private-query", type: "query" },
  ];
  client.setQueryData(["search-history", "alice"], alice);
  client.setQueryData(["search-history", "bob"], bob);
  client.setQueryData(["search-history", "guest"], alice);
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host);
  const render = () =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    );
  try {
    await render();
    expect(host.textContent).toBe("alice-private-query");
    viewer = "bob";
    await render();
    expect(host.textContent).toBe("bob-private-query");
    viewer = null;
    await render();
    expect(host.textContent).toBe("");
  } finally {
    await act(() => root.unmount());
    client.clear();
    host.remove();
  }
});
