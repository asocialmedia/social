import { beforeEach, describe, expect, mock, test } from "bun:test";

import { deleteComment, submitComment } from "./actions";

const POST_ID = "post1";
const AUTHOR_ID = "author1";
const COMMENTER_ID = "commenter1";
const COMMENT_ID = "comment-1";
const PARENT_ID = "parent-1";
const PARENT_AUTHOR_ID = "parent-author-1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: COMMENTER_ID },
}));

const state = {
  auraLogs: [] as Record<string, unknown>[],
  authorAura: 0,
  commenterAura: 0,
  createdParentId: undefined as string | undefined,
  createdRootId: undefined as string | null | undefined,
  notifications: [] as Record<string, unknown>[],
  parentAuthorAura: 0,
  published: [] as Record<string, unknown>[],
};

function resetState() {
  state.commenterAura = 0;
  state.authorAura = 0;
  state.parentAuthorAura = 0;
  state.auraLogs = [];
  state.notifications = [];
  state.published = [];
  state.createdParentId = undefined;
  state.createdRootId = undefined;
}

const mockTx = {
  auraLog: {
    create: (args: { data: Record<string, unknown> }) => {
      state.auraLogs.push(args.data);
    },
    // Simulates that the deleted comment was created after this feature
    // shipped and therefore earned aura.
    findFirst: () => ({ id: "log-1" }),
  },
  comment: {
    create: (args: { data: Record<string, unknown> }) => {
      state.createdParentId = args.data.parentId as string | undefined;
      state.createdRootId = args.data.rootId as string | null | undefined;
      return { id: COMMENT_ID, postId: POST_ID, userId: COMMENTER_ID };
    },
    delete: (args: { where: { id: string } }) => ({
      id: args.where.id,
      postId: POST_ID,
      userId: COMMENTER_ID,
    }),
    update: (args: { where: { id: string } }) => ({
      deleted: true,
      id: args.where.id,
      postId: POST_ID,
      userId: COMMENTER_ID,
    }),
  },
  notification: {
    create: (args: { data: Record<string, unknown> }) => {
      state.notifications.push(args.data);
    },
    deleteMany: (args: {
      where: {
        commentId?: string;
        issuerId?: string;
        postId?: string;
        recipientId?: string;
        type?: string | { in: string[] };
      };
    }) => {
      const { commentId, issuerId, postId, recipientId, type } = args.where;
      state.notifications = state.notifications.filter((notification) => {
        const typeMatches =
          typeof type === "string"
            ? notification.type === type
            : (type?.in ?? []).includes(notification.type as string);
        const commentIdMatches =
          commentId === undefined ? true : notification.commentId === commentId;
        return !(
          typeMatches &&
          commentIdMatches &&
          (issuerId === undefined || notification.issuerId === issuerId) &&
          (recipientId === undefined ||
            notification.recipientId === recipientId) &&
          (postId === undefined || notification.postId === postId)
        );
      });
    },
    findMany: (args: {
      select?: unknown;
      where: {
        commentId?: string;
        type?: { in: string[] };
      };
    }) =>
      state.notifications.filter((notification) => {
        const typeMatches = (args.where.type?.in ?? []).includes(
          notification.type as string
        );
        return (
          (args.where.commentId === undefined ||
            notification.commentId === args.where.commentId) &&
          typeMatches
        );
      }),
  },
  user: {
    update: (args: {
      data: { aura?: { decrement?: number; increment?: number } };
      where: { id: string };
    }) => {
      const delta =
        (args.data.aura?.increment ?? 0) - (args.data.aura?.decrement ?? 0);
      if (args.where.id === COMMENTER_ID) {
        state.commenterAura += delta;
      }
      if (args.where.id === AUTHOR_ID) {
        state.authorAura += delta;
      }
      if (args.where.id === PARENT_AUTHOR_ID) {
        state.parentAuthorAura += delta;
      }
    },
  },
};

const mockPrisma = {
  $transaction: (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
  comment: {
    create: mockTx.comment.create,
    delete: mockTx.comment.delete,
    findUnique: (args: { where: { id: string } } & { select?: unknown }) => {
      if (args.where.id === COMMENT_ID) {
        return {
          id: COMMENT_ID,
          parentId: null,
          postId: POST_ID,
          userId: COMMENTER_ID,
        };
      }
      if (args.where.id === PARENT_ID) {
        return {
          id: PARENT_ID,
          postId: POST_ID,
          rootId: null,
          userId: PARENT_AUTHOR_ID,
        };
      }
      return null;
    },
    update: mockTx.comment.update,
  },
  post: {
    findUnique: (
      args: { where: { id: string } } & {
        select?: unknown;
      }
    ) =>
      args.where.id === POST_ID ? { id: POST_ID, userId: AUTHOR_ID } : null,
  },
};

const mockPublish = mock(async () => {});

mock.module("@asm/db", () => ({
  cancelMediaCleanup: mockPublish,
  enqueueNotificationCreated: mockPublish,
  enqueueNotificationDeleted: mockPublish,
  getCommentDataInclude: () => ({ user: true }),
  prisma: mockPrisma,
  publishCommentCreated: mockPublish,
  publishCommentDeleted: mockPublish,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

const post = { id: POST_ID, user: { id: AUTHOR_ID } };

describe("submitComment", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
    mockPublish.mockClear();
    mockPrisma.comment.findUnique = (
      args: { where: { id: string } } & { select?: unknown }
    ) => {
      if (args.where.id === COMMENT_ID) {
        return {
          id: COMMENT_ID,
          parentId: null,
          postId: POST_ID,
          userId: COMMENTER_ID,
        };
      }
      if (args.where.id === PARENT_ID) {
        return {
          id: PARENT_ID,
          postId: POST_ID,
          rootId: null,
          userId: PARENT_AUTHOR_ID,
        };
      }
      return null;
    };
  });

  test("rejects unauthenticated commenters", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    await expect(submitComment({ content: "nice", post })).rejects.toThrow(
      "Unauthorized"
    );
    expect(state.auraLogs).toEqual([]);
  });

  test("credits aura to the commenter and the post author", async () => {
    const comment = await submitComment({ content: "nice post", post });

    expect(comment.id).toBe(COMMENT_ID);
    expect(state.commenterAura).toBe(1);
    expect(state.authorAura).toBe(1);
    expect(state.auraLogs).toEqual([
      {
        amount: 1,
        commentId: COMMENT_ID,
        issuerId: COMMENTER_ID,
        postId: POST_ID,
        type: "COMMENT_CREATION",
        userId: COMMENTER_ID,
      },
      {
        amount: 1,
        commentId: COMMENT_ID,
        issuerId: COMMENTER_ID,
        postId: POST_ID,
        type: "COMMENT_RECEIVED",
        userId: AUTHOR_ID,
      },
    ]);
    expect(state.notifications).toEqual([
      {
        commentId: COMMENT_ID,
        issuerId: COMMENTER_ID,
        postId: POST_ID,
        recipientId: AUTHOR_ID,
        type: "COMMENT",
      },
    ]);
  });

  test("commenting on your own post awards no aura to the author", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: AUTHOR_ID } });
    const ownPost = { id: POST_ID, user: { id: AUTHOR_ID } };

    await submitComment({ content: "self comment", post: ownPost });

    // The commenter is the post author here, so the creation reward lands on
    // the author and no COMMENT_RECEIVED reward is granted.
    expect(state.authorAura).toBe(1);
    expect(state.commenterAura).toBe(0);
    expect(state.auraLogs).toEqual([
      {
        amount: 1,
        commentId: COMMENT_ID,
        issuerId: AUTHOR_ID,
        postId: POST_ID,
        type: "COMMENT_CREATION",
        userId: AUTHOR_ID,
      },
    ]);
    expect(state.notifications).toEqual([]);
  });

  test("a reply credits its own parent's author instead of the post author", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: COMMENTER_ID } });

    await submitComment({
      content: "nested reply",
      parentId: PARENT_ID,
      post,
    });

    expect(state.createdParentId).toBe(PARENT_ID);
    // A reply to a top-level comment roots at the parent.
    expect(state.createdRootId).toBe(PARENT_ID);
    // The commenter earns creation aura.
    expect(state.commenterAura).toBe(1);
    // The parent's author (not the post author) earns the received aura.
    expect(state.parentAuthorAura).toBe(1);
    expect(state.authorAura).toBe(0);
    // The parent's author is notified on a reply, and the post author is also
    // notified when a thread on their post gets a reply (both differ here).
    expect(state.notifications).toEqual([
      {
        commentId: COMMENT_ID,
        issuerId: COMMENTER_ID,
        postId: POST_ID,
        recipientId: PARENT_AUTHOR_ID,
        type: "COMMENT",
      },
      {
        commentId: COMMENT_ID,
        issuerId: COMMENTER_ID,
        postId: POST_ID,
        recipientId: AUTHOR_ID,
        type: "COMMENT",
      },
    ]);
  });

  test("a reply to your own comment awards no received aura", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: PARENT_AUTHOR_ID } });

    await submitComment({
      content: "replying to myself",
      parentId: PARENT_ID,
      post,
    });

    expect(state.commenterAura).toBe(0);
    // The commenter (PARENT_AUTHOR_ID) earns creation aura in their own bucket.
    expect(state.parentAuthorAura).toBe(1);
    expect(state.authorAura).toBe(0);
    expect(state.notifications).toEqual([]);
  });

  test("a reply to a comment on another post is rejected", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: COMMENTER_ID } });
    mockPrisma.comment.findUnique = () =>
      ({
        id: PARENT_ID,
        postId: "other-post",
        rootId: null,
        userId: PARENT_AUTHOR_ID,
      }) as never;

    await expect(
      submitComment({
        content: "cross-post reply",
        parentId: PARENT_ID,
        post,
      })
    ).rejects.toThrow("Parent comment does not belong to this post");
    expect(state.commenterAura).toBe(0);
    expect(state.auraLogs).toEqual([]);
  });

  test("realtime publish fires after a comment is created", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: COMMENTER_ID } });

    await submitComment({ content: "broadcast me", post });

    expect(mockPublish.mock.calls.length).toBeGreaterThan(0);
    const published = mockPublish.mock.calls.map((call) => call[0] as string);
    expect(published).toContain(POST_ID);
  });
});

describe("deleteComment", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("revokes aura from the commenter and the post author", async () => {
    state.commenterAura = 1;
    state.authorAura = 1;
    state.notifications.push(
      {
        commentId: COMMENT_ID,
        issuerId: COMMENTER_ID,
        postId: POST_ID,
        recipientId: AUTHOR_ID,
        type: "COMMENT",
      },
      {
        commentId: COMMENT_ID,
        issuerId: COMMENTER_ID,
        postId: POST_ID,
        recipientId: PARENT_AUTHOR_ID,
        type: "AMPLIFY",
      },
      {
        commentId: "other-comment",
        issuerId: COMMENTER_ID,
        postId: POST_ID,
        recipientId: AUTHOR_ID,
        type: "COMMENT",
      }
    );

    const deleted = await deleteComment(COMMENT_ID);

    expect(deleted.id).toBe(COMMENT_ID);
    expect(state.commenterAura).toBe(0);
    expect(state.authorAura).toBe(0);
    expect(state.auraLogs).toEqual([
      {
        amount: -1,
        commentId: COMMENT_ID,
        issuerId: COMMENTER_ID,
        postId: POST_ID,
        type: "COMMENT_CREATION",
        userId: COMMENTER_ID,
      },
      {
        amount: -1,
        commentId: COMMENT_ID,
        issuerId: COMMENTER_ID,
        postId: POST_ID,
        type: "COMMENT_RECEIVED",
        userId: AUTHOR_ID,
      },
    ]);
    // Notifications pointing at the deleted comment are cleaned up for every
    // recipient, while unrelated notifications stay untouched.
    expect(state.notifications).toEqual([
      {
        commentId: "other-comment",
        issuerId: COMMENTER_ID,
        postId: POST_ID,
        recipientId: AUTHOR_ID,
        type: "COMMENT",
      },
    ]);
  });

  test("deleting an unknown comment throws", async () => {
    await expect(deleteComment("missing")).rejects.toThrow("Comment not found");
  });
});
