import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import { parseStoredEmbeds } from "@/lib/link-embeds/shared";

import {
  getMediaImageSrcSet,
  getMediaImageUrl,
  getMediaProxyUrl,
  getMediaVideoUrl,
} from "../utils/image-url";
import { cachedPostPreview } from "./cached-post-preview";
import { normalizePostData } from "./post-normalize";
import { externalPostView } from "./presentation";

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

test("declared AI metadata and source topics reach web media without inventing provenance or native tag relations", () => {
  const view = externalPostView({
    ...post,
    media: [
      {
        alt: "A generated galaxy",
        type: "image",
        url: "https://cdn.bsky.app/image.jpg",
      },
    ],
    selfLabels: ["ai-generated"],
    tags: ["Astronomy"],
  });
  expect(view.attachments?.[0]?.aiGenerated).toBe(true);
  expect(view.attachments?.[0]).toHaveProperty(
    "aiGeneratedSource",
    "bluesky-label"
  );
  expect(view.semanticTags).toEqual(["astronomy"]);
  expect(view.tags).toEqual([]);
  expect(view.embedding).toEqual([]);
});

test("external detail skeletons reuse the exact source media from paginated caches", () => {
  const source = {
    ...post,
    media: [
      {
        alt: "Portrait clip",
        height: 1920,
        type: "video" as const,
        url: "https://video.bsky.app/playlist.m3u8",
        width: 1080,
      },
    ],
  };
  const cache = { pages: [{ items: [source] }] };
  const preview = cachedPostPreview(cache, source.id);
  expect(preview?.attachments).toEqual([
    {
      altText: "Portrait clip",
      hasHls: true,
      height: 1920,
      id: source.media[0]?.url,
      thumbnailKey: null,
      type: "VIDEO",
      width: 1080,
    },
  ]);
  expect(cachedPostPreview(cache, source.id)).toBe(preview);
});

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
  expect(view._count?.comments).toBe(5);
  expect(view._count?.responses).toBe(5);
  expect(view.external?.upstreamCounts).not.toHaveProperty("views");
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
  expect(image && getMediaImageUrl(image, "lg-webp.webp")).toBe(
    source.media[0]?.url
  );
  expect(image && getMediaImageSrcSet(image)).toBeUndefined();
  expect(video && getMediaVideoUrl(video.id)).toBe(source.media[1]?.url);
  expect(video && getMediaProxyUrl(video)).toBe(
    "https://video.bsky.app/thumbnail.jpg"
  );
});

test("external link metadata uses native embeds including YouTube facades and sanitized URLs", () => {
  const source = {
    ...post,
    externalLink: {
      description: "Video description",
      title: "Video title",
      url: "https://youtu.be/dQw4w9WgXcQ?utm_source=bluesky",
    },
  };
  const [embed] = parseStoredEmbeds(externalPostView(source).embeds);
  expect(embed?.type).toBe("youtube");
  expect(embed?.videoId).toBe("dQw4w9WgXcQ");
  expect(embed?.siteName).toBe("youtu.be");
  expect(embed?.url).toBe("https://youtu.be/dQw4w9WgXcQ");
});

test.each(["porn", "sexual", "graphic-media", "nudity"])(
  "Bluesky %s labels set the existing explicit flag without marking the post moderated",
  (label) => {
    const view = externalPostView({ ...post, labels: [label] });
    expect(view.explicitContent).toBe(true);
    expect(view.moderated).toBe(false);
    expect(view.content).toBe(post.text);
  }
);

test("account and quoted-media warnings propagate to the outer post before previews render", () => {
  expect(
    externalPostView({
      ...post,
      author: { ...post.author, labels: ["sexual"] },
    }).explicitContent
  ).toBe(true);
  const quote = { ...post, id: `${post.id}-quote`, labels: ["graphic-media"] };
  const outer = externalPostView({ ...post, quote });
  expect(outer.explicitContent).toBe(true);
  expect(
    outer.external?.quote &&
      externalPostView(outer.external.quote).explicitContent
  ).toBe(true);
});

test("cached bookmarks and media previews repair old false flags synchronously", () => {
  const stale = {
    ...externalPostView({ ...post, labels: ["nudity"] }),
    explicitContent: false,
  };
  expect(normalizePostData(stale).explicitContent).toBe(true);
  expect(
    cachedPostPreview({ pages: [{ posts: [stale] }] }, stale.id)
      ?.explicitContent
  ).toBe(true);
  expect(
    cachedPostPreview(
      { pages: [{ items: [{ ...post, labels: ["sexual"] }] }] },
      post.id
    )?.explicitContent
  ).toBe(true);
  expect(stale.explicitContent).toBe(false);
});
