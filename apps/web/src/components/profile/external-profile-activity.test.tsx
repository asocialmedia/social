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
          items: [
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
    refetch: () => Promise.resolve(),
  }),
}));
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
