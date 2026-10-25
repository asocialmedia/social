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
    isFetchingNextPage: false,
    isPending: false,
    loading: false,
    networkError: externalNetworkError,
    refetch: () => Promise.resolve(),
  }),
}));
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
