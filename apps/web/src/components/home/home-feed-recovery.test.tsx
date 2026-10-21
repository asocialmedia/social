import { afterAll, expect, mock, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

const retryExternal = mock(() => Promise.resolve());
const external = {
  data: {
    pages: [
      {
        items: [
          {
            author: { id: "did:plc:author" },
            id: "external-loaded",
            source: "bluesky",
            text: "Loaded post",
            upstreamCounts: { likes: 10 },
          },
        ],
      },
    ],
  },
  fetchNextPage: retryExternal,
  hasNextPage: true,
  isError: true,
  isFetching: false,
  isFetchingNextPage: false,
  isPending: false,
  newItems: [],
  probeNow: () => Promise.resolve(),
  refetch: mock(() => Promise.resolve()),
  showNewItems() {},
};
mock.module("@/components/protocols/use-bluesky-feed", () => ({
  useBlueskyFeed: () => external,
}));
mock.module("@/hooks/feed/use-network-settings", () => ({
  useNetworkSettings: () => ({
    ready: true,
    scope: "test",
    settings: { preferences: defaultNetworkPreferences() },
  }),
}));
mock.module("@/hooks/feed/use-discovery-locale", () => ({
  useDiscoveryLocale: () => ({ locale: "en", ready: true }),
}));
mock.module("@/hooks/feed/use-new-content-probe", () => ({
  useNewContentProbe: () => ({
    clearNewItems() {},
    newItems: [],
    probeNow: () => Promise.resolve(),
  }),
}));
mock.module("@/hooks/feed/use-seamless-feed-head", () => ({
  useSeamlessFeedHead() {},
}));
mock.module("./feed-view", () => ({
  FeedView: () => <div data-loaded>Loaded post</div>,
}));
mock.module("@/components/layouts/feed/infinite-scroll-container", () => ({
  default: ({
    children,
    onBottomReached,
  }: {
    children: ReactNode;
    onBottomReached: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onBottomReached()}>
        Reach end
      </button>
      {children}
    </div>
  ),
}));
const { default: HomeFeed } = await import("./home-feed");
const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
  window: dom,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
afterAll(async () => {
  await dom.happyDOM.close();
  for (const [key, value] of originals) {
    if (value) {
      Object.defineProperty(globalThis, key, value);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("a failed continuation keeps loaded posts, shows the shared illustrated error, and retries only on request", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    ["post-feed", "trending", "guest", "test", "en", "engaged-v1"],
    { pageParams: [null], pages: [{ nextCursor: null, posts: [] }] }
  );
  const host = dom.document.createElement("div");
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <HomeFeed variant="trending" />
        </QueryClientProvider>
      )
    );
    expect(host.querySelector("[data-loaded]")?.textContent).toBe(
      "Loaded post"
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "couldn’t load"
    );
    expect(host.querySelector("img")?.getAttribute("src")).toContain("error");
    const buttons = [...host.querySelectorAll("button")];
    const retry = buttons.find((button) => button.textContent === "Try again");
    expect(retry?.className).toContain("btn-3d");
    await act(() =>
      buttons.find((button) => button.textContent === "Reach end")?.click()
    );
    expect(retryExternal).not.toHaveBeenCalled();
    await act(() => retry?.click());
    expect(retryExternal).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => root.unmount());
    client.clear();
  }
});
