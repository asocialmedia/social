import { describe, expect, test } from "bun:test";

import type { FeedPost } from "@/features/feed/lib/feed-types";

import { selectExploreAutoplayPost } from "./explore-autoplay";

function post(id: string, values: Partial<FeedPost> = {}): FeedPost {
  return {
    attachments: [{ id: `${id}-video`, type: "VIDEO" }],
    createdAt: "2026-10-15T00:00:00Z",
    id,
    userId: "viewer",
    ...values,
  };
}

describe("Explore viewport autoplay", () => {
  test("only the first eligible preview starts, and it keeps ownership while visible", () => {
    const candidates = [post("first"), post("second")];
    expect(selectExploreAutoplayPost(candidates, null)).toBe("first");
    expect(selectExploreAutoplayPost(candidates, "second")).toBe("second");
  });

  test("hands off when the current preview leaves the viewable region", () => {
    expect(selectExploreAutoplayPost([post("next")], "previous")).toBe("next");
    expect(selectExploreAutoplayPost([], "previous")).toBeNull();
  });

  test("explicit, moderated and image-first posts never acquire a decoder", () => {
    expect(
      selectExploreAutoplayPost(
        [
          post("explicit", { explicitContent: true }),
          post("moderated", { moderated: true }),
          post("image-first", {
            attachments: [
              { id: "image", type: "IMAGE" },
              { id: "clip", type: "VIDEO" },
            ],
          }),
          post("text", { attachments: [] }),
          post("safe"),
        ],
        "explicit"
      )
    ).toBe("safe");
  });
});
