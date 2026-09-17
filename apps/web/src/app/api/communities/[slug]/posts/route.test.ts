import { beforeEach, describe, expect, mock, test } from "bun:test";

const PRIVATE_COMMUNITY = {
  id: "community-private",
  type: "PRIVATE",
};
const PUBLIC_COMMUNITY = {
  id: "community-public",
  type: "PUBLIC",
};

const mockGetCommunityBySlug = mock(() => Promise.resolve(PRIVATE_COMMUNITY));
const mockCanViewCommunity = mock(() => Promise.resolve(false));
const mockGetCommunityFeedPage = mock(() =>
  Promise.resolve({ nextCursor: null, posts: [{ id: "post-1" }] })
);
const mockHydrateViewCounts = mock((posts: unknown[]) => posts);

mock.module("@asm/db", () => ({
  canViewCommunity: mockCanViewCommunity,
  getCommunityBySlug: mockGetCommunityBySlug,
  getCommunityFeedPage: mockGetCommunityFeedPage,
  hydrateViewCounts: mockHydrateViewCounts,
}));

let mockSessionUser: { id: string } | null = null;
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    Promise.resolve(mockSessionUser ? { user: mockSessionUser } : null),
}));

function callPosts(slug = "private") {
  return import("./route").then(({ GET }) =>
    GET(new Request(`http://localhost/api/communities/${slug}/posts`), {
      params: Promise.resolve({ slug }),
    })
  );
}

describe("GET /api/communities/[slug]/posts", () => {
  beforeEach(() => {
    mockSessionUser = null;
    mockGetCommunityBySlug.mockClear();
    mockCanViewCommunity.mockClear();
    mockGetCommunityFeedPage.mockClear();
    mockGetCommunityBySlug.mockResolvedValue(PRIVATE_COMMUNITY);
    mockCanViewCommunity.mockResolvedValue(false);
  });

  test("a guest is denied a PRIVATE community's posts with a 404", async () => {
    const response = await callPosts();

    expect(response.status).toBe(404);
    // The gate short-circuits before the feed query ever runs.
    expect(mockGetCommunityFeedPage).not.toHaveBeenCalled();
  });

  test("an approved member can read a PRIVATE community's posts", async () => {
    mockSessionUser = { id: "user-member" };
    mockCanViewCommunity.mockResolvedValue(true);

    const response = await callPosts();

    expect(response.status).toBe(200);
    expect(mockGetCommunityFeedPage).toHaveBeenCalledWith(
      expect.objectContaining({ communityId: PRIVATE_COMMUNITY.id })
    );
  });

  test("a PUBLIC community is readable by a guest", async () => {
    mockGetCommunityBySlug.mockResolvedValue(PUBLIC_COMMUNITY);
    mockCanViewCommunity.mockResolvedValue(true);

    const response = await callPosts("public");

    expect(response.status).toBe(200);
    expect(mockGetCommunityFeedPage).toHaveBeenCalled();
  });

  test("a missing community is still a 404", async () => {
    mockGetCommunityBySlug.mockResolvedValue(null);

    const response = await callPosts("missing");

    expect(response.status).toBe(404);
    expect(mockCanViewCommunity).not.toHaveBeenCalled();
  });
});
