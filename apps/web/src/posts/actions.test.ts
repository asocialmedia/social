import { beforeEach, describe, expect, mock, test } from "bun:test";

const POST_ID = "post1";
const AUTHOR_ID = "author1";
const OTHER_USER_ID = "user2";

const updatedPosts: { changes: Record<string, unknown>; id: string }[] = [];

const mockGetSession = mock(
  (): { user: { id: string; role: string } } | null => ({
    user: { id: OTHER_USER_ID, role: "user" },
  })
);

const mockPrisma = {
  post: {
    findUnique: (args: { where: { id: string } }) =>
      args.where.id === POST_ID ? { id: POST_ID, userId: AUTHOR_ID } : null,
    update: (args: {
      data: Record<string, unknown>;
      where: { id: string };
    }) => {
      updatedPosts.push({ changes: args.data, id: args.where.id });
      return { ...args.data, id: args.where.id, userId: AUTHOR_ID };
    },
  },
};

const mockUpdateTag = mock(() => {});
const mockInclude = () => ({ attachments: true, user: true });
const mockNoop = mock(() => {});

mock.module("@asm/db", () => ({
  POST_VIEWS_KEY_PREFIX: "post:views:",
  POST_VIEWS_SET: "posts:with:views",
  enqueuePostDeleted: mockNoop,
  getPostDataInclude: mockInclude,
  prisma: mockPrisma,
  redis: { del: mockNoop, srem: mockNoop },
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

beforeEach(() => {
  updatedPosts.length = 0;
  mockGetSession.mockClear();
  mockUpdateTag.mockClear();
});

describe("updatePostModeration", () => {
  test("rejects a non-owner, non-admin user", async () => {
    const { updatePostModeration } = await import("./actions");
    mockGetSession.mockImplementation(() => ({
      user: { id: OTHER_USER_ID, role: "user" },
    }));

    await expect(
      updatePostModeration(POST_ID, { moderated: true })
    ).rejects.toThrow("Unauthorized");
    expect(updatedPosts.length).toBe(0);
  });

  test("rejects guests", async () => {
    const { updatePostModeration } = await import("./actions");
    mockGetSession.mockImplementation(() => null);

    await expect(
      updatePostModeration(POST_ID, { explicitContent: true })
    ).rejects.toThrow("Unauthorized");
  });

  test("rejects when the post does not exist", async () => {
    const { updatePostModeration } = await import("./actions");
    mockGetSession.mockImplementation(() => ({
      user: { id: AUTHOR_ID, role: "user" },
    }));

    await expect(
      updatePostModeration("missing", { moderated: true })
    ).rejects.toThrow("Post not found");
  });

  test("lets the author flag their own post as moderated", async () => {
    const { updatePostModeration } = await import("./actions");
    mockGetSession.mockImplementation(() => ({
      user: { id: AUTHOR_ID, role: "user" },
    }));

    await updatePostModeration(POST_ID, { moderated: true });

    expect(updatedPosts).toEqual([
      { changes: { moderated: true }, id: POST_ID },
    ]);
    expect(mockUpdateTag).toHaveBeenCalledTimes(2);
  });

  test("lets an admin flag any post as explicit and revert it", async () => {
    const { updatePostModeration } = await import("./actions");
    mockGetSession.mockImplementation(() => ({
      user: { id: "admin-1", role: "admin" },
    }));

    await updatePostModeration(POST_ID, { explicitContent: true });
    await updatePostModeration(POST_ID, { explicitContent: false });

    expect(updatedPosts).toEqual([
      { changes: { explicitContent: true }, id: POST_ID },
      { changes: { explicitContent: false }, id: POST_ID },
    ]);
  });
});
