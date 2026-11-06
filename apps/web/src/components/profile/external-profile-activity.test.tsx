import { expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: { id: "reader" } }),
}));
mock.module("@/components/protocols/bluesky-post-card", () => ({
  BlueskyPostCard: ({ post }: { post: { id: string } }) => (
    <article data-source="bluesky">{post.id}</article>
  ),
}));
mock.module("./use-external-profile-activity", () => ({
  useExternalProfileActivity: (_userId: string, kind: string) => ({
    data: {
      pages: [
        {
          items: externalEmpty
            ? []
            : [
                {
                  createdAt: "2026-10-25T00:00:00Z",
                  id: "external",
                  post: { id: "external-post" },
                  uri: "at://did:plc:author/app.bsky.feed.post/example",
                  ...(kind === "eddies"
                    ? {
                        comment: {
                          content: "My Bluesky eddie",
                          id: "comment",
                          user: { displayName: "Author", username: "author" },
                        },
                      }
                    : {}),
                },
              ],
        },
      ],
    },
    fetchNextPage: () => Promise.resolve(),
    hasNextPage: false,
    isError: false,
    isFetching: false,
    isFetchingNextPage: externalFetchingNextPage,
    isPending: false,
    loading: externalLoading,
    networkError: externalNetworkError,
    refetch: () => Promise.resolve(),
  }),
}));
let nativeRetry: (() => void) | undefined;
const nativeRequests: { path: string; cursor?: string }[] = [];
mock.module("@/components/feeds/feed-error-state", () => ({
  FeedErrorState: ({
    message,
    onRetry,
  }: {
    message: string;
    onRetry: () => void;
  }) => {
    nativeRetry = onRetry;
    return (
      <div>
        {message}
        <button type="button">Try again</button>
      </div>
    );
  },
}));
mock.module("@/lib/ky", () => ({
  default: {
    get: (path: string, options?: { searchParams?: { cursor?: string } }) => {
      nativeRequests.push({ cursor: options?.searchParams?.cursor, path });
      return {
        json: () =>
          Promise.resolve({ nextCursor: null, posts: [], replies: [] }),
      };
    },
  },
}));
let externalLoading = false;
let externalFetchingNextPage = false;
let externalEmpty = false;
let externalNetworkError = false;
const { default: UserAmplifiedFeed } = await import("./user-amplified-feed");
const { default: UserRepliesFeed } = await import("./user-replies-feed");

test("an otherwise empty Amplified tab renders a Bluesky Fleet or Gust", () => {
  const client = new QueryClient();
  client.setQueryData(["post-feed", "user-amplified", "profile"], {
    pageParams: [null],
    pages: [{ nextCursor: null, posts: [] }],
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <UserAmplifiedFeed userId="profile" />
    </QueryClientProvider>
  );
  expect(html).toContain('data-source="bluesky"');
  expect(html).not.toContain("No amplified posts yet");
  client.clear();
});

test("an otherwise empty Eddies tab renders its local comment and Bluesky parent", () => {
  const client = new QueryClient();
  client.setQueryData(["post-feed", "user-replies", "profile"], {
    pageParams: [null],
    pages: [{ nextCursor: null, replies: [] }],
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <UserRepliesFeed userId="profile" />
    </QueryClientProvider>
  );
  expect(html).toContain("My Bluesky eddie");
  expect(html).toContain('data-source="bluesky"');
  expect(html).not.toContain("No replies yet");
  client.clear();
});

for (const kind of ["amplified", "replies"] as const) {
  // oxlint-disable-next-line no-loop-func -- test callbacks execute serially and reset their shared source fixture.
  test(`an empty filtered native ${kind} page retains its continuation`, () => {
    externalEmpty = true;
    const client = new QueryClient();
    client.setQueryData(["post-feed", `user-${kind}`, "profile"], {
      pageParams: [null],
      pages: [
        {
          nextCursor: "older-page",
          nextCursorAt: "2026-10-01T00:00:00Z",
          posts: [],
          replies: [],
        },
      ],
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        {kind === "amplified" ? (
          <UserAmplifiedFeed userId="profile" />
        ) : (
          <UserRepliesFeed userId="profile" />
        )}
      </QueryClientProvider>
    );
    expect(html).toContain("data-feed-sentinel");
    expect(html).not.toContain("No amplified posts yet");
    expect(html).not.toContain("No replies yet");
    client.clear();
    externalEmpty = false;
  });
}

for (const kind of ["amplified", "replies"] as const) {
  test(`native ${kind} errors remain retryable beside external activity`, () => {
    const client = new QueryClient();
    const queryKey = ["post-feed", `user-${kind}`, "profile"];
    client.setQueryData(queryKey, {
      pageParams: [null],
      pages: [{ nextCursor: null, posts: [], replies: [] }],
    });
    client
      .getQueryCache()
      .find({ queryKey })
      ?.setState({ error: new Error("native unavailable"), status: "error" });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        {kind === "amplified" ? (
          <UserAmplifiedFeed userId="profile" />
        ) : (
          <UserRepliesFeed userId="profile" />
        )}
      </QueryClientProvider>
    );
    expect(html).toContain('data-source="bluesky"');
    expect(html).toContain("Couldn’t load more");
    expect(html).toContain("Try again");
    expect(html).not.toContain("You've seen every");
    client.clear();
  });

  // oxlint-disable-next-line no-loop-func -- serial tests reset the shared external source fixture.
  test(`failed settings cannot declare an empty ${kind} profile caught up`, () => {
    externalNetworkError = true;
    externalEmpty = true;
    const client = new QueryClient();
    client.setQueryData(["post-feed", `user-${kind}`, "profile"], {
      pageParams: [null],
      pages: [{ nextCursor: null, posts: [], replies: [] }],
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        {kind === "amplified" ? (
          <UserAmplifiedFeed userId="profile" />
        ) : (
          <UserRepliesFeed userId="profile" />
        )}
      </QueryClientProvider>
    );
    expect(html).toContain("Couldn’t load your content settings");
    expect(html).not.toContain("No amplified posts yet");
    expect(html).not.toContain("No replies yet");
    expect(html).not.toContain("You've seen every");
    externalNetworkError = false;
    externalEmpty = false;
    client.clear();
  });
}

for (const kind of ["amplified", "replies"] as const) {
  for (const scenario of [
    "refresh-ended",
    "refresh-with-cursor",
    "continuation",
  ] as const) {
    // oxlint-disable-next-line no-loop-func -- each test resets the captured retry and request log before synchronous rendering.
    test(`${kind} retries the failed ${scenario} request`, async () => {
      nativeRequests.length = 0;
      nativeRetry = undefined;
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const queryKey = ["post-feed", `user-${kind}`, "profile"];
      client.setQueryData(queryKey, {
        pageParams: [null],
        pages: [
          {
            nextCursor: scenario === "refresh-ended" ? null : "older-page",
            nextCursorAt: "2026-01-01T00:00:00Z",
            posts: [],
            replies: [],
          },
        ],
      });
      const query = client.getQueryCache().find({ queryKey });
      query?.setState({
        error: new Error("failed request"),
        fetchMeta:
          scenario === "continuation"
            ? { fetchMore: { direction: "forward" } }
            : null,
        status: "error",
      });
      renderToStaticMarkup(
        <QueryClientProvider client={client}>
          {kind === "amplified" ? (
            <UserAmplifiedFeed userId="profile" />
          ) : (
            <UserRepliesFeed userId="profile" />
          )}
        </QueryClientProvider>
      );
      expect(nativeRetry).toBeDefined();
      nativeRetry?.();
      await query?.promise;
      expect(nativeRequests).toEqual([
        {
          cursor: scenario === "continuation" ? "older-page" : undefined,
          path: `/api/users/profile/${kind}`,
        },
      ]);
      client.clear();
    });
  }
}

test("Amplified uses post skeletons while the external first page is loading", () => {
  const client = new QueryClient();
  externalLoading = true;
  externalEmpty = true;
  client.setQueryData(["post-feed", "user-amplified", "profile"], {
    pageParams: [null],
    pages: [{ nextCursor: null, posts: [] }],
  });
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <UserAmplifiedFeed userId="profile" />
      </QueryClientProvider>
    );
    expect(html).toContain('aria-label="Loading feed"');
    expect(html).toContain("data-post-skeleton");
    expect(html).not.toContain("lucide-loader");
    expect(html).not.toContain("No amplified posts yet");
  } finally {
    externalLoading = false;
    externalEmpty = false;
    client.clear();
  }
});

test("Amplified appends post skeletons while loading another external page", () => {
  const client = new QueryClient();
  externalFetchingNextPage = true;
  client.setQueryData(["post-feed", "user-amplified", "profile"], {
    pageParams: [null],
    pages: [{ nextCursor: null, posts: [] }],
  });
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <UserAmplifiedFeed userId="profile" />
      </QueryClientProvider>
    );
    expect(html).toContain('data-source="bluesky"');
    expect(html).toContain('aria-label="Loading more amplified posts"');
    expect(html.match(/data-post-skeleton=/g)).toHaveLength(2);
    expect(html).not.toContain("lucide-loader");
  } finally {
    externalFetchingNextPage = false;
    client.clear();
  }
});

test("Amplified uses post skeletons while fetching another native page", () => {
  const client = new QueryClient();
  const queryKey = ["post-feed", "user-amplified", "profile"];
  client.setQueryData(queryKey, {
    pageParams: [null],
    pages: [
      { nextCursor: "older", nextCursorAt: "2026-01-01T00:00:00Z", posts: [] },
    ],
  });
  client
    .getQueryCache()
    .find({ queryKey })
    ?.setState({
      fetchMeta: { fetchMore: { direction: "forward" } },
      fetchStatus: "fetching",
    });
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <UserAmplifiedFeed userId="profile" />
      </QueryClientProvider>
    );
    expect(html).toContain('aria-label="Loading more amplified posts"');
    expect(html.match(/data-post-skeleton=/g)).toHaveLength(2);
    expect(html).not.toContain("lucide-loader");
  } finally {
    client.clear();
  }
});
