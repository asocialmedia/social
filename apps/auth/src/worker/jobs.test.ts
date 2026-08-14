import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("worker job processors", () => {
  const deletedObjects: string[] = [];
  const deletedUserIds: string[] = [];

  const mockDeleteObject = mock((key: string) => {
    deletedObjects.push(key);
  });

  const mockRedis = {
    del: mock(() => 1),
    srem: mock(() => 1),
  };

  interface MediaRow {
    commentId: string | null;
    createdAt: Date;
    id: string;
    key: string;
    postId: string | null;
    thumbnailKey: string | null;
  }

  const mockPrisma = {
    media: {
      delete: mock(() => ({})),
      deleteMany: mock(() => ({ count: 2 })),
      findMany: mock(() => [
        { id: "media-1", key: "uploads/a.jpg", thumbnailKey: null },
        {
          id: "media-2",
          key: "",
          thumbnailKey: "uploads/video-thumb.jpg",
        },
      ]),
      findUnique: mock((): Promise<MediaRow | null> =>
        Promise.resolve({
          commentId: null,
          createdAt: new Date(),
          id: "media-1",
          key: "uploads/a.jpg",
          postId: null,
          thumbnailKey: null,
        })
      ),
    },
    passwordResetToken: {
      deleteMany: mock(() => ({ count: 3 })),
    },
    user: {
      deleteMany: mock(() => ({ count: 1 })),
      findMany: mock(() => [{ id: "user-1" }]),
    },
  };

  mock.module("@asm/db", () => ({
    POST_VIEWS_KEY_PREFIX: "post:views:",
    POST_VIEWS_SET: "posts:with:views",
    deleteObject: mockDeleteObject,
    prisma: mockPrisma,
    redis: mockRedis,
    unreadNotificationCache: {
      decrement: mock(() => 0),
      increment: mock(() => 1),
    },
  }));

  beforeEach(() => {
    deletedObjects.length = 0;
    deletedUserIds.length = 0;
    mockDeleteObject.mockClear();
    mockRedis.srem.mockClear();
    mockRedis.del.mockClear();
    mockPrisma.media.findMany.mockClear();
    mockPrisma.media.deleteMany.mockClear();
    mockPrisma.media.findUnique.mockClear();
    mockPrisma.media.delete.mockClear();
    mockPrisma.user.findMany.mockClear();
    mockPrisma.user.deleteMany.mockClear();
    mockPrisma.passwordResetToken.deleteMany.mockClear();
  });

  test("processPostDeleted deletes media objects and rows and clears view keys", async () => {
    const { processPostDeleted } = await import("./jobs");

    await processPostDeleted({ postId: "post-1" });

    expect(mockPrisma.media.findMany).toHaveBeenCalledWith({
      select: { id: true, key: true, thumbnailKey: true },
      where: { postId: "post-1" },
    });
    // Only media with non-empty keys reaches the object store; video
    // thumbnails are deleted alongside their clips.
    expect(deletedObjects).toEqual([
      "uploads/a.jpg",
      "uploads/video-thumb.jpg",
    ]);
    expect(mockPrisma.media.deleteMany).toHaveBeenCalled();
    expect(mockRedis.srem).toHaveBeenCalled();
    expect(mockRedis.del).toHaveBeenCalled();
  });

  test("processMediaCleanup deletes orphaned media but skips attached media", async () => {
    const { processMediaCleanup } = await import("./jobs");

    await processMediaCleanup({ mediaId: "media-1" });

    expect(mockPrisma.media.findUnique).toHaveBeenCalledWith({
      select: {
        commentId: true,
        createdAt: true,
        id: true,
        key: true,
        postId: true,
        thumbnailKey: true,
      },
      where: { id: "media-1" },
    });
    expect(deletedObjects).toEqual(["uploads/a.jpg"]);
    expect(mockPrisma.media.delete).toHaveBeenCalledWith({
      where: { id: "media-1" },
    });

    // Attached media should be left alone.
    mockPrisma.media.findUnique.mockResolvedValueOnce({
      commentId: null,
      createdAt: new Date(),
      id: "media-2",
      key: "uploads/b.jpg",
      postId: "post-2",
      thumbnailKey: null,
    });
    deletedObjects.length = 0;
    mockPrisma.media.delete.mockClear();
    await processMediaCleanup({ mediaId: "media-2" });
    expect(deletedObjects).toEqual([]);
    expect(mockPrisma.media.delete).not.toHaveBeenCalled();

    // Media attached to a comment eddy is not orphaned either.
    mockPrisma.media.findUnique.mockResolvedValueOnce({
      commentId: "comment-1",
      createdAt: new Date(),
      id: "media-3",
      key: "uploads/c.jpg",
      postId: null,
      thumbnailKey: null,
    });
    deletedObjects.length = 0;
    mockPrisma.media.delete.mockClear();
    await processMediaCleanup({ mediaId: "media-3" });
    expect(deletedObjects).toEqual([]);
    expect(mockPrisma.media.delete).not.toHaveBeenCalled();
  });

  test("processInactiveUsersSweep deletes unverified users older than 30 days", async () => {
    const { processInactiveUsersSweep } = await import("./jobs");

    const deleted = await processInactiveUsersSweep();

    expect(mockPrisma.user.findMany).toHaveBeenCalled();
    expect(mockPrisma.user.deleteMany).toHaveBeenCalled();
    expect(deleted).toBe(1);
  });

  test("processExpiredTokens deletes expired reset tokens", async () => {
    const { processExpiredTokens } = await import("./jobs");

    await processExpiredTokens();

    expect(mockPrisma.passwordResetToken.deleteMany).toHaveBeenCalled();
  });

  test("processNotificationCreated and Deleted adjust the unread counter", async () => {
    const { processNotificationCreated, processNotificationDeleted } =
      await import("./jobs");
    const { unreadNotificationCache } = await import("@asm/db");

    await processNotificationCreated({ recipientId: "user-1" });
    await processNotificationDeleted({ recipientId: "user-1" });

    expect(unreadNotificationCache.increment).toHaveBeenCalledWith("user-1");
    expect(unreadNotificationCache.decrement).toHaveBeenCalledWith("user-1");
  });
});
