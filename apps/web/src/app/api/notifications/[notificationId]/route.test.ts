import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

const USER_ID = "user-alice";

let currentSession: { user: { id: string } } | null = {
  user: { id: USER_ID },
};

const deletedArgs: { in?: string[]; recipientId?: string }[] = [];
let deleteCount = 1;
let resetCacheUserId: string | null = null;

const mockPrisma = {
  notification: {
    deleteMany: mock(
      (args: {
        where: { id: string | { in: string[] }; recipientId: string };
      }) => {
        const idFilter = args.where.id;
        const targetIds =
          typeof idFilter === "string" ? [idFilter] : idFilter.in;
        deletedArgs.push({
          in: targetIds,
          recipientId: args.where.recipientId,
        });
        return Promise.resolve({ count: deleteCount });
      }
    ),
  },
};

const mockUnreadCache = {
  reset: mock((userId: string) => {
    resetCacheUserId = userId;
    return Promise.resolve(0);
  }),
};

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  prisma: {
    orm: {
      public: {
        Notifications: {
          where: (
            predicate: (notification: {
              id: { in: (ids: string[]) => unknown };
              recipientId: { eq: (id: string) => unknown };
            }) => unknown
          ) => {
            let ids: string[] = [];
            let recipientId = "";
            predicate({
              id: { in: (values) => (ids = values) },
              recipientId: { eq: (id) => (recipientId = id) },
            });
            return {
              deleteAndCount: () =>
                mockPrisma.notification
                  .deleteMany({
                    where: { id: { in: ids }, recipientId },
                  })
                  .then((result) => result.count),
            };
          },
        },
      },
    },
  },
  unreadNotificationCache: mockUnreadCache,
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(currentSession),
}));

describe("DELETE /api/notifications/[notificationId]", () => {
  beforeEach(() => {
    currentSession = { user: { id: USER_ID } };
    deletedArgs.length = 0;
    deleteCount = 1;
    resetCacheUserId = null;
    mockPrisma.notification.deleteMany.mockClear();
    mockUnreadCache.reset.mockClear();
  });

  test("rejects unauthenticated requests with 401", async () => {
    currentSession = null;
    const { DELETE } = await import("./route");

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ notificationId: "notif-1" }),
    });

    expect(response.status).toBe(401);
  });

  test("deletes a single notification ID and resets cache", async () => {
    const { DELETE } = await import("./route");

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ notificationId: "notif-123" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);

    expect(deletedArgs).toEqual([
      {
        in: ["notif-123"],
        recipientId: USER_ID,
      },
    ]);
    expect(resetCacheUserId).toBe(USER_ID);
  });

  test("deletes multiple comma-separated IDs in a single query for grouped dismissals", async () => {
    const { DELETE } = await import("./route");
    deleteCount = 3;

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({
        notificationId: "notif-1,notif-2,notif-3",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);

    expect(deletedArgs).toEqual([
      {
        in: ["notif-1", "notif-2", "notif-3"],
        recipientId: USER_ID,
      },
    ]);
    expect(resetCacheUserId).toBe(USER_ID);
  });

  test("returns 404 when notification does not exist or does not belong to recipient", async () => {
    const { DELETE } = await import("./route");
    deleteCount = 0;

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ notificationId: "notif-foreign" }),
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Notification not found");
  });
});
