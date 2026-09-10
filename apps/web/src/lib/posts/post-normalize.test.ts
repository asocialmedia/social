import { describe, expect, test } from "bun:test";

import type { PostData } from "@asm/db";

import {
  getCommentVote,
  getPostAttachments,
  getUserVote,
  isBookmarkedByUser,
  isStalePost,
  normalizePostData,
  normalizePostsData,
} from "./post-normalize";

describe("post-normalize", () => {
  const basePost: PostData = {
    _count: { comments: 5, mentions: 1, vote: 10 },
    attachments: [],
    aura: 10,
    bookmarks: [{ userId: "user-1" }],
    content: "Test post content",
    createdAt: new Date(),
    embeds: null,
    hnStoryShare: null,
    id: "post-1",
    isGust: false,
    mentions: [],
    moderated: false,
    moderatedAt: null,
    moderatedBy: null,
    tags: [],
    trendingScore: 0,
    updatedAt: new Date(),
    user: {
      avatarKey: null,
      avatarUrl: "/avatars/default-1.png",
      bio: "bio",
      displayName: "User One",
      followers: [],
      id: "author-1",
      posts: [],
      username: "userone",
    } as unknown as PostData["user"],
    userId: "author-1",
    viewCount: 100,
    vote: [{ userId: "user-1", value: 1 }],
  };

  test("isBookmarkedByUser returns true when matched and false otherwise", () => {
    expect(isBookmarkedByUser(basePost, "user-1")).toBe(true);
    expect(isBookmarkedByUser(basePost, "user-2")).toBe(false);
    expect(isBookmarkedByUser(undefined, "user-1")).toBe(false);
    expect(isBookmarkedByUser(null, "user-1")).toBe(false);
    expect(isBookmarkedByUser({ bookmarks: undefined }, "user-1")).toBe(false);
    expect(isBookmarkedByUser({ bookmarks: null }, "user-1")).toBe(false);
  });

  test("getUserVote extracts userVote safely without throwing", () => {
    expect(getUserVote(basePost)).toBe(1);
    expect(getUserVote({ vote: [] })).toBe(0);
    expect(getUserVote({ vote: undefined })).toBe(0);
    expect(getUserVote({ vote: null })).toBe(0);
    expect(getUserVote()).toBe(0);
  });

  test("getCommentVote extracts comment vote safely without throwing", () => {
    expect(getCommentVote({ votes: [{ userId: "u1", value: -1 }] })).toBe(-1);
    expect(getCommentVote({ votes: [] })).toBe(0);
    expect(getCommentVote({ votes: undefined })).toBe(0);
    expect(getCommentVote()).toBe(0);
  });

  test("getPostAttachments returns array safely", () => {
    expect(getPostAttachments(basePost)).toEqual([]);
    expect(getPostAttachments()).toEqual([]);
    expect(getPostAttachments({ attachments: null })).toEqual([]);
  });

  test("normalizePostData defaults missing arrays and count safely", () => {
    const rawIncomplete = {
      aura: 10,
      content: "Hello",
      id: "post-incomplete",
      userId: "user-1",
    } as unknown as PostData;

    const normalized = normalizePostData(rawIncomplete);
    expect(Array.isArray(normalized.bookmarks)).toBe(true);
    expect(Array.isArray(normalized.vote)).toBe(true);
    expect(Array.isArray(normalized.attachments)).toBe(true);
    expect(Array.isArray(normalized.tags)).toBe(true);
    expect(Array.isArray(normalized.mentions)).toBe(true);
    expect(normalized._count).toEqual({
      comments: 0,
      mentions: 0,
      vote: 0,
    });
  });

  test("normalizePostData unwraps { post: ... } response wrappers", () => {
    const wrapped = {
      post: {
        aura: 5,
        content: "Wrapped post",
        id: "post-wrapped",
        userId: "user-1",
      },
    } as unknown as PostData;

    const normalized = normalizePostData(wrapped);
    expect(normalized.id).toBe("post-wrapped");
    expect(normalized.content).toBe("Wrapped post");
    expect(Array.isArray(normalized.vote)).toBe(true);
    expect(Array.isArray(normalized.attachments)).toBe(true);
  });

  test("normalizePostsData normalizes arrays of posts", () => {
    const posts = [
      { aura: 1, content: "c1", id: "p1", userId: "u1" } as unknown as PostData,
      { aura: 2, content: "c2", id: "p2", userId: "u2" } as unknown as PostData,
    ];
    const normalized = normalizePostsData(posts);
    expect(normalized.length).toBe(2);
    expect(Array.isArray(normalized[0].attachments)).toBe(true);
    expect(Array.isArray(normalized[1].vote)).toBe(true);
  });

  test("isStalePost identifies missing fields correctly", () => {
    expect(isStalePost(basePost as unknown as Record<string, unknown>)).toBe(
      false
    );
    expect(
      isStalePost({
        aura: 1,
        content: "test",
        id: "1",
        userId: "u1",
      })
    ).toBe(true);
    expect(
      isStalePost({
        _count: { comments: 0, mentions: 0, vote: 0 },
        attachments: [],
        aura: 1,
        bookmarks: [],
        content: "test",
        id: "1",
        mentions: [],
        tags: [],
        userId: "u1",
      })
    ).toBe(true); // vote is missing
    expect(
      isStalePost({
        ...basePost,
        _count: [],
      } as unknown as Record<string, unknown>)
    ).toBe(true);
    expect(
      isStalePost({
        ...basePost,
        _count: { comments: "5", mentions: 0, vote: 0 },
      } as unknown as Record<string, unknown>)
    ).toBe(true);
  });
});
