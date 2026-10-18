import { expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: { id: "like-viewer" } }),
}));
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));
mock.module("@/components/recommendations/recommendation-tracker", () => ({
  trackNetworkAction: () => {},
}));
mock.module("@/lib/gooey-toast", () => ({
  useToast: () => ({ toast: () => {} }),
}));

const { ExternalLikeButton } = await import("./external-like-button");

const post: ExternalPost = {
  author: {
    displayName: "Author",
    handle: "author.test",
    id: "did:plc:author",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/author.test",
  },
  createdAt: "2026-10-18T00:00:00Z",
  id: "at://did:plc:author/app.bsky.feed.post/example",
  labels: [],
  languages: [],
  media: [],
  revision: "revision",
  segments: [{ text: "A post" }],
  source: "bluesky",
  text: "A post",
  upstreamCounts: { likes: 12 },
  url: "https://bsky.app/profile/author.test/post/example",
};

function renderLike(connected: boolean) {
  const client = new QueryClient();
  const did = connected ? "did:plc:viewer" : null;
  client.setQueryData(["bluesky-connection", "like-viewer"], {
    canLike: connected,
    canReply: connected,
    connected,
    did,
  });
  if (connected) {
    client.setQueryData(["bluesky-like", "like-viewer", did, post.id], {
      liked: true,
      likes: 13,
    });
  }
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ExternalLikeButton post={post} />
      </QueryClientProvider>
    );
  } finally {
    client.clear();
  }
}

test("an unlinked heart renders outside a tooltip provider without crashing a post or Gust", () => {
  const html = renderLike(false);
  expect(html).toContain('aria-label="Connect Bluesky to like"');
  expect(html).toContain("opacity-50");
  expect(html).toContain(">12</span>");
  expect(html).not.toContain("disabled=");
});

test("a connected heart renders the account's saved like state and upstream count", () => {
  const html = renderLike(true);
  expect(html).toContain('aria-label="Unlike on Bluesky"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("fill-current");
  expect(html).toContain(">13</span>");
});
