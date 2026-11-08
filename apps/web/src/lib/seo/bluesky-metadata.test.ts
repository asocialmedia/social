import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import {
  blueskyPostJsonLd,
  blueskyPostMetadata,
  blueskyPostPath,
} from "./bluesky-metadata";

export const post: ExternalPost = {
  author: {
    displayName: "Example author",
    handle: "example.bsky.social",
    id: "did:plc:example",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/did:plc:example",
  },
  createdAt: "2026-11-07T10:00:00.000Z",
  id: "at://did:plc:example/app.bsky.feed.post/123",
  indexedAt: "2026-11-07T10:00:00.000Z",
  labels: [],
  languages: ["en"],
  media: [],
  revision: "cid",
  segments: [{ text: "A public post worth reading." }],
  source: "bluesky",
  text: "A public post worth reading.",
  upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/did:plc:example/post/123",
};

test("Bluesky metadata has one stable canonical independent of viewer/media query state", () => {
  const metadata = blueskyPostMetadata(post);
  expect(metadata.robots).toEqual({ follow: true, index: true });
  const canonical = `${"https://asocialmedia.cc"}${blueskyPostPath(post.id)}`;
  expect(new URL(canonical).searchParams.get("uri")).toBe(post.id);
  expect(metadata.alternates?.canonical).toBe(canonical);
  expect(metadata.openGraph).toMatchObject({
    description: post.text,
    type: "article",
    url: canonical,
  });
  expect(blueskyPostJsonLd(post)).toMatchObject({
    author: { url: post.author.url },
    isBasedOn: post.url,
    text: post.text,
    url: canonical,
  });
});

test("video social previews use image posters rather than video bytes", () => {
  expect(
    blueskyPostMetadata({
      ...post,
      media: [
        {
          alt: "A clip",
          thumbnailUrl: "https://video.test/poster.jpg",
          type: "video",
          url: "https://video.test/clip.m3u8",
        },
      ],
    }).openGraph
  ).toMatchObject({ images: [{ url: "https://video.test/poster.jpg" }] });
});
