import { expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { externalPostView } from "@/lib/posts/presentation";
import type { PresentedPost } from "@/lib/posts/presentation";

let viewer: { id: string } | null = { id: "viewer" };
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: viewer }),
}));
mock.module("@/components/layouts/user/follow-button", () => ({
  default: () => <button type="button">Follow</button>,
}));
mock.module("@/components/protocols/external-follow-button", () => ({
  ExternalFollowButton: () => <button type="button">Follow on Bluesky</button>,
}));
mock.module("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    <span data-mock-image data-src={String(props.src ?? "")} />
  ),
}));

const sidebarModule = await import("./post-author-sidebar");
const PostAuthorSidebar = sidebarModule.default;
const { PostAuthorFollow } = await import("../actions/post-author-follow");

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
    ["post-author-posts", `bluesky:${mockAuthor.id}`, "viewer"],
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

test("guest post details link to the author profile and omit Follow controls", () => {
  const queryClient = new QueryClient();
  const external = externalPostView(mockExternalPost);
  const native = { ...external, external: undefined };
  const previousViewer = viewer;
  viewer = null;
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <PostAuthorSidebar post={native} />
        <PostAuthorFollow post={native} />
        <PostAuthorFollow post={external} />
        <PostAuthorFollow menu post={native} showForGuest={false} />
        <PostAuthorFollow menu post={external} showForGuest={false} />
      </QueryClientProvider>
    );
    expect(html).toContain("View profile");
    expect(html).not.toContain(">Follow<");
    expect(html).not.toContain(">Follow on Bluesky<");
  } finally {
    viewer = previousViewer;
    queryClient.clear();
  }
});

test("signed-in post readers and guest feed menus can still follow another author", () => {
  const queryClient = new QueryClient();
  const external = externalPostView(mockExternalPost);
  const native = { ...external, external: undefined };
  const previousViewer = viewer;
  try {
    viewer = { id: "viewer" };
    queryClient.setQueryData(["bluesky-connection", "viewer"], { did: null });
    const detail = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <PostAuthorSidebar post={native} />
        <PostAuthorFollow post={native} />
        <PostAuthorFollow post={external} />
      </QueryClientProvider>
    );
    expect(detail.match(/>Follow</g)).toHaveLength(2);
    expect(detail).toContain(">Follow on Bluesky<");

    viewer = null;
    const menu = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <PostAuthorFollow menu post={native} showForGuest />
        <PostAuthorFollow menu post={external} showForGuest />
      </QueryClientProvider>
    );
    expect(menu).toContain(">Follow<");
    expect(menu).toContain(">Follow on Bluesky<");
  } finally {
    viewer = previousViewer;
    queryClient.clear();
  }
});
