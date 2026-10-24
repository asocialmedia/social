import { expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { externalPostView } from "@/lib/posts/presentation";
import type { PresentedPost } from "@/lib/posts/presentation";

mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: { id: "viewer" } }),
}));
mock.module("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    <span data-mock-image data-src={String(props.src ?? "")} />
  ),
}));

const sidebarModule = await import("./post-author-sidebar");
const PostAuthorSidebar = sidebarModule.default;

const mockAuthor = {
  avatarUrl: "https://cdn.bsky.app/avatar.jpg",
  description: "Astrophysics and space exploration",
  displayName: "Cosmic Explorer",
  handle: "cosmos.bsky.social",
  id: "did:plc:space123",
  upstreamCounts: {
    followers: 1200,
    following: 340,
    posts: 42,
  },
};

const mockExternalPost: ExternalPost = {
  author: mockAuthor,
  createdAt: "2026-10-17T12:00:00.000Z",
  id: "at://did:plc:space123/app.bsky.feed.post/111",
  indexedAt: "2026-10-17T12:00:00.000Z",
  labels: [],
  languages: ["en"],
  media: [
    {
      alt: "Nebula",
      thumbnailUrl: "https://cdn.bsky.app/thumb.jpg",
      type: "image",
      url: "https://cdn.bsky.app/image.jpg",
    },
  ],
  revision: "rev1",
  segments: [],
  source: "bluesky",
  text: "Viewing the Orion Nebula through James Webb",
  upstreamCounts: {
    likes: 85,
    quotes: 3,
    replies: 12,
    reposts: 20,
  },
  url: "https://bsky.app/profile/did:plc:space123/post/111",
};

const mockAuthorOtherPost: ExternalPost = {
  author: mockAuthor,
  createdAt: "2026-10-17T10:00:00.000Z",
  id: "at://did:plc:space123/app.bsky.feed.post/222",
  indexedAt: "2026-10-17T10:00:00.000Z",
  labels: [],
  languages: ["en"],
  media: [],
  revision: "rev2",
  segments: [],
  source: "bluesky",
  text: "Solar flare activity detected on sunspot 4021",
  upstreamCounts: {
    likes: 120,
    quotes: 1,
    replies: 18,
    reposts: 45,
  },
  url: "https://bsky.app/profile/did:plc:space123/post/222",
};

test("PostAuthorSidebar renders external author info and 'More from' section for Bluesky post", () => {
  const presentedPost: PresentedPost = externalPostView(mockExternalPost);
  const otherPresentedPost: PresentedPost =
    externalPostView(mockAuthorOtherPost);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  // Prepopulate the author posts infinite query cache to simulate loaded posts
  queryClient.setQueryData(
    ["post-author-posts", `bluesky:${mockAuthor.id}`, presentedPost.id],
    {
      pageParams: [null],
      pages: [
        {
          nextCursor: null,
          posts: [presentedPost, otherPresentedPost],
        },
      ],
    }
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <PostAuthorSidebar post={presentedPost} />
    </QueryClientProvider>
  );

  queryClient.clear();

  // Displays author identity and Bluesky handle
  expect(html).toContain("Cosmic Explorer");
  expect(html).toContain("@cosmos.bsky.social");
  expect(html).toContain("More from");

  // Excludes the currently viewed post (post/111) and lists the other post (post/222)
  expect(html).toContain("Solar flare activity detected on sunspot 4021");
  expect(html).toContain(
    "/network/bluesky?uri=at%3A%2F%2Fdid%3Aplc%3Aspace123%2Fapp.bsky.feed.post%2F222"
  );

  // Checks that likes and replies are formatted
  expect(html).toContain("120");
  expect(html).toContain('aria-label="Likes on Bluesky: 120"');
  expect(html).toContain("lucide-heart");
  expect(html).toContain("18");
});
