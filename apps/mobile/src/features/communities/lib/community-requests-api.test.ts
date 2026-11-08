import { describe, expect, mock, test } from "bun:test";

mock.module("@/features/network/lib/network-api", () => ({
  networkRequest: () => Promise.resolve(null),
}));

const {
  canReviewCommunityRequests,
  communityDecisionTitle,
  communityJoinRequestPageSchema,
  communityRequestsPath,
  mergeCommunityRequestPages,
} = await import("./community-requests-api");

function page(ids: string[], total: number, nextCursor: string | null = null) {
  return communityJoinRequestPageSchema.parse({
    nextCursor,
    requests: ids.map((id) => ({
      createdAt: "2026-01-01T00:00:00.000Z",
      id,
      user:
        id === "ghost"
          ? null
          : { avatarUrl: null, displayName: "", id: `u-${id}`, username: id },
    })),
    total,
  });
}

describe("community join requests", () => {
  test("builds the web route with an encoded cursor", () => {
    expect(communityRequestsPath("a b")).toBe(
      "/api/communities/a%20b/membership-requests"
    );
    expect(communityRequestsPath("x", "c/1")).toBe(
      "/api/communities/x/membership-requests?cursor=c%2F1"
    );
  });

  test("merges pages, drops missing users and duplicates", () => {
    const merged = mergeCommunityRequestPages(
      [page(["a", "ghost", "b"], 4, "next"), page(["b", "c"], 4)],
      new Set()
    );
    expect(merged.requests.map((request) => request.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(merged.total).toBe(4);
  });

  test("a decided request leaves the list and the count", () => {
    const merged = mergeCommunityRequestPages(
      [page(["a", "b"], 2)],
      new Set(["a", "unknown"])
    );
    expect(merged.requests.map((request) => request.id)).toEqual(["b"]);
    expect(merged.total).toBe(1);
    expect(mergeCommunityRequestPages([], new Set()).total).toBeUndefined();
  });

  test("decision toasts match web", () => {
    expect(communityDecisionTitle("approve", true)).toBe("Member approved");
    expect(communityDecisionTitle("decline", true)).toBe("Request declined");
    expect(communityDecisionTitle("approve", false)).toBe(
      "Request already resolved"
    );
  });

  test("only active staff of a non-public community review requests", () => {
    const owner = { role: "OWNER", status: "ACTIVE" };
    expect(canReviewCommunityRequests("PRIVATE", owner)).toBe(true);
    expect(
      canReviewCommunityRequests("RESTRICTED", {
        role: "MODERATOR",
        status: "ACTIVE",
      })
    ).toBe(true);
    expect(canReviewCommunityRequests("PUBLIC", owner)).toBe(false);
    expect(
      canReviewCommunityRequests("PRIVATE", {
        role: "MEMBER",
        status: "ACTIVE",
      })
    ).toBe(false);
    expect(
      canReviewCommunityRequests("PRIVATE", {
        role: "OWNER",
        status: "PENDING",
      })
    ).toBe(false);
    expect(canReviewCommunityRequests("PRIVATE", null)).toBe(false);
  });
});
