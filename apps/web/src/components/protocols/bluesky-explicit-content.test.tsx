import { expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import PostCard from "@/components/home/feedview/post-card";
import { externalPostView } from "@/lib/posts/presentation";

mock.module("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const source: ExternalPost = {
  author: {
    displayName: "Fixture Author",
    handle: "fixture.bsky.social",
    id: "did:plc:fixture",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/did:plc:fixture",
  },
  createdAt: "2026-10-18T10:00:00.000Z",
  id: "at://did:plc:fixture/app.bsky.feed.post/example",
  indexedAt: "2026-10-18T10:00:01.000Z",
  labels: ["nudity"],
  languages: ["en"],
  media: [
    {
      alt: "Neutral test image",
      type: "image",
      url: "https://cdn.bsky.app/fixture.jpg",
    },
  ],
  revision: "revision",
  segments: [{ text: "Fixture text remains readable" }],
  source: "bluesky",
  text: "Fixture text remains readable",
  upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/did:plc:fixture/post/example",
};

test("the first HTML render gates a stale cached Bluesky image before hydration", () => {
  const client = new QueryClient();
  const post = { ...externalPostView(source), explicitContent: false };
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PostCard post={post} />
    </QueryClientProvider>
  );
  expect(html).toContain("This post has explicit media.");
  expect(html).toContain("Continue");
  expect(html).toContain("blur-xl");
  expect(html).toContain('inert=""');
  expect(html).toContain("Fixture text remains readable");
  client.clear();
});

test("embed-only warnings use the same initial explicit gate", () => {
  const client = new QueryClient();
  const post = externalPostView({
    ...source,
    externalLink: {
      description: "Fixture description",
      thumbnailUrl: "https://cdn.bsky.app/fixture.jpg",
      title: "Fixture link",
      url: "https://example.com/fixture",
    },
    labels: ["graphic-media"],
    media: [],
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PostCard post={post} />
    </QueryClientProvider>
  );
  expect(html).toContain("This post has explicit media.");
  expect(html).toContain("blur-xl");
  expect(html).toContain("Fixture link");
  client.clear();
});

test("declared AI labels use ASM's existing media pill without becoming an explicit-media warning", () => {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PostCard
        post={externalPostView({ ...source, labels: ["ai-generated"] })}
      />
    </QueryClientProvider>
  );
  expect(html).toContain("AI Generated");
  expect(html).toContain('aria-label="AI-generated content (Bluesky label)"');
  expect(html).not.toContain("This post has explicit media.");
  client.clear();
});

test("an AI topic tag alone does not show an AI Generated pill", () => {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PostCard
        post={externalPostView({
          ...source,
          labels: [],
          tags: ["ai-generated"],
        })}
      />
    </QueryClientProvider>
  );
  expect(html).not.toContain("AI Generated");
  client.clear();
});
