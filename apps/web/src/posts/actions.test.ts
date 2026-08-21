import { beforeEach, describe, expect, mock, test } from "bun:test";

const POST_ID = "post1";
const AUTHOR_ID = "author1";
const OTHER_USER_ID = "user2";

const updatedPosts: { changes: Record<string, unknown>; id: string }[] = [];
const auraPenalties: string[] = [];
const auraLogs: {
  amount: number;
  issuerId: string;
  postId: string;
  type: string;
  userId: string;
}[] = [];
const notifications: {
  issuerId: string;
  postId: string;
  recipientId: string;
  type: string;
}[] = [];
const enqueuedNotificationRecipients: string[] = [];

let postState: {
  explicitContent: boolean;
  id: string;
  moderated: boolean;
  userId: string;
};

const mockGetSession = mock(
  (): { user: { id: string; role: string } } | null => ({
    user: { id: OTHER_USER_ID, role: "user" },
  })
);

const tx = {
  auraLog: {
    create: (args: {
      data: {
        amount: number;
        issuerId: string;
        postId: string;
        type: string;
        userId: string;
      };
    }) => {
      auraLogs.push(args.data);
    },
  },
  notification: {
    create: (args: {
      data: {
        issuerId: string;
        postId: string;
        recipientId: string;
        type: string;
      };
    }) => {
      notifications.push(args.data);
    },
  },
  post: {
    findUnique: () => ({
      explicitContent: postState.explicitContent,
      id: POST_ID,
      moderated: postState.moderated,
      userId: AUTHOR_ID,
    }),
    update: (args: {
      data: Record<string, unknown>;
      where: { id: string };
    }) => {
      updatedPosts.push({ changes: args.data, id: args.where.id });
      return { ...args.data, id: args.where.id, userId: AUTHOR_ID };
    },
    // Simulates the conditional transitions: each updateMany only matches when
    // the post is still in the "from" state (e.g. moderated false -> true only
    // matches while unmoderated), so concurrent requests cannot double-apply.
    updateMany: (args: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      let matched = true;
      if ("moderated" in args.where) {
        const expectedModerated = args.where.moderated as boolean;
        if (postState.moderated !== expectedModerated) {
          matched = false;
        }
      }
      if ("explicitContent" in args.where) {
        const expectedExplicit = args.where.explicitContent as boolean;
        if (postState.explicitContent !== expectedExplicit) {
          matched = false;
        }
      }
      if (matched) {
        postState = { ...postState, ...args.data };
      }
      return { count: matched ? 1 : 0 };
    },
  },
  user: {
    update: (args: {
      data: Record<string, unknown>;
      where: { id: string };
    }) => {
      auraPenalties.push(args.where.id);
    },
  },
};

const mockPrisma = {
  $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  post: {
    findUnique: (args: { where: { id: string } }) =>
      args.where.id === POST_ID ? { ...postState } : null,
  },
  user: {
    upsert: () => ({ id: "sys-zeph" }),
  },
};

const mockUpdateTag = mock(() => {});
const mockInclude = () => ({ attachments: true, user: true });
const mockIncrementUnread = mock((userId: string) => {
  enqueuedNotificationRecipients.push(userId);
});
const mockNoop = mock(() => {});

mock.module("@asm/db", () => ({
  POST_VIEWS_KEY_PREFIX: "post:views:",
  POST_VIEWS_SET: "posts:with:views",
  SYSTEM_MODERATION_USER_ID: "sys-zeph",
  enqueuePostDeleted: mockNoop,
  getPostDataInclude: mockInclude,
  prisma: mockPrisma,
  redis: { del: mockNoop, srem: mockNoop },
  unreadNotificationCache: { increment: mockIncrementUnread },
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

beforeEach(() => {
  postState = {
    explicitContent: false,
    id: POST_ID,
    moderated: false,
    userId: AUTHOR_ID,
  };
  updatedPosts.length = 0;
  auraPenalties.length = 0;
  auraLogs.length = 0;
  notifications.length = 0;
  enqueuedNotificationRecipients.length = 0;
  mockGetSession.mockClear();
  mockUpdateTag.mockClear();
  mockIncrementUnread.mockClear();
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

  test("moderating docks the author's aura and logs the penalty", async () => {
    const { updatePostModeration } = await import("./actions");
    mockGetSession.mockImplementation(() => ({
      user: { id: "admin-1", role: "admin" },
    }));

    await updatePostModeration(POST_ID, { moderated: true });

    expect(auraPenalties).toEqual([AUTHOR_ID]);
    expect(auraLogs).toEqual([
      {
        amount: -100,
        issuerId: "admin-1",
        postId: POST_ID,
        type: "MODERATION_PENALTY",
        userId: AUTHOR_ID,
      },
    ]);
    // Expire both the OG card and media rows so share cards + media pages
    // reflect the new moderation state.
    expect(mockUpdateTag).toHaveBeenCalledWith("og-post-card");
    expect(mockUpdateTag).toHaveBeenCalledWith("media-row");
  });

  test("author self-moderation still notifies via the Zeph persona", async () => {
    const { updatePostModeration } = await import("./actions");
    mockGetSession.mockImplementation(() => ({
      user: { id: AUTHOR_ID, role: "user" },
    }));

    // Author flagging their own post: the aura penalty applies, and the
    // author still gets a notification issued by the neutral Zeph account so
    // the moderation shows up in their bell.
    await updatePostModeration(POST_ID, { moderated: true });

    expect(auraPenalties).toEqual([AUTHOR_ID]);
    expect(notifications).toEqual([
      {
        issuerId: "sys-zeph",
        postId: POST_ID,
        recipientId: AUTHOR_ID,
        type: "MODERATION",
      },
    ]);
    expect(enqueuedNotificationRecipients).toEqual([AUTHOR_ID]);
  });

  test("admin moderation notifies the author", async () => {
    const { updatePostModeration } = await import("./actions");
    mockGetSession.mockImplementation(() => ({
      user: { id: "admin-1", role: "admin" },
    }));

    await updatePostModeration(POST_ID, { moderated: true });

    expect(notifications).toEqual([
      {
        issuerId: "sys-zeph",
        postId: POST_ID,
        recipientId: AUTHOR_ID,
        type: "MODERATION",
      },
    ]);
    expect(mockIncrementUnread).toHaveBeenCalledWith(AUTHOR_ID);
  });

  test("flagging explicit notifies the author without an aura penalty", async () => {
    const { updatePostModeration } = await import("./actions");
    mockGetSession.mockImplementation(() => ({
      user: { id: "admin-1", role: "admin" },
    }));

    await updatePostModeration(POST_ID, { explicitContent: true });

    expect(auraPenalties).toEqual([]);
    expect(notifications).toEqual([
      {
        issuerId: "sys-zeph",
        postId: POST_ID,
        recipientId: AUTHOR_ID,
        type: "MODERATION",
      },
    ]);
    expect(enqueuedNotificationRecipients).toEqual([AUTHOR_ID]);
  });

  test("lifting the explicit flag still notifies but never touches aura", async () => {
    const { updatePostModeration } = await import("./actions");
    mockGetSession.mockImplementation(() => ({
      user: { id: "admin-1", role: "admin" },
    }));

    postState.explicitContent = true;
    await updatePostModeration(POST_ID, { explicitContent: false });

    expect(auraPenalties).toEqual([]);
    expect(auraLogs).toEqual([]);
    expect(notifications).toEqual([
      {
        issuerId: "sys-zeph",
        postId: POST_ID,
        recipientId: AUTHOR_ID,
        type: "MODERATION",
      },
    ]);
    expect(enqueuedNotificationRecipients).toEqual([AUTHOR_ID]);
  });

  test("unmoderating notifies without refunding aura", async () => {
    const { updatePostModeration } = await import("./actions");
    mockGetSession.mockImplementation(() => ({
      user: { id: "admin-1", role: "admin" },
    }));

    postState.moderated = true;
    await updatePostModeration(POST_ID, { moderated: false });

    expect(auraPenalties).toEqual([]);
    expect(auraLogs).toEqual([]);
    expect(notifications).toEqual([
      {
        issuerId: "sys-zeph",
        postId: POST_ID,
        recipientId: AUTHOR_ID,
        type: "MODERATION",
      },
    ]);
    expect(enqueuedNotificationRecipients).toEqual([AUTHOR_ID]);
  });

  test("re-applying the current moderation state is a no-op", async () => {
    const { updatePostModeration } = await import("./actions");
    mockGetSession.mockImplementation(() => ({
      user: { id: "admin-1", role: "admin" },
    }));

    // Already moderated: re-applying moderated:true must not transition, so no
    // aura penalty, no log, no notification and no unread increment.
    postState.moderated = true;
    await updatePostModeration(POST_ID, { moderated: true });

    expect(auraPenalties).toEqual([]);
    expect(auraLogs).toEqual([]);
    expect(notifications).toEqual([]);
    expect(enqueuedNotificationRecipients).toEqual([]);

    // Re-applying explicit:true on an already-explicit post is likewise inert.
    postState.explicitContent = true;
    await updatePostModeration(POST_ID, { explicitContent: true });

    expect(auraPenalties).toEqual([]);
    expect(auraLogs).toEqual([]);
    expect(notifications).toEqual([]);
    expect(enqueuedNotificationRecipients).toEqual([]);
  });
});
