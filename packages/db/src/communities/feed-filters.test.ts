import { expect, test } from "bun:test";

import {
  communityFeedSearchParams,
  communityFeedSince,
  communityPostFilterCount,
  readCommunityFeedSelection,
} from "./feed-filters";

test("normalizes invalid and oversized filter input", () => {
  const selection = readCommunityFeedSelection(
    new URLSearchParams({
      author: " @Anny ",
      q: ` ${"a".repeat(130)} `,
      range: "tomorrow",
      rating: "unknown",
      sort: "random",
      type: "unknown",
    })
  );
  expect(selection).toEqual({
    author: "Anny",
    query: "a".repeat(120),
    range: "all",
    rating: "all",
    sort: "new",
    type: "all",
  });
});

test("round-trips shareable filters without retaining stale pagination", () => {
  const selection = readCommunityFeedSelection(
    new URLSearchParams(
      "sort=top&type=images&range=week&rating=safe&q=hello%20world&author=anny"
    )
  );
  const params = communityFeedSearchParams(
    selection,
    "cursor=stale&campaign=table"
  );
  expect(params.get("cursor")).toBeNull();
  expect(params.get("campaign")).toBe("table");
  expect(readCommunityFeedSelection(params)).toEqual(selection);
  expect(communityPostFilterCount(selection)).toBe(5);
});

test("reset removes only owned parameters and uses rolling date ranges", () => {
  const defaults = readCommunityFeedSelection(new URLSearchParams());
  expect(
    communityFeedSearchParams(
      defaults,
      "type=images&sort=top&q=hello&other=keep"
    ).toString()
  ).toBe("other=keep");
  expect(communityPostFilterCount(defaults)).toBe(0);
  expect(communityFeedSince("all")).toBeNull();
  expect(
    communityFeedSince("week", new Date("2026-10-19T12:00:00Z"))?.toISOString()
  ).toBe("2026-10-12T12:00:00.000Z");
});
