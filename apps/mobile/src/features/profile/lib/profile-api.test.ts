import { describe, expect, test } from "bun:test";

import {
  buildProfileFeedPath,
  buildProfilePostsPath,
  buildProfileUsernamePath,
  fetchProfileUserList,
  mutateFollow,
  parseFollowInfo,
  parseProfileFeedPage,
  parseProfileHeader,
} from "./profile-api";

const API = "https://api.test";

test("profile headers preserve bounded mutual previews from the public API", () => {
  const users = Array.from({ length: 7 }, (_, index) => ({
    avatarUrl: null,
    id: `mutual-${index}`,
    username: `mutual${index}`,
  }));
  const profile = parseProfileHeader({
    _count: { followers: 18, following: 27, posts: 9 },
    id: "profile",
    mutuals: { followers: users, following: users.slice(1, 3) },
    username: "profile",
  });
  expect(profile?._count).toEqual({ followers: 18, following: 27, posts: 9 });
  expect(profile?.mutuals?.followers).toHaveLength(3);
  expect(profile?.mutuals?.counts).toEqual({ followers: 7, following: 2 });
  expect(profile?.mutuals?.following.map((user) => user.id)).toEqual([
    "mutual-1",
    "mutual-2",
  ]);
  expect(
    parseProfileHeader({ id: "older", username: "older" })?.mutuals
  ).toEqual({
    counts: { followers: 0, following: 0 },
    followers: [],
    following: [],
  });
});

function post(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    attachments: [],
    bookmarks: [],
    content: "hello",
    createdAt: "2026-09-25T00:00:00.000Z",
    id: "post-1",
    mentions: [],
    tags: [],
    userId: "user-1",
    vote: [],
    ...overrides,
  };
}

describe("profile paths", () => {
  test("resolves route usernames and all six tab endpoints", () => {
    expect(buildProfileUsernamePath("two words")).toBe(
      "/api/users/username/two%20words"
    );
    expect(buildProfilePostsPath("user/id", "next cursor", "all")).toBe(
      "/api/users/user%2Fid/posts?cursor=next%20cursor&filter=all"
    );
    expect(buildProfileFeedPath("u", "posts", null)).toBe(
      "/api/users/u/posts?filter=all"
    );
    expect(buildProfileFeedPath("u", "gusts", "c")).toBe(
      "/api/users/u/posts?cursor=c&filter=gusts"
    );
    expect(buildProfileFeedPath("u", "responses", null)).toBe(
      "/api/users/u/responses"
    );
    expect(buildProfileFeedPath("u", "eddies", "c")).toBe(
      "/api/users/u/replies?cursor=c"
    );
    expect(buildProfileFeedPath("u", "amplified", null)).toBe(
      "/api/users/u/amplified"
    );
    expect(buildProfileFeedPath("u", "media", null)).toBe("/api/users/u/media");
  });
});

describe("profile parsing", () => {
  test("user lists tolerate older responses and bound validated mutual avatars", async () => {
    const baseFetch = (() =>
      Promise.resolve(
        Response.json([
          { id: "old", isFollowing: true, username: "older" },
          {
            id: "new",
            mutualCount: 4,
            mutualFollowers: [
              null,
              { id: "invalid" },
              ...[1, 2, 3, 4].map((index) => ({
                id: `mutual-${index}`,
                username: `friend${index}`,
              })),
            ],
            username: "newer",
          },
        ])
      )) as unknown as typeof fetch;
    const users = await fetchProfileUserList("owner", "followers", {
      apiBase: API,
      baseFetch,
    });
    expect(users[0]?.mutualFollowers).toEqual([]);
    expect(users[0]?.mutualCount).toBe(0);
    expect(users[1]?.mutualCount).toBe(4);
    expect(users[1]?.mutualFollowers.map((user) => user.id)).toEqual([
      "mutual-1",
      "mutual-2",
      "mutual-3",
    ]);
  });

  test("parses public UserData and viewer follow projection", () => {
    const profile = parseProfileHeader({
      aura: 12,
      communityMemberships: [
        { community: { slug: "general" }, role: "OWNER" },
        null,
      ],
      createdAt: "2025-01-02T03:04:05.000Z",
      followers: [{ followerId: "viewer-1" }, { bad: true }],
      id: "user-1",
      username: "alice",
    });
    expect(profile?.followers).toEqual([{ followerId: "viewer-1" }]);
    expect(profile?.isFollowing).toBe(true);
    expect(profile?.communityMemberships).toEqual([
      { community: { slug: "general" }, role: "OWNER" },
    ]);
  });

  test("keeps explicit flags for profile posts, response parents, media and reply context", () => {
    const marked = post({
      explicitContent: true,
      parentPost: { explicitContent: true, id: "source" },
    });
    const pages = [
      parseProfileFeedPage({ posts: [marked] }, "posts"),
      parseProfileFeedPage(
        { media: [{ id: "media", post: marked, type: "IMAGE" }] },
        "media"
      ),
      parseProfileFeedPage(
        { replies: [{ attachments: [], id: "reply", post: marked }] },
        "replies"
      ),
    ];
    for (const page of pages) {
      if (page.kind === "posts") {
        expect(page.items[0]?.explicitContent).toBe(true);
        expect(page.items[0]?.parentPost?.explicitContent).toBe(true);
      } else {
        expect(page.items[0]?.post?.explicitContent).toBe(true);
      }
    }
  });

  test("normalizes post, media, and reply cursor pages", () => {
    const posts = parseProfileFeedPage(
      { nextCursor: "post-next", posts: [post()] },
      "posts"
    );
    expect(posts.kind).toBe("posts");
    if (posts.kind !== "posts") {
      throw new Error("Expected a post page");
    }
    expect(posts.items[0]?.attachments).toEqual([]);
    expect(posts.nextCursor).toBe("post-next");

    const media = parseProfileFeedPage(
      {
        media: [
          {
            _type: "IMAGE",
            createdAt: "2026-09-25T00:00:00.000Z",
            id: "media-1",
            post: { id: "post-1" },
          },
        ],
        nextCursor: "media-next",
      },
      "media"
    );
    expect(media.kind).toBe("media");
    if (media.kind !== "media") {
      throw new Error("Expected a media page");
    }
    expect(media.items[0]?.type).toBe("IMAGE");
    expect(media.items[0]?.post?.id).toBe("post-1");

    const replies = parseProfileFeedPage(
      {
        nextCursor: null,
        replies: [
          {
            content: "reply",
            createdAt: "2026-09-25T00:00:00.000Z",
            id: "reply-1",
            post: post(),
            votes: [{ userId: "viewer-1", value: 1 }],
          },
        ],
      },
      "replies"
    );
    expect(replies.kind).toBe("replies");
    if (replies.kind !== "replies") {
      throw new Error("Expected a replies page");
    }
    expect(replies.items[0]?.post.id).toBe("post-1");
    expect(replies.items[0]?.votes).toEqual([{ userId: "viewer-1", value: 1 }]);
  });
});

describe("follow results", () => {
  test("parses authoritative GET and mutation results", async () => {
    expect(parseFollowInfo({ followers: 8, isFollowedByUser: true })).toEqual({
      followers: 8,
      isFollowedByUser: true,
    });
    const result = await mutateFollow("user/1", true, {
      apiBase: API,
      baseFetch: (() =>
        Promise.resolve(
          Response.json({ followers: 9, isFollowedByUser: true })
        )) as unknown as typeof fetch,
    });
    expect(result).toEqual({
      followers: 9,
      isFollowedByUser: true,
      kind: "success",
    });
  });

  test("surfaces the install-token challenge without throwing", async () => {
    const result = await mutateFollow("user-1", true, {
      apiBase: API,
      baseFetch: (() =>
        Promise.resolve(
          Response.json({ error: "install-token-required" }, { status: 403 })
        )) as unknown as typeof fetch,
    });
    expect(result).toEqual({ kind: "install-token-required" });
  });
});
