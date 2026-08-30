import { describe, expect, test } from "bun:test";

import {
  getCommentDataInclude,
  getPostDataInclude,
  getUserDataSelect,
} from "./client";

describe("db client queries", () => {
  test("getUserDataSelect includes correct fields", () => {
    const select = getUserDataSelect("user123");
    expect(select.id).toBe(true);
    expect(select.username).toBe(true);
    expect(select.followers.where.followerId).toBe("user123");
  });

  test("getPostDataInclude includes correct relations", () => {
    const include = getPostDataInclude("user123");
    expect(include.user).toBeDefined();
    expect(include.attachments).toBe(true);
    expect(include._count.select.comments).toEqual({
      where: { deleted: false },
    });
    expect(include.bookmarks.where.userId).toBe("user123");
    expect(include.vote.where.userId).toBe("user123");
  });

  test("getCommentDataInclude includes user select", () => {
    const include = getCommentDataInclude("user123");
    expect(include.user.select.id).toBe(true);
    expect(include.user.select.followers.where.followerId).toBe("user123");
  });
});
