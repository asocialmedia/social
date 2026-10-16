import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import { externalPostView } from "./external-post-view";
import {
  mediaGridImageUrl,
  mediaImageUrl,
  mediaPosterUrl,
  mediaVideoUrl,
} from "./media-url";

const post: ExternalPost = {
  author: {
    displayName: "Alice",
    handle: "alice.bsky.social",
    id: "did:plc:alice",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/did:plc:alice",
  },
  createdAt: "2026-10-16T10:00:00.000Z",
  id: "at://did:plc:alice/app.bsky.feed.post/example",
  indexedAt: "2026-10-16T10:00:01.000Z",
  labels: [],
  languages: [],
  media: [],
  revision: "revision",
  segments: [{ text: "Hello" }],
  source: "bluesky",
  text: "Hello",
  upstreamCounts: { likes: 2, quotes: 0, replies: 1, reposts: 0 },
  url: "https://bsky.app/profile/did:plc:alice/post/example",
};

test("external cards retain source identity and local interaction counts without invented views", () => {
  const source = {
    ...post,
    asm: {
      amplifications: 3,
      amplified: true,
      bookmarked: true,
      comments: 4,
      responses: 5,
    },
  };
  const view = externalPostView(source);
  expect(view.external).toBe(source);
  expect(view.id).toBe(post.id);
  expect(view.user?.id).toBe(post.author.id);
  expect(view._count?.comments).toBe(4);
  expect(view._count?.responses).toBe(5);
  expect(view.viewCount).toBeUndefined();
});

test("the shared gallery receives original remote images and HLS videos with their posters", () => {
  const source = {
    ...post,
    media: [
      {
        alt: "Portrait",
        height: 960,
        type: "image" as const,
        url: "https://cdn.bsky.app/image@jpeg",
        width: 640,
      },
      {
        alt: "A clip",
        thumbnailUrl: "https://video.bsky.app/thumbnail.jpg",
        type: "video" as const,
        url: "https://video.bsky.app/stream/playlist.m3u8",
      },
    ],
  };
  const [image, video] = externalPostView(source).attachments ?? [];
  expect(image && mediaImageUrl("https://asm.example", image)).toBe(
    source.media[0]?.url
  );
  expect(image && mediaGridImageUrl("https://asm.example", image)).toBe(
    source.media[0]?.url
  );
  expect(
    video && mediaVideoUrl("https://asm.example", video.id, video.hasHls)
  ).toBe(source.media[1]?.url);
  expect(
    video && mediaPosterUrl("https://asm.example", video.id, video.thumbnailKey)
  ).toBe("https://video.bsky.app/thumbnail.jpg");
});
