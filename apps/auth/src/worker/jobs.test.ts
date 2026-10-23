import { beforeEach, describe, expect, mock, test } from "bun:test";

import type {
  DispatchDeps,
  PushDelivery,
  PushDispatchResult,
} from "@asm/notifications/server";
import type {
  NotificationCommunity,
  NotificationRecord,
} from "@asm/notifications/shared";

type StoredNotification = Omit<
  NotificationRecord,
  "type" | "createdAt" | "community"
> & {
  _type: NotificationRecord["type"];
  createdAt: Date;
  community:
    | (NotificationCommunity & { _type: "PRIVATE" | "PUBLIC" | "RESTRICTED" })
    | null;
};
function joinRequestNotification(): StoredNotification {
  return {
    _type: "COMMUNITY_JOIN_REQUEST",
    comment: null,
    commentId: null,
    community: {
      _type: "PRIVATE",
      id: "community-1",
      name: "Private community",
      slug: "private",
    },
    communityId: "community-1",
    count: 1,
    createdAt: new Date(),
    id: "notif-request",
    issuer: {
      avatarUrl: null,
      displayName: "Applicant",
      id: "applicant-1",
      username: "applicant",
    },
    issuerId: "applicant-1",
    membershipRequestId: "request-1",
    post: null,
    postId: null,
    read: false,
    recipientId: "staff-1",
  };
}

describe("worker job processors", () => {
  const deletedObjects: string[] = [];
  const deletedUserIds: string[] = [];

  const mockDeleteObject = mock((key: string) => {
    deletedObjects.push(key);
  });

  const mockGrantShitposter = mock((): Promise<boolean> =>
    Promise.resolve(true)
  );

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

  const mockMediaDelete = mock(() => 2);
  const mockMediaDeleteOne = mock(() => ({}));
  const mockMediaFirst = mock((): Promise<MediaRow | null> =>
    Promise.resolve({
      commentId: null,
      createdAt: new Date(),
      id: "media-1",
      key: "uploads/a.jpg",
      postId: null,
      thumbnailKey: null,
    })
  );
  const mockMediaAll = mock(() => [
    {
      id: "media-1",
      key: "uploads/a.jpg",
      postMediaDerivatives: [],
      thumbnailKey: null,
    },
    {
      id: "media-2",
      key: "",
      postMediaDerivatives: [{ key: "derived/v2/media-2/poster-default.jpg" }],
      thumbnailKey: "uploads/video-thumb.jpg",
    },
  ]);

  const mockUserAll = mock(() => [{ id: "user-1" }]);
  let userDeleteError: unknown;
  const mockUserDelete = mock((_userId: string) => {
    if (userDeleteError) {
      return Promise.reject(userDeleteError);
    }
    return 1;
  });
  const mockResetDelete = mock(() => 3);
  const mockAliasDelete = mock(() => 2);
  let notificationRow: StoredNotification | null = null;
  const mockNotificationFirst = mock(() => Promise.resolve(notificationRow));
  const mockRequestFirst = mock((): Promise<{ id: string } | null> =>
    Promise.resolve({ id: "request-1" })
  );
  const mockRequestWhere = mock((_where: Record<string, string>) => ({
    first: mockRequestFirst,
  }));
  const mockIsCommunityModerator = mock(() => Promise.resolve(true));
  const mockDeviceTokens = mock(() =>
    Promise.resolve([
      {
        platform: "android",
        provider: "fcm",
        token: "device-token",
      },
    ])
  );
  let retryablePush = false;
  const mockDispatch = mock(
    (
      _notification: PushDelivery,
      _deps: DispatchDeps
    ): Promise<PushDispatchResult> =>
      Promise.resolve({
        device: { failed: 0, sent: 0, unregistered: [] },
        retryable: retryablePush,
        web: { expired: [], failed: 0, sent: 1 },
      })
  );
  const mockPrisma = {
    orm: {
      public: {
        CommunityMembers: { select: () => ({ where: mockRequestWhere }) },
        Notifications: {
          where: () => {
            const builder = {
              first: mockNotificationFirst,
              include: () => builder,
            };
            return builder;
          },
        },
        PasswordResetTokens: {
          where: () => ({ deleteAndCount: mockResetDelete }),
        },
        PostMedia: {
          select: () => ({
            include: () => ({
              where: () => ({ all: mockMediaAll }),
            }),
            where: () => ({ first: mockMediaFirst }),
          }),
          where: () => ({
            delete: mockMediaDeleteOne,
            deleteAndCount: mockMediaDelete,
          }),
        },
        UsernameAliases: {
          where: () => ({ deleteAndCount: mockAliasDelete }),
        },
        Users: {
          select: () => ({
            where: () => ({
              all: mockUserAll,
              limit: () => ({ all: mockUserAll }),
            }),
          }),
          where: () => ({ deleteAndCount: mockUserDelete }),
        },
      },
    },
  };

  // Exercise the worker's delivery policy without contacting push services.
  mock.module("@asm/notifications/server", () => ({
    dispatchNotificationPush: mockDispatch,
  }));

  mock.module("@asm/db", () => ({
    POST_VIEWS_KEY_PREFIX: "post:views:",
    POST_VIEWS_SET: "posts:with:views",
    and: (...expressions: unknown[]) => expressions,
    cleanupExpiredPublishedNotifications: mock(() =>
      Promise.resolve({ batchesProcessed: 2, deletedCount: 15 })
    ),
    cleanupSinglePublishedNotification: mock((id: string) =>
      Promise.resolve(id === "notif-valid")
    ),
    deleteObject: mockDeleteObject,
    fromPrismaDateTime: (value: Date) => value,
    getTrendingUserIds: mock(() => Promise.resolve(["user-1"])),
    grantShitposterBadgeIfQualified: mockGrantShitposter,
    isCommunityModerator: mockIsCommunityModerator,
    listDevicePushTokens: mockDeviceTokens,
    listPushSubscriptions: mock(() => Promise.resolve([])),
    prisma: mockPrisma,
    pruneDevicePushTokens: mock(() => Promise.resolve(0)),
    prunePushSubscriptions: mock(() => Promise.resolve(0)),
    redis: mockRedis,
    sweepEarlyBadges: mock(() => Promise.resolve(0)),
    syncTrendingBadges: mock(() => Promise.resolve({ granted: 0, revoked: 0 })),
    toPrismaDateTime: (value: Date) => value,
    unreadNotificationCache: {
      decrement: mock(() => 0),
      increment: mock(() => 1),
      incrementOnce: mock(() => 1),
    },
  }));

  beforeEach(() => {
    deletedObjects.length = 0;
    deletedUserIds.length = 0;
    mockDeleteObject.mockClear();
    mockRedis.srem.mockClear();
    mockRedis.del.mockClear();
    mockMediaAll.mockClear();
    mockMediaDelete.mockClear();
    mockMediaDeleteOne.mockClear();
    mockMediaFirst.mockClear();
    mockUserAll.mockClear();
    userDeleteError = undefined;
    mockUserDelete.mockClear();
    mockResetDelete.mockClear();
    mockAliasDelete.mockClear();
    notificationRow = null;
    retryablePush = false;
    mockDispatch.mockClear();
    mockNotificationFirst.mockClear();
    mockRequestWhere.mockClear();
    mockRequestFirst.mockClear();
    mockIsCommunityModerator.mockClear();
    mockDeviceTokens.mockClear();
  });

  test("processPostDeleted deletes media objects and rows and clears view keys", async () => {
    const { processPostDeleted } = await import("./jobs");

    // Legacy event shape (pre-captured mediaIds): exercises both the direct
    // cleanup contract AND the id-based row sweep, matching what the web app
    // has enqueued since it began capturing keys before deleting the post.
    await processPostDeleted({
      mediaIds: ["media-1", "media-2"],
      postId: "post-1",
    });

    // Select shape mirrors jobs.ts exactly: derivative keys, the gust
    // custom-thumbnail pointer, and the pipeline's original/published
    // pointers join the legacy columns.
    expect(mockMediaAll).toHaveBeenCalled();
    // Legacy keys, thumbnails, and pipeline derivative objects all reach
    // the object store for deletion.
    expect(deletedObjects).toEqual([
      "uploads/a.jpg",
      "uploads/video-thumb.jpg",
      "derived/v2/media-2/poster-default.jpg",
    ]);
    expect(mockMediaDelete).toHaveBeenCalled();
    expect(mockRedis.srem).toHaveBeenCalled();
    expect(mockRedis.del).toHaveBeenCalled();
  });

  test("processMediaCleanup deletes orphaned media but skips attached media", async () => {
    const { processMediaCleanup } = await import("./jobs");

    await processMediaCleanup({ mediaId: "media-1" });

    expect(mockMediaFirst).toHaveBeenCalled();
    expect(deletedObjects).toEqual(["uploads/a.jpg"]);
    expect(mockMediaDeleteOne).toHaveBeenCalled();

    // Attached media should be left alone.
    mockMediaFirst.mockResolvedValueOnce({
      commentId: null,
      createdAt: new Date(),
      id: "media-2",
      key: "uploads/b.jpg",
      postId: "post-2",
      thumbnailKey: null,
    });
    deletedObjects.length = 0;
    mockMediaDeleteOne.mockClear();
    await processMediaCleanup({ mediaId: "media-2" });
    expect(deletedObjects).toEqual([]);
    expect(mockMediaDeleteOne).not.toHaveBeenCalled();

    // Media attached to a comment eddy is not orphaned either.
    mockMediaFirst.mockResolvedValueOnce({
      commentId: "comment-1",
      createdAt: new Date(),
      id: "media-3",
      key: "uploads/c.jpg",
      postId: null,
      thumbnailKey: null,
    });
    deletedObjects.length = 0;
    mockMediaDeleteOne.mockClear();
    await processMediaCleanup({ mediaId: "media-3" });
    expect(deletedObjects).toEqual([]);
    expect(mockMediaDeleteOne).not.toHaveBeenCalled();
  });

  test("processInactiveUsersSweep deletes unverified users older than 30 days", async () => {
    const { processInactiveUsersSweep } = await import("./jobs");

    const deleted = await processInactiveUsersSweep();

    expect(mockUserAll).toHaveBeenCalled();
    expect(mockUserDelete).toHaveBeenCalled();
    expect(deleted).toBe(1);
  });

  test("processInactiveUsersSweep retains users blocked by restricted relations", async () => {
    userDeleteError = {
      constraint: "aura_logs_userId_fkey",
      sqlState: "23001",
    };

    const { processInactiveUsersSweep } = await import("./jobs");
    const deleted = await processInactiveUsersSweep();

    expect(deleted).toBe(0);
    expect(mockUserDelete).toHaveBeenCalled();
  });

  test("processInactiveUsersSweep counts retained accounts instead of logging each", async () => {
    // A seeded corpus is almost entirely undeletable, and a line per retained
    // account buried the rest of the startup log in hundreds of identical
    // lines. The count belongs in the summary; the identities are debug-only.
    userDeleteError = {
      constraint: "aura_logs_userId_fkey",
      sqlState: "23001",
    };
    const info: { msg?: string; obj: Record<string, unknown> }[] = [];
    const debug: { msg?: string; obj: Record<string, unknown> }[] = [];
    const logger = {
      debug: (obj: Record<string, unknown>, msg?: string) => {
        debug.push({ msg, obj });
      },
      error: () => {
        /* unused */
      },
      info: (obj: Record<string, unknown>, msg?: string) => {
        info.push({ msg, obj });
      },
      warn: () => {
        /* unused */
      },
    };

    const { processInactiveUsersSweep } = await import("./jobs");
    await processInactiveUsersSweep(logger);

    const finished = info.filter(
      (entry) => entry.msg === "inactive user sweep finished"
    );
    expect(finished).toHaveLength(1);
    expect(finished[0]?.obj).toMatchObject({ deleted: 0, retained: 1 });
    expect(
      info.some(
        (entry) =>
          entry.msg ===
          "inactive user retained because related records restrict deletion"
      )
    ).toBe(false);
    expect(
      debug.some(
        (entry) =>
          entry.msg ===
          "inactive user retained because related records restrict deletion"
      )
    ).toBe(true);
  });

  test("processExpiredTokens deletes expired reset tokens", async () => {
    const { processExpiredTokens } = await import("./jobs");

    await processExpiredTokens();

    expect(mockResetDelete).toHaveBeenCalled();
  });

  test("processExpiredUsernameAliases releases expired usernames", async () => {
    const { processExpiredUsernameAliases } = await import("./jobs");

    await processExpiredUsernameAliases();

    expect(mockAliasDelete).toHaveBeenCalled();
  });

  test("processNotificationCreated and Deleted adjust the unread counter", async () => {
    const { processNotificationCreated, processNotificationDeleted } =
      await import("./jobs");
    const { unreadNotificationCache } = await import("@asm/db");

    await processNotificationCreated({
      notificationId: "notif-1",
      recipientId: "user-1",
    });
    await processNotificationDeleted({ recipientId: "user-1" });

    expect(unreadNotificationCache.incrementOnce).toHaveBeenCalledWith(
      "user-1",
      "notif-1"
    );
    expect(unreadNotificationCache.decrement).toHaveBeenCalledWith("user-1");
  });

  test("private join requests push to current staff through browser registrations", async () => {
    const { processNotificationCreated } = await import("./jobs");
    notificationRow = joinRequestNotification();
    await processNotificationCreated({
      notificationId: notificationRow.id,
      recipientId: "staff-1",
    });
    expect(mockRequestWhere).toHaveBeenCalledWith({
      communityId: "community-1",
      id: "request-1",
      status: "PENDING",
      userId: "applicant-1",
    });
    expect(mockIsCommunityModerator).toHaveBeenCalledWith(
      "community-1",
      "staff-1"
    );
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const [delivery] = mockDispatch.mock.calls;
    expect(delivery?.[0]).toMatchObject({
      membershipRequestId: "request-1",
      recipientId: "staff-1",
      type: "COMMUNITY_JOIN_REQUEST",
    });
    expect(await delivery?.[1].listDeviceTokens("staff-1")).toEqual([]);
    expect(mockDeviceTokens).not.toHaveBeenCalled();
  });

  test("withdrawn or already-decided request IDs cannot trigger a push", async () => {
    const { processNotificationCreated } = await import("./jobs");
    notificationRow = joinRequestNotification();
    mockRequestFirst.mockResolvedValueOnce(null);
    await processNotificationCreated({
      notificationId: notificationRow.id,
      recipientId: "staff-1",
    });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockIsCommunityModerator).not.toHaveBeenCalled();
  });

  test("staff removal, demotion, or bans suppress queued request pushes", async () => {
    const { processNotificationCreated } = await import("./jobs");
    notificationRow = joinRequestNotification();
    mockIsCommunityModerator.mockResolvedValueOnce(false);
    await processNotificationCreated({
      notificationId: notificationRow.id,
      recipientId: "staff-1",
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test("read requests and requests without current private-community context stay in-app only", async () => {
    const { processNotificationCreated } = await import("./jobs");
    const read = { ...joinRequestNotification(), read: true };
    const missingRequest = {
      ...joinRequestNotification(),
      membershipRequestId: null,
    };
    const missingCommunity = { ...joinRequestNotification(), community: null };
    const restricted = joinRequestNotification();
    if (restricted.community) {
      restricted.community._type = "RESTRICTED";
    }
    for (const row of [read, missingRequest, missingCommunity, restricted]) {
      notificationRow = row;
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each delivery reads the shared notification fixture.
      await processNotificationCreated({
        notificationId: row.id,
        recipientId: "staff-1",
      });
    }
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockRequestFirst).not.toHaveBeenCalled();
  });

  test("approval and decline decisions remain in-app only", async () => {
    const { processNotificationCreated } = await import("./jobs");
    for (const type of [
      "COMMUNITY_JOIN_APPROVED",
      "COMMUNITY_JOIN_DECLINED",
    ] as const) {
      notificationRow = { ...joinRequestNotification(), _type: type };
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each delivery reads the shared notification fixture.
      await processNotificationCreated({
        notificationId: notificationRow.id,
        recipientId: "staff-1",
      });
    }
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test("other notification types retain native push delivery", async () => {
    const { processNotificationCreated } = await import("./jobs");
    notificationRow = { ...joinRequestNotification(), _type: "FOLLOW" };
    await processNotificationCreated({
      notificationId: notificationRow.id,
      recipientId: "staff-1",
    });
    const [delivery] = mockDispatch.mock.calls;
    expect(await delivery?.[1].listDeviceTokens("staff-1")).toHaveLength(1);
    expect(mockDeviceTokens).toHaveBeenCalledWith("staff-1");
  });

  test("retryable push outages retain the notification ID for unread deduplication", async () => {
    const { processNotificationCreated } = await import("./jobs");
    const { unreadNotificationCache } = await import("@asm/db");
    notificationRow = joinRequestNotification();
    retryablePush = true;
    await expect(
      processNotificationCreated({
        notificationId: notificationRow.id,
        recipientId: "staff-1",
      })
    ).rejects.toThrow("Push dispatch infrastructure unavailable");
    expect(unreadNotificationCache.incrementOnce).toHaveBeenCalledWith(
      "staff-1",
      "notif-request"
    );
  });

  test("processShitposterCheck returns true when the badge is granted", async () => {
    const { processShitposterCheck } = await import("./jobs");
    mockGrantShitposter.mockClear();
    mockGrantShitposter.mockResolvedValue(true);

    const granted = await processShitposterCheck({ userId: "user-1" });

    expect(mockGrantShitposter).toHaveBeenCalledWith("user-1");
    expect(granted).toBe(true);
  });

  test("processShitposterCheck returns false when the user does not qualify", async () => {
    const { processShitposterCheck } = await import("./jobs");
    mockGrantShitposter.mockClear();
    mockGrantShitposter.mockResolvedValue(false);

    const granted = await processShitposterCheck({ userId: "user-1" });

    expect(mockGrantShitposter).toHaveBeenCalledWith("user-1");
    expect(granted).toBe(false);
  });

  test("processPublishedNotificationCleanup delegates to cleanupSinglePublishedNotification", async () => {
    const { processPublishedNotificationCleanup } = await import("./jobs");
    const { cleanupSinglePublishedNotification } = await import("@asm/db");

    const deleted = await processPublishedNotificationCleanup({
      notificationId: "notif-valid",
    });

    expect(cleanupSinglePublishedNotification).toHaveBeenCalledWith(
      "notif-valid"
    );
    expect(deleted).toBe(true);
  });

  test("processPublishedNotificationsSweep delegates to cleanupExpiredPublishedNotifications", async () => {
    const { processPublishedNotificationsSweep } = await import("./jobs");
    const { cleanupExpiredPublishedNotifications } = await import("@asm/db");

    const result = await processPublishedNotificationsSweep();

    expect(cleanupExpiredPublishedNotifications).toHaveBeenCalled();
    expect(result).toEqual({ batchesProcessed: 2, deletedCount: 15 });
  });

  test("processBadgeSweep delegates to the early sweep and trending sync", async () => {
    const { processBadgeSweep } = await import("./jobs");
    const { getTrendingUserIds, sweepEarlyBadges, syncTrendingBadges } =
      await import("@asm/db");

    const result = await processBadgeSweep();

    expect(sweepEarlyBadges).toHaveBeenCalled();
    expect(getTrendingUserIds).toHaveBeenCalled();
    expect(syncTrendingBadges).toHaveBeenCalledWith(["user-1"]);
    expect(result).toEqual({
      earlyGranted: 0,
      trendingGranted: 0,
      trendingRevoked: 0,
    });
  });
});
