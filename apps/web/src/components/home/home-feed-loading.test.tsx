import { expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { externalPostView } from "@/lib/posts/presentation";

import HomeFeed from "./home-feed";

mock.module("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => null, replace: () => null }),
  useSearchParams: () => new URLSearchParams(),
}));

const source: ExternalPost = {
  author: {
    displayName: "Author",
    handle: "author.bsky.social",
    id: "did:plc:author",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/did:plc:author",
  },
  createdAt: "2026-10-16T10:00:00.000Z",
  id: "at://did:plc:author/app.bsky.feed.post/example",
  indexedAt: "2026-10-16T10:00:00.000Z",
  labels: [],
  languages: ["en"],
  media: [],
  revision: "revision",
  segments: [{ text: "Native content remains visible" }],
  source: "bluesky",
  text: "Native content remains visible",
  upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/did:plc:author/post/example",
};

test("a cold mixed feed keeps a full-height skeleton after an empty asocialmedia response", () => {
  const client = new QueryClient();
  client.setQueryData(["post-feed", "latest", "guest", "default:0", "en"], {
    pageParams: [null],
    pages: [{ nextCursor: null, posts: [] }],
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <HomeFeed variant="latest" />
    </QueryClientProvider>
  );
  expect(html).toContain('aria-label="Loading feed"');
  expect(html).toContain("min-h-dvh");
  expect(html).not.toContain("No Fleets yet.");
  client.clear();
});

test("a pending Bluesky source leaves loaded asocialmedia posts ahead of its placeholder", () => {
  const client = new QueryClient();
  const native = {
    ...externalPostView(source),
    external: undefined,
    id: "native-post",
  };
  client.setQueryData(["post-feed", "latest", "guest", "default:0", "en"], {
    pageParams: [null],
    pages: [{ nextCursor: null, posts: [native] }],
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <HomeFeed variant="latest" />
    </QueryClientProvider>
  );
  expect(html).toContain('aria-label="Loading Bluesky posts"');
  expect(html).toContain("Native content remains visible");
  expect(html.indexOf('aria-label="Loading Bluesky posts"')).toBeGreaterThan(
    html.indexOf('data-post-id="native-post"')
  );
  client.clear();
});
