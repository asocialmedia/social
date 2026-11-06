import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { PostInlineContent } from "@/components/posts/content/post-inline-content";
import type { LinkEmbed } from "@/lib/link-embeds/shared";

import PostLinkEmbeds from "./link-embeds";
import { usePostLinkPreviews } from "./use-post-link-previews";

const url = "https://ko-fi.com/s/8b62fc25c7";
const post: ExternalPost = {
  author: {
    displayName: "Artist",
    handle: "artist.bsky.social",
    id: "did:plc:artist",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/artist.bsky.social",
  },
  createdAt: "2026-10-25T00:00:00Z",
  id: "post",
  indexedAt: "2026-10-25T00:00:00Z",
  labels: [],
  languages: [],
  media: [],
  revision: "cid",
  segments: [{ href: url, text: "My shop" }],
  source: "bluesky",
  text: "My shop",
  upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/artist.bsky.social/post/example",
};
const EMPTY_EMBEDS: LinkEmbed[] = [];
function Probe({ stored = EMPTY_EMBEDS }: { stored?: LinkEmbed[] }) {
  const { embeds, ref } = usePostLinkPreviews(stored, post);
  return (
    <div ref={ref}>
      <PostInlineContent
        content={post.text}
        embeds={embeds}
        sourceSegments={post.segments}
      />
      <PostLinkEmbeds embeds={embeds} />
    </div>
  );
}

test("a cached unavailable Ko-fi preview still has a clickable card and useful pill", () => {
  const client = new QueryClient();
  client.setQueryData(["link-preview", url], null);
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
    expect(
      html.match(/href="https:\/\/ko-fi.com\/s\/8b62fc25c7"/g)
    ).toHaveLength(2);
    expect(html).toContain("My shop");
    expect(html).toContain("embed-panel-3d");
  } finally {
    client.clear();
  }
});

test("resolved metadata upgrades the card and pill together from the shared cache", () => {
  const client = new QueryClient();
  client.setQueryData(["link-preview", url], {
    title: "Handmade fox pin",
    type: "link",
    url,
  });
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
    expect(html.match(/Handmade fox pin/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain(">My shop<");
  } finally {
    client.clear();
  }
});

test("metadata already supplied by Bluesky renders without creating a scrape query", () => {
  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <Probe
          stored={[{ title: "Bluesky supplied title", type: "link", url }]}
        />
      </QueryClientProvider>
    );
    expect(html).toContain("Bluesky supplied title");
    expect(client.getQueryState(["link-preview", url])?.fetchStatus).not.toBe(
      "fetching"
    );
  } finally {
    client.clear();
  }
});
