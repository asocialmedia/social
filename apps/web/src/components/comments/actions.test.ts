import { beforeEach, describe, expect, mock, test } from "bun:test";

const POST_ID = "post1";
const AUTHOR_ID = "author1";
const COMMENTER_ID = "commenter1";
const COMMENT_ID = "comment-1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: COMMENTER_ID },
}));

const state = {
  commenterAura: 0,
  authorAura: 0,
  auraLogs: [] as Record<string, unknown>[],
  notifications: [] as Record<string, unknown>[],
};

function resetState() {
  state.commenterAura = 0;
  state.authorAura = 0;
  state.auraLogs = [];
  state.notifications = [];
}

const mockTx = {
  comment: {
    create: () => ({ id: COMMENT_ID, userId: COMMENTER_ID, postId: POST_ID }),
    delete: (args: { where: { id: string } }) => ({
      id: args.where.id,
      userId: COMMENTER_ID,
      postId: POST_ID,
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
    },
  },
  auraLog: {
    create: (args: { data: Record<string, unknown> }) => {
      state.auraLogs.push(args.data);
    },
    // Simulates that the deleted comment was created after this feature
    // shipped and therefore earned aura.
    findFirst: () => ({ id: "log-1" }),
  },
  notification: {
    create: (args: { data: Record<string, unknown> }) => {
      state.notifications.push(args.data);
    },
    deleteMany: (args: {
      where: {
        issuerId: string;
        postId: string;
        recipientId: string;
        type: string;
      };
    }) => {
      const { issuerId, postId, recipientId, type } = args.where;
      state.notifications = state.notifications.filter(
        (notification) =>
          !(
            notification.type === type &&
            notification.recipientId === recipientId &&
            notification.issuerId === issuerId &&
            notification.postId === postId
          )
      );
    },
  },
};

const mockPrisma = {
  $transaction: (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
  comment: {
    create: mockTx.comment.create,
    delete: mockTx.comment.delete,
    findUnique: (args: { where: { id: string } }) =>
      args.where.id === COMMENT_ID
        ? { id: COMMENT_ID, userId: COMMENTER_ID, postId: POST_ID }
        : null,
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

mock.module("@asm/db", () => ({
  getCommentDataInclude: () => ({ user: true }),
  prisma: mockPrisma,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

import { deleteComment, submitComment } from "./actions";

const post = { id: POST_ID, user: { id: AUTHOR_ID } };

describe("submitComment", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("rejects unauthenticated commenters", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    await expect(submitComment({ post, content: "nice" })).rejects.toThrow(
      "Unauthorized"
    );
    expect(state.auraLogs).toEqual([]);
  });

  test("credits aura to the commenter and the post author", async () => {
    const comment = await submitComment({ post, content: "nice post" });

    expect(comment.id).toBe(COMMENT_ID);
    expect(state.commenterAura).toBe(1);
    expect(state.authorAura).toBe(1);
    expect(state.auraLogs).toEqual([
      {
        userId: COMMENTER_ID,
        issuerId: COMMENTER_ID,
        amount: 1,
        type: "COMMENT_CREATION",
        postId: POST_ID,
        commentId: COMMENT_ID,
      },
      {
        userId: AUTHOR_ID,
        issuerId: COMMENTER_ID,
        amount: 1,
        type: "COMMENT_RECEIVED",
        postId: POST_ID,
        commentId: COMMENT_ID,
      },
    ]);
    expect(state.notifications).toEqual([
      {
        type: "COMMENT",
        recipientId: AUTHOR_ID,
        issuerId: COMMENTER_ID,
        postId: POST_ID,
      },
    ]);
  });

  test("commenting on your own post awards no aura to the author", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: AUTHOR_ID } });
    const ownPost = { id: POST_ID, user: { id: AUTHOR_ID } };

    await submitComment({ post: ownPost, content: "self comment" });

    // The commenter is the post author here, so the creation reward lands on
    // the author and no COMMENT_RECEIVED reward is granted.
    expect(state.authorAura).toBe(1);
    expect(state.commenterAura).toBe(0);
    expect(state.auraLogs).toEqual([
      {
        userId: AUTHOR_ID,
        issuerId: AUTHOR_ID,
        amount: 1,
        type: "COMMENT_CREATION",
        postId: POST_ID,
        commentId: COMMENT_ID,
      },
    ]);
    expect(state.notifications).toEqual([]);
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
    state.notifications.push({
      type: "COMMENT",
      recipientId: AUTHOR_ID,
      issuerId: COMMENTER_ID,
      postId: POST_ID,
    });

    const deleted = await deleteComment(COMMENT_ID);

    expect(deleted.id).toBe(COMMENT_ID);
    expect(state.commenterAura).toBe(0);
    expect(state.authorAura).toBe(0);
    expect(state.auraLogs).toEqual([
      {
        userId: COMMENTER_ID,
        issuerId: COMMENTER_ID,
        amount: -1,
        type: "COMMENT_CREATION",
        postId: POST_ID,
        commentId: COMMENT_ID,
      },
      {
        userId: AUTHOR_ID,
        issuerId: COMMENTER_ID,
        amount: -1,
        type: "COMMENT_RECEIVED",
        postId: POST_ID,
        commentId: COMMENT_ID,
      },
    ]);
    expect(state.notifications).toEqual([]);
  });

  test("deleting an unknown comment throws", async () => {
    await expect(deleteComment("missing")).rejects.toThrow("Comment not found");
  });
});
