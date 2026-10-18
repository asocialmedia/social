import { expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";

import GustVoteButton from "@/components/gusts/gust-vote-button";
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

for (const detail of [false, true]) {
  test(`Bluesky quotes use the shared connected parent row in ${detail ? "detail" : "feed"} view`, () => {
    const client = new QueryClient();
    const quote = {
      ...source,
      id: `${source.id}-quoted`,
      labels: [],
      media: [],
      segments: [{ text: "Original quoted post" }],
      text: "Original quoted post",
    };
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <PostCard
          detail={detail}
          post={externalPostView({ ...source, labels: [], media: [], quote })}
        />
      </QueryClientProvider>
    );
    const window = new Window();
    window.document.body.innerHTML = html;
    const row = window.document.querySelector("[data-response-source]");
    expect(row?.dataset.responseSource).toBe(quote.id);
    expect(row?.className).toBe("relative");
    expect(row?.querySelector("[aria-hidden=true].bg-border")).not.toBeNull();
    expect(
      row?.querySelector('a[href^="/network/bluesky?uri="]')
    ).not.toBeNull();
    expect(
      row?.querySelector('a[href^="/network/bluesky/profile?actor="]')
    ).not.toBeNull();
    expect(window.document.querySelectorAll("[data-post-id]")).toHaveLength(1);
    expect(html.indexOf("Original quoted post")).toBeLessThan(
      html.indexOf("Fixture text remains readable")
    );
    expect(row?.querySelector("button[aria-label=Amplify]")).toBeNull();
    client.clear();
    window.close();
  });
}

test("a quoted source keeps its sensitive-media concealment in the shared parent row", () => {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PostCard
        post={externalPostView({
          ...source,
          labels: [],
          media: [],
          quote: { ...source, id: `${source.id}-quoted` },
        })}
      />
    </QueryClientProvider>
  );
  const window = new Window();
  window.document.body.innerHTML = html;
  const image = window.document.querySelector(
    "[data-response-source] img[src*=fixture]"
  );
  expect(image?.className).toContain("blur-lg");
  expect(image?.getAttribute("src")).toBe(source.media[0]?.url);
  client.clear();
  window.close();
});

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

test("Bluesky cards display upstream likes independently of ASM amplification state", () => {
  const client = new QueryClient();
  const post = externalPostView({
    ...source,
    asm: {
      amplifications: 999,
      amplified: true,
      bookmarked: false,
      comments: 0,
    },
    labels: [],
    upstreamCounts: { ...source.upstreamCounts, likes: 347 },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PostCard post={post} />
    </QueryClientProvider>
  );
  expect(html).toContain('aria-label="Connect Bluesky to like"');
  expect(html).toContain(">347</span>");
  expect(html).not.toContain('title="Aura"');
  client.clear();
});

test("Bluesky Gusts use the same source likes while amplification remains a separate action", () => {
  const client = new QueryClient();
  const external = {
    ...source,
    asm: {
      amplifications: 999,
      amplified: true,
      bookmarked: false,
      comments: 0,
    },
    upstreamCounts: { ...source.upstreamCounts, likes: 347 },
  };
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <GustVoteButton
        authorName={source.author.displayName}
        direction="up"
        external={external}
        initialState={{ aura: 999, userVote: 1 }}
        postId={source.id}
      />
    </QueryClientProvider>
  );
  expect(html).toContain('aria-label="Connect Bluesky to like"');
  expect(html).toContain(">347</span>");
  expect(html).toContain('aria-label="Remove amplification"');
  expect(html).not.toContain('title="Aura"');
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
