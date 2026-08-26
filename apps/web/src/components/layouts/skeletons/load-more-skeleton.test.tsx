import { describe, expect, test } from "bun:test";

import { renderToString } from "react-dom/server";

import LoadMoreSkeleton from "./load-more-skeleton";

describe("LoadMoreSkeleton", () => {
  const html = renderToString(<LoadMoreSkeleton />);

  test("renders multiple skeleton post cards matching the feed layout", () => {
    // Two full post-card placeholders.
    expect(html.match(/border-b/g)?.length).toBeGreaterThanOrEqual(2);
    // Each card has the avatar circle.
    expect(html.match(/rounded-full/g)?.length).toBeGreaterThanOrEqual(4);
  });

  test("media placeholder is bento-shaped (tall left + two stacked right)", () => {
    // The tall left tile of the 3-image bento shape.
    expect(html).toContain("h-72");
    // Two stacked right tiles.
    expect(html.match(/h-\[138px\]/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("action row uses the new pill shapes (vote, comment, share)", () => {
    // Vote pill + comment pill + views pill + two round icon buttons.
    expect(html.match(/h-8 w-20 rounded-full/g)?.length).toBeGreaterThanOrEqual(
      2
    );
    expect(html.match(/h-8 w-14 rounded-full/g)?.length).toBeGreaterThanOrEqual(
      2
    );
    expect(html.match(/h-8 w-8 rounded-full/g)?.length).toBeGreaterThanOrEqual(
      4
    );
  });
});
