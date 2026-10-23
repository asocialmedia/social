import { expect, mock, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";
import type { FeedSource } from "@asm/protocols/discovery";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let selectedSource: FeedSource = "all";
mock.module("@/store/feed-source-store", () => ({
  useFeedSourceStore: (select: (state: { source: FeedSource }) => FeedSource) =>
    select({ source: selectedSource }),
}));
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: { id: "viewer" } }),
}));
mock.module("@/hooks/feed/use-network-settings", () => ({
  useNetworkSettings: () => ({
    ready: true,
    scope: "test",
    settings: { preferences: defaultNetworkPreferences() },
  }),
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
mock.module("@/components/home/feed-view", () => ({
  FeedView: () => <div>Existing feed</div>,
}));
mock.module("@/components/layouts/feed/infinite-scroll-container", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
mock.module("@/components/feeds/new-content-pill", () => ({
  NewContentPill: ({ count }: { count: number }) => (
    <button type="button" aria-label={`Show ${count} new posts`}>
      New posts
    </button>
  ),
}));
mock.module("@/components/protocols/use-bluesky-feed", () => ({
  useBlueskyFeed: () => ({
    data: { pages: [{ items: [{ id: "remote-existing" }] }] },
    isError: false,
    isFetching: false,
    isPending: false,
    newItems: [
      { author: { handle: "author.test", id: "author" }, id: "remote-new" },
    ],
    probeNow: () => Promise.resolve(),
    showNewItems() {},
  }),
}));
const { default: FollowingFeed } = await import("./following");

test.each(["asm", "all", "bluesky"] as const)(
  "Following only offers retained Bluesky arrivals when that source is enabled (%s)",
  (source) => {
    selectedSource = source;
    const client = new QueryClient();
    client.setQueryData(["post-feed", "following", "viewer", "test"], {
      pageParams: [null],
      pages: [{ nextCursor: null, posts: [{ id: "existing-native" }] }],
    });
    try {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <FollowingFeed />
        </QueryClientProvider>
      );
      expect(html.includes('aria-label="Show 1 new posts"')).toBe(
        source !== "asm"
      );
    } finally {
      client.clear();
    }
  }
);
