import { describe, expect, test } from "bun:test";

import { renderToString } from "react-dom/server";

import FeedViewSkeleton from "./feed-view-skeleton";
import LoadMoreSkeleton from "./load-more-skeleton";
import {
  DYNAMIC_SKELETON_PROFILES,
  PostCardSkeleton,
} from "./post-card-skeleton";

describe("post skeletons", () => {
  test("neutral mode produces neutral cards without media placeholders", () => {
    const html = renderToString(<LoadMoreSkeleton dynamic={false} />);
    expect(html.match(/data-post-skeleton="unknown"/g)).toHaveLength(4);
    expect(html).not.toContain("data-skeleton-media");
  });

  test("initial FeedViewSkeleton renders dynamic post shapes (albums, text, landscape, vertical)", () => {
    const html = renderToString(<FeedViewSkeleton count={8} />);
    expect(html).toContain('data-skeleton-media="album"');
    expect(html).toContain('data-post-skeleton="text"');
    expect(html).toContain('data-skeleton-media="image"');
    expect(html).toContain('data-skeleton-media="vertical"');
  });

  test("LoadMoreSkeleton defaults to at least 4 items with varied dynamic post types", () => {
    const html = renderToString(<LoadMoreSkeleton />);
    const cards = html.match(/data-post-skeleton=/g);
    expect(cards).toHaveLength(4);
    expect(html).toContain('data-skeleton-media="album"');
    expect(html).toContain('data-post-skeleton="text"');
    expect(html).toContain('data-skeleton-media="image"');
    expect(html).toContain('data-skeleton-media="vertical"');
  });

  test("text-only posts have no media placeholder", () => {
    const html = renderToString(
      <PostCardSkeleton post={{ content: "Text post" }} />
    );
    expect(html).toContain('data-post-skeleton="text"');
    expect(html).not.toContain("data-skeleton-media");
  });

  test("portrait video and GIF placeholders retain their real proportions", () => {
    for (const media of [
      { height: 1920, type: "VIDEO", width: 1080 },
      { height: 240, mimeType: "image/gif", width: 120 },
    ]) {
      const html = renderToString(
        <PostCardSkeleton post={{ attachments: [media] }} />
      );
      expect(html).toContain(`aspect-ratio:${media.width / media.height}`);
      expect(html).not.toContain('data-skeleton-media="album"');
    }
  });

  test("known audio, embed, and album content use their own placeholders", () => {
    const html = renderToString(
      <LoadMoreSkeleton
        posts={[
          { attachments: [{ type: "AUDIO" }] },
          { attachments: [{}, {}, {}] },
          { embeds: [{ url: "https://example.test" }] },
        ]}
      />
    );
    for (const kind of ["audio", "album", "embed"]) {
      expect(html).toContain(`data-skeleton-media="${kind}"`);
    }
  });

  test("Bluesky post skeleton renders squircle avatar, butterfly icon, and matches asocialmedia card structure", () => {
    const html = renderToString(<PostCardSkeleton isBluesky />);
    expect(html).toContain('aria-label="Loading Bluesky post"');
    // Squircle avatar matching asocialmedia UserAvatar
    expect(html).toContain("rounded-[30%]");
    expect(html).toContain("avatar-ring");
    // Bluesky butterfly icon SVG with sky color
    expect(html).toContain("text-sky-500");
  });

  test("FeedViewSkeleton with source=bluesky renders initial loading state with separators", () => {
    const html = renderToString(
      <FeedViewSkeleton count={4} source="bluesky" />
    );
    expect(html).toContain('aria-label="Loading feed"');
    const matches = html.match(/aria-label="Loading Bluesky post"/g);
    expect(matches).toHaveLength(4);
  });

  test("LoadMoreSkeleton with source=bluesky renders scroll loading state for Bluesky with 4 items", () => {
    const html = renderToString(
      <LoadMoreSkeleton count={4} source="bluesky" />
    );
    expect(html).toContain('aria-label="Loading Bluesky posts"');
    const matches = html.match(/aria-label="Loading Bluesky post"/g);
    expect(matches).toHaveLength(4);
  });

  test("DYNAMIC_SKELETON_PROFILES defines album, text, image, and vertical varieties", () => {
    const kinds = new Set(DYNAMIC_SKELETON_PROFILES.map((p) => p.kind));
    expect(kinds.has("album")).toBe(true);
    expect(kinds.has("text")).toBe(true);
    expect(kinds.has("image")).toBe(true);
    expect(kinds.has("vertical")).toBe(true);
  });
});
