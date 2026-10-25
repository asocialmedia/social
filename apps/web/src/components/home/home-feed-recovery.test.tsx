import { afterAll, expect, mock, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { externalPostView } from "@/lib/posts/presentation";
import { useFeedSourceStore } from "@/store/feed-source-store";

let communityShouldFail = true;
const requestGlobal = mock(
  (): {
    nextCursor: string | null;
    posts: ReturnType<typeof externalPostView>[];
  } => ({ nextCursor: "next", posts: [] })
);
const requestCommunity = mock(() => {
  if (communityShouldFail) {
    throw new Error("Community temporarily unavailable");
  }
  return { nextCursor: null, posts: [] };
});
mock.module("@/lib/posts/read-feed-page", () => ({
  readFeedPage: async (
    read: (cursor: string | null) => Promise<Response>,
    cursor: string | null
  ) => {
    const response = await read(cursor);
    return response.json();
  },
}));
mock.module("@/lib/ky", () => ({
  default: {
    get: (url: string) => ({
      json: () => {
        if (url === "/api/posts/trending" || url === "/api/posts/latest") {
          return requestGlobal();
        }
        if (url === "/api/communities/example/posts") {
          return requestCommunity();
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    }),
  },
}));

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
  FeedView: ({ respectInterests }: { respectInterests: boolean }) => (
    <div data-loaded data-respect-interests={String(respectInterests)}>
      Loaded post
    </div>
  ),
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
    ["post-feed", "trending", "guest", "test", "en", "focused", "engaged-v1"],
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

test.each([
  { hasGlobalPosts: true, retryLabel: "Try again" },
  { hasGlobalPosts: false, retryLabel: "Try again" },
  { hasGlobalPosts: true, retryLabel: "Load more posts" },
  { hasGlobalPosts: false, retryLabel: "Load more posts" },
])(
  "community failure retries its own query through %s",
  async ({ hasGlobalPosts, retryLabel }) => {
    communityShouldFail = true;
    requestCommunity.mockClear();
    const externalRequests = retryExternal.mock.calls.length;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const nativePost = {
      ...externalPostView({
        author: {
          displayName: "Author",
          handle: "example.test",
          id: "author",
          source: "bluesky",
          upstreamCounts: {},
          url: "https://bsky.app/profile/example.test",
        },
        createdAt: "2026-10-21T00:00:00Z",
        id: "native-loaded",
        labels: [],
        languages: [],
        media: [],
        revision: "test",
        segments: [{ text: "Loaded post" }],
        source: "bluesky",
        text: "Loaded post",
        upstreamCounts: {},
        url: "https://bsky.app/profile/example.test/post/example",
      }),
      external: undefined,
    };
    requestGlobal.mockClear();
    requestGlobal.mockImplementation(() => ({
      nextCursor: null,
      posts: [nativePost],
    }));
    client.setQueryData(
      ["post-feed", "latest", "guest", "test", "en", "native"],
      {
        pageParams: [null],
        pages: [
          {
            nextCursor: "next-global",
            posts: hasGlobalPosts ? [nativePost] : [],
          },
        ],
      }
    );
    const host = dom.document.createElement("div");
    const root = createRoot(host);
    try {
      await act(() =>
        root.render(
          <QueryClientProvider client={client}>
            <HomeFeed communitySlug="example" variant="latest" />
          </QueryClientProvider>
        )
      );
      await act(async () => {
        await Bun.sleep(25);
      });
      expect(requestCommunity).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      if (hasGlobalPosts) {
        expect(host.querySelector("[data-loaded]")).not.toBeNull();
      }
      communityShouldFail = retryLabel === "Load more posts";
      await act(() =>
        [...host.querySelectorAll("button")]
          .find((button) => button.textContent === retryLabel)
          ?.click()
      );
      await act(async () => {
        await Bun.sleep(25);
      });
      expect(requestCommunity).toHaveBeenCalledTimes(2);
      expect(
        client.getQueryState(["community-feed", "example", "new"])?.status
      ).toBe(communityShouldFail ? "error" : "success");
      expect(retryExternal.mock.calls.length).toBe(externalRequests);
      if (retryLabel === "Load more posts") {
        expect(requestGlobal).toHaveBeenCalledTimes(1);
        expect(host.querySelector("[data-loaded]") !== null).toBe(true);
      } else {
        expect(host.querySelector('[role="alert"]') === null).toBe(true);
      }
    } finally {
      await act(() => root.unmount());
      client.clear();
      requestGlobal.mockImplementation(() => ({
        nextCursor: "next",
        posts: [],
      }));
    }
  }
);

test.each([true, false])(
  "sparse continuation remains automatic with loaded content and retryable without it (cached content: %s)",
  async (hasCachedContent) => {
    const previousData = external.data;
    if (!hasCachedContent) {
      external.data = { pages: [{ items: [] }] };
    }
    requestGlobal.mockClear();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      ["post-feed", "trending", "guest", "test", "en", "focused", "engaged-v1"],
      {
        pageParams: [null, "one", "two"],
        pages: ["one", "two", "three"].map((nextCursor) => ({
          nextCursor,
          posts: [],
        })),
      }
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
      await act(() =>
        [...host.querySelectorAll("button")]
          .find((button) => button.textContent === "Reach end")
          ?.click()
      );
      expect(requestGlobal).toHaveBeenCalledTimes(hasCachedContent ? 1 : 0);
      const more = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "Load more posts"
      );
      expect(more).toBeDefined();
      if (!hasCachedContent) {
        await act(() => more?.click());
      }
      await act(async () => {
        await Bun.sleep(25);
      });
      expect(requestGlobal).toHaveBeenCalledTimes(1);
    } finally {
      await act(() => root.unmount());
      client.clear();
      external.data = previousData;
    }
  }
);

test.each(["latest", "personalized"] as const)(
  "ASM-only %s does not hide native posts through discovery interests",
  async (variant) => {
    useFeedSourceStore.setState({ source: "asm" });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const native = {
      ...externalPostView({
        author: {
          displayName: "Author",
          handle: "author.test",
          id: "author",
          source: "bluesky",
          upstreamCounts: {},
          url: "https://bsky.app/profile/author.test",
        },
        createdAt: "2026-10-25T00:00:00Z",
        id: "native",
        labels: [],
        languages: [],
        media: [],
        revision: "1",
        segments: [],
        source: "bluesky",
        text: "Native post",
        upstreamCounts: {},
        url: "https://bsky.app/profile/author.test/post/example",
      }),
      external: undefined,
    };
    client.setQueryData(
      [
        "post-feed",
        variant === "latest" ? "latest" : "for-you",
        "guest",
        "test",
        "en",
        "native",
      ],
      { pageParams: [null], pages: [{ nextCursor: null, posts: [native] }] }
    );
    const host = dom.document.createElement("div");
    const root = createRoot(host);
    try {
      await act(() =>
        root.render(
          <QueryClientProvider client={client}>
            <HomeFeed variant={variant} />
          </QueryClientProvider>
        )
      );
      expect(
        host.querySelector("[data-loaded]")?.dataset.respectInterests
      ).toBe("false");
    } finally {
      await act(() => root.unmount());
      client.clear();
      useFeedSourceStore.setState({ source: "all" });
    }
  }
);
