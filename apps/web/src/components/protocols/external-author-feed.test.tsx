import { expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: { id: "reader" } }),
}));
mock.module("@/hooks/feed/use-network-settings", () => ({
  useNetworkSettings: () => ({ ready: true, scope: "profile-test" }),
}));
mock.module("./bluesky-post-card", () => ({
  BlueskyPostCard: ({ post }: { post: { id: string } }) => (
    <article>{post.id}</article>
  ),
}));
const { ExternalAuthorFeed } = await import("./external-author-feed");

for (const tab of ["posts", "replies", "media"] as const) {
  test(`Bluesky profile ${tab} separates consecutive cards`, () => {
    const client = new QueryClient();
    client.setQueryData(
      ["bluesky-author-feed", "author", tab, "reader", "profile-test"],
      {
        pageParams: [null],
        pages: [{ cursor: null, items: [{ id: "first" }, { id: "second" }] }],
      }
    );
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ExternalAuthorFeed actor="author" tab={tab} />
      </QueryClientProvider>
    );
    expect(html).toMatch(
      /<article>first<\/article>.*data-orientation="horizontal".*<article>second<\/article>/
    );
    expect(html.match(/data-orientation="horizontal"/g)).toHaveLength(1);
    client.clear();
  });
}
