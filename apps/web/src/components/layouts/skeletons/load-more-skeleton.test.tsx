import { describe, expect, test } from "bun:test";

import { renderToString } from "react-dom/server";

import LoadMoreSkeleton from "./load-more-skeleton";
import { PostCardSkeleton } from "./post-card-skeleton";

describe("post skeletons", () => {
  test("unknown next-page posts use neutral cards without inventing an album", () => {
    const html = renderToString(<LoadMoreSkeleton />);
    expect(html.match(/data-post-skeleton="unknown"/g)).toHaveLength(2);
    expect(html).not.toContain("data-skeleton-media");
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
});
