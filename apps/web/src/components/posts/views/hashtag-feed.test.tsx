import { expect, mock, test } from "bun:test";

import type { FeedSource } from "@asm/protocols/discovery";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: null }),
}));
let settingsError: Error | null = null;
let settingsReady = true;
const retrySettings = mock(() => Promise.resolve());
let renderedRetry: (() => void) | undefined;
mock.module("@/hooks/feed/use-network-settings", () => ({
  useNetworkSettings: () => ({
    error: settingsError,
    isFetching: false,
    ready: settingsReady,
    refetch: retrySettings,
    scope: "test-scope",
  }),
}));
let source: FeedSource = "all";
mock.module("@/store/feed-source-store", () => ({
  useExternalExclusions: () => new Set<string>(),
  useFeedSourceStore: (select: (state: { source: FeedSource }) => FeedSource) =>
    select({ source }),
}));
mock.module("@/components/home/feed-view", () => ({
  FeedView: ({
    posts,
    externalPosts,
    sourcesPending,
  }: {
    sourcesPending: boolean;
    posts: { content: string }[];
    externalPosts: { text: string }[];
  }) => (
    <div data-sources-pending={sourcesPending}>
      {posts.map((post) => (
        <p key={post.content}>{post.content}</p>
      ))}
      {externalPosts.map((post) => (
        <p key={post.text}>{post.text}</p>
      ))}
    </div>
  ),
}));
mock.module("@/components/layouts/feed/infinite-scroll-container", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
mock.module("@/components/feeds/feed-error-state", () => ({
  FeedErrorState: ({
    message,
    compact,
    onRetry,
  }: {
    message: string;
    compact: boolean;
    onRetry: () => void;
  }) => {
    renderedRetry = onRetry;
    return (
      <p role="alert" data-compact={compact}>
        {message}
      </p>
    );
  },
}));
const { default: HashtagFeed } = await import("./hashtag-feed");

const nativeKey = ["post-feed", "hashtag", "onepiece", "guest", "test-scope"];
const remoteKey = ["bluesky-hashtag", "onepiece", "guest", "test-scope"];
const native = {
  nextCursor: null,
  posts: [{ content: "ASM #onepiece", id: "native" }],
};
const remote = {
  cursor: null,
  items: [
    {
      author: { id: "did:plc:test" },
      id: "at://did:plc:test/app.bsky.feed.post/post",
      text: "Bluesky #onepiece",
    },
  ],
};
function render(client: QueryClient) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <HashtagFeed tag="onepiece" />
    </QueryClientProvider>
  );
}

test("hashtag feeds include both source lists in the existing shared feed", () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retryOnMount: false } },
  });
  client.setQueryData(nativeKey, { pageParams: [null], pages: [native] });
  client.setQueryData(remoteKey, { pageParams: [null], pages: [remote] });
  const html = render(client);
  expect(html).toContain("ASM #onepiece");
  expect(html).toContain("Bluesky #onepiece");
  expect(html).not.toContain("<details");
  client.clear();
});

test("a failed remote source leaves native hashtag results visible", () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retryOnMount: false } },
  });
  client.setQueryData(nativeKey, { pageParams: [null], pages: [native] });
  client
    .getQueryCache()
    .build(client, { queryKey: remoteKey })
    .setState({
      error: new Error("Source unavailable"),
      fetchStatus: "idle",
      status: "error",
    });
  const html = render(client);
  expect(html).toContain("ASM #onepiece");
  expect(html).toContain("Some posts couldn&#x27;t load");
  expect(html).toContain('data-compact="true"');
  client.clear();
});

test.each(["asm", "bluesky"] as const)(
  "hashtag source menu filters cached results to %s",
  (selected) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retryOnMount: false } },
    });
    client.setQueryData(nativeKey, { pageParams: [null], pages: [native] });
    client.setQueryData(remoteKey, { pageParams: [null], pages: [remote] });
    source = selected;
    try {
      const html = render(client);
      expect(html.includes("ASM #onepiece")).toBe(selected === "asm");
      expect(html.includes("Bluesky #onepiece")).toBe(selected === "bluesky");
    } finally {
      source = "all";
      client.clear();
    }
  }
);

test("an unselected unavailable source does not block an empty hashtag feed", () => {
  const client = new QueryClient();
  client.setQueryData(nativeKey, {
    pageParams: [null],
    pages: [{ nextCursor: null, posts: [] }],
  });
  source = "asm";
  try {
    expect(render(client)).toContain("No posts found for #onepiece");
  } finally {
    source = "all";
    client.clear();
  }
});

test("settings failures expose recovery instead of an endless skeleton", () => {
  const client = new QueryClient();
  settingsReady = false;
  settingsError = new Error("Settings unavailable");
  retrySettings.mockClear();
  try {
    expect(render(client)).toContain(
      "Couldn&#x27;t load your Network settings"
    );
    renderedRetry?.();
    expect(retrySettings).toHaveBeenCalledTimes(1);
  } finally {
    settingsReady = true;
    settingsError = null;
    renderedRetry = undefined;
    client.clear();
  }
});

test("mixed hashtag feeds keep initial ordering pending until both sources resolve", () => {
  const client = new QueryClient();
  client.setQueryData(nativeKey, { pageParams: [null], pages: [native] });
  expect(render(client)).toContain('data-sources-pending="true"');
  client.setQueryData(remoteKey, { pageParams: [null], pages: [remote] });
  expect(render(client)).toContain('data-sources-pending="false"');
  client.clear();
});
