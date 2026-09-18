import {
  nextFeedSegment,
  splitCommunityFirstSegments,
} from "./community-first-feed";

describe("splitCommunityFirstSegments", () => {
  test("drops global posts already led by the community segment", () => {
    const result = splitCommunityFirstSegments({
      communityPosts: [{ id: "a" }, { id: "b" }],
      globalPosts: [{ id: "b" }, { id: "c" }, { id: "d" }],
    });

    expect(result.communityPosts.map((p) => p.id)).toEqual(["a", "b"]);
    // "b" stays only in the community segment, not repeated in global.
    expect(result.globalPosts.map((p) => p.id)).toEqual(["c", "d"]);
  });

  test("passes the global list through untouched with no community lead", () => {
    const result = splitCommunityFirstSegments({
      communityPosts: [],
      globalPosts: [{ id: "a" }, { id: "b" }],
    });

    expect(result.communityPosts).toEqual([]);
    expect(result.globalPosts.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("nextFeedSegment", () => {
  test("leads with the community segment while it is live", () => {
    expect(
      nextFeedSegment({
        communityExhausted: false,
        globalHasNextPage: true,
        hasCommunityLead: true,
      })
    ).toBe("community");
  });

  test("falls through to the global segment once the community is exhausted", () => {
    expect(
      nextFeedSegment({
        communityExhausted: true,
        globalHasNextPage: true,
        hasCommunityLead: true,
      })
    ).toBe("global");
  });

  test("does not pull the community segment when there is no lead", () => {
    expect(
      nextFeedSegment({
        communityExhausted: false,
        globalHasNextPage: true,
        hasCommunityLead: false,
      })
    ).toBe("global");
  });

  test("returns none when neither segment has more to load", () => {
    expect(
      nextFeedSegment({
        communityExhausted: true,
        globalHasNextPage: false,
        hasCommunityLead: true,
      })
    ).toBe("none");
  });
});
